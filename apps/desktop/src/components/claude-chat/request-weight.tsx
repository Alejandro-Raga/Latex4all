import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { engineOfProvider } from "@/lib/agent-events";
import {
  copilotQuotaFrom,
  copilotUsedPercent,
  useAiUsage,
  windowName,
} from "@/lib/ai-usage";
import {
  dailyLimit,
  isGoogleApi,
  nextPacificDay,
  requestsToday,
} from "@/lib/provider-quota";
import { cn } from "@/lib/utils";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";
import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";

/** "5h" → "5-hour limit", "week" → "Weekly limit". */
const limitName = (name: string) =>
  name === "5h"
    ? "5-hour limit"
    : name === "week"
      ? "Weekly limit"
      : name === "month"
        ? "Monthly limit"
        : `${name} limit`;

/** "at 18:30", or "Thu at 18:30" past today. */
function resetAt(at: number, now = Date.now()): string {
  const time = new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (new Date(at).toDateString() === new Date(now).toDateString()) {
    return `at ${time}`;
  }
  const day = new Date(at).toLocaleDateString(undefined, { weekday: "short" });
  return `${day} at ${time}`;
}

/** Until a window resets, short: "45m", "2h 10m", "3d". */
export function timeLeft(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((at - now) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) {
    const m = mins % 60;
    return m ? `${Math.floor(mins / 60)}h ${m}m` : `${mins / 60}h`;
  }
  return `${Math.round(mins / (24 * 60))}d`;
}

const pct = (n: number) => (n < 1 ? n.toFixed(1) : String(Math.round(n)));
const level = (used: number) =>
  used >= 90
    ? "text-red-600 dark:text-red-400"
    : used >= 70
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

interface Window {
  name: string;
  used: number;
  resetsAt: number;
}

/**
 * Beside the send button: how full the plan's limits are (Claude's 5 hours,
 * ChatGPT's and Copilot's windows, a free Gemini model's day). What each
 * reply used is measured after it, under the reply.
 */
