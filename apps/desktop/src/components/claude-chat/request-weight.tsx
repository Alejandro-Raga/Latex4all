import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { engineOfProvider } from "@/lib/agent-events";
import {
  codexLimitsFrom,
  copilotQuotaFrom,
  copilotUsedPercent,
  lastCallContext,
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

type Weight = "light" | "medium" | "heavy";

/**
 * A chat's weight: what every message in it reads at the very least (the
 * conversation so far). Real requests cost more, by how many steps they
 * take, which can't be known beforehand; this part is certain.
 */
export function chatWeight(tokens: number): Weight {
  // Claude Code's instructions and tools alone are ~20k: that's light.
  return tokens < 50_000 ? "light" : tokens < 120_000 ? "medium" : "heavy";
}

const WEIGHT: Record<Weight, { label: string; className: string }> = {
  light: {
    label: "Light",
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
  },
  medium: {
    label: "Medium",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  heavy: {
    label: "Heavy",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
};

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
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
 * Beside the send button, what's known before sending: how heavy the chat
 * is, and how full the plan's window is (Claude, ChatGPT). What each reply
 * used is measured after it, under the reply.
 */
export function RequestWeight({ input }: { input: string }) {
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
    if (engine === "codex") {
      void invoke("codex_rate_limits", { threadId: null })
        .then((raw) => {
          const limits = codexLimitsFrom(raw);
          if (limits) useAiUsage.getState().setCodexLimits(limits);
        })
        .catch(() => {});
    }
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

  const { tokens, measured } = useMemo(() => {
    const messages = tab?.messages ?? [];
    const results = messages.filter((m) => m.type === "result");
    // One call's size; a request's total adds up all its steps.
    const last = lastCallContext(messages);
    return {
      tokens: last.context + last.output + Math.round(input.length / 4),
      measured: results
        .map((m) => ({ delta: m.windowDelta, window: m.window }))
        .filter(
          (m): m is { delta: number; window: string } =>
            typeof m.delta === "number",
        ),
    };
  }, [tab?.messages, input]);

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
  const showWeight = !tab?.isStreaming && (tokens > 0 || input.trim() !== "");
  if (!tab || (!showWeight && !windows.length && !daily)) return null;
  const weight = WEIGHT[chatWeight(tokens)];
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
  const weightHint = `Each message sends about ${k(tokens)} tokens.`;
  const dailyHint = daily
    ? `${today} of ${daily.known ? "" : "about "}${daily.limit} free requests used today. Each step of a reply counts as one. Resets ${resetAt(nextPacificDay(now), now)}.`
    : "";

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums">
      {showWeight && (
        <span
          className={cn(
            "@[26rem]/bar:inline hidden rounded-full px-2 py-0.5",
            weight.className,
          )}
          title={weightHint}
        >
          {weight.label} · {k(tokens)}/msg
        </span>
      )}
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