export function RequestWeight() {
  const tab = useClaudeChatStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const providerId = useClaudeChatStore((s) => s.selectedProviderCredentialId);
  const claudeLimits = useAiUsage((s) => s.claudeLimits);
  const codexLimits = useAiUsage((s) => s.codexLimits);
  const copilotQuota = useAiUsage((s) => s.copilotQuota);
  const entries = useAiUsage((s) => s.entries);
  const learned = useAiUsage((s) => s.dailyLimits);
  const credential = useClaudeSetupStore((s) =>
    s.openAiCredentials.find((c) => c.id === providerId),
  );
  const credentialModel = useClaudeChatStore((s) =>
    providerId ? s.selectedProviderModels[providerId] : undefined,
  );
  const engine = engineOfProvider(providerId);
  const claude =
    !engine && (!providerId || providerId === CLAUDE_CODE_PROVIDER_ID);

  // Claude's limits move with use elsewhere too (claude.ai, other
  // devices): looked up again when they're old, for free.
  useEffect(() => {
    if (!claude) return;
    const seen = useAiUsage.getState().claudeLimits?.observedAt ?? 0;
    if (Date.now() - seen > 10 * 60e3) {
      void useAiUsage.getState().refreshClaudeUsage();
    }
  }, [claude]);

  // ChatGPT's windows, as Codex last recorded them, once it's picked.
  useEffect(() => {
    if (engine === "codex") void useAiUsage.getState().refreshCodexLimits();
    // Copilot's month, as GitHub counts it.
    if (engine === "copilot") {
      void invoke("copilot_quota")
        .then((raw) => {
          const quota = copilotQuotaFrom(raw);
          if (quota) useAiUsage.getState().setCopilotQuota(quota);
        })
        .catch(() => {});
    }
  }, [engine]);

  const { measured } = useMemo(() => {
    const results = (tab?.messages ?? []).filter((m) => m.type === "result");
    return {
      measured: results
        .map((m) => ({ delta: m.windowDelta, window: m.window }))
        .filter(
          (m): m is { delta: number; window: string } =>
            typeof m.delta === "number",
        ),
    };
  }, [tab?.messages]);

  const now = Date.now();
  const windows: Window[] = [];
  if (claude && claudeLimits) {
    for (const [name, w] of [
      ["5h", claudeLimits.fiveHour],
      ["week", claudeLimits.sevenDay],
    ] as const) {
      if (w && w.resetsAt > now) {
        windows.push({ name, used: w.utilization * 100, resetsAt: w.resetsAt });
      }
    }
  }
  if (engine === "codex" && codexLimits) {
    for (const w of [codexLimits.primary, codexLimits.secondary]) {
      if (w && w.resetsAt > now) {
        windows.push({
          name: windowName(w.minutes),
          used: w.usedPercent,
          resetsAt: w.resetsAt,
        });
      }
    }
  }

  const copilotUsed =
    engine === "copilot" ? copilotUsedPercent(copilotQuota) : null;
  if (copilotUsed !== null && copilotQuota?.resetsAt) {
    windows.push({
      name: "month",
      used: copilotUsed,
      resetsAt: copilotQuota.resetsAt,
    });
  }

  // A free Gemini model's requests today, against its daily limit.
  const model = credentialModel || credential?.model;
  const daily =
    credential && model && isGoogleApi(credential.base_url)
      ? dailyLimit(model, learned)
      : null;
  const today = daily && model ? requestsToday(entries, model, now) : 0;

  // The weight is about the next message: not while one is running. The
  // limits stay in view throughout.
  if (!tab || (!windows.length && !daily)) return null;
  // The first window always (Claude's 5 hours), the others once filling up.
  const shown = windows.filter((w, i) => i === 0 || w.used >= 70);
  const chatTotal = measured.reduce((sum, m) => sum + m.delta, 0);
  const chatShare = (w: Window) =>
    measured.length && measured[0].window === w.name
      ? ` This chat has used about ${pct(chatTotal)}% of it.`
      : "";
  const windowHint = (w: Window) =>
    [
      `${limitName(w.name)}: ${pct(w.used)}% used. Resets ${resetAt(w.resetsAt, now)}.${chatShare(w)}`,
      engine === "copilot" && copilotQuota
        ? `${copilotQuota.remaining} of ${copilotQuota.entitlement} premium requests left.`
        : null,
      claude ? "Click to refresh." : null,
    ]
      .filter(Boolean)
      .join(" ");
  const dailyHint = daily
    ? `${today} of ${daily.known ? "" : "about "}${daily.limit} free requests used today. Each step of a reply counts as one. Resets ${resetAt(nextPacificDay(now), now)}.`
    : "";

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums">
      {shown.map((w, i) => (
        <button
          type="button"
          key={w.name}
          title={windowHint(w)}
          onClick={() => {
            if (claude) void useAiUsage.getState().refreshClaudeUsage();
          }}
          className={cn(
            // Narrow: the first window alone.
            i === 0 ? "flex" : "@[26rem]/bar:flex hidden",
            "items-center gap-1",
            claude && "cursor-pointer hover:underline",
            level(w.used),
          )}
        >
          <span className="relative @[20rem]/bar:block hidden h-1.5 w-8 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                w.used >= 90
                  ? "bg-red-500"
                  : w.used >= 70
                    ? "bg-amber-500"
                    : "bg-muted-foreground/50",
              )}
              style={{ width: `${Math.min(100, Math.max(2, w.used))}%` }}
            />
          </span>
          {w.name} {pct(w.used)}%
          <span className="@[32rem]/bar:inline hidden text-muted-foreground/70">
            · {timeLeft(w.resetsAt, now)} left
          </span>
        </button>
      ))}
      {daily && (
        <span className={level((today / daily.limit) * 100)} title={dailyHint}>
          Today {today}/{daily.known ? "" : "~"}
          {daily.limit}
        </span>
      )}
    </span>
  );
}
