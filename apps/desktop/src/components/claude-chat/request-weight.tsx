import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resetsLabel } from "@/components/settings/ai-usage-settings";
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

  if (
    !tab ||
    tab.isStreaming ||
    (tokens === 0 && !input.trim() && !windows.length && !daily)
  ) {
    return null;
  }
  const weight = WEIGHT[chatWeight(tokens)];
  const main = windows[0];
  const chatTotal = measured.reduce((sum, m) => sum + m.delta, 0);
  const deltas = measured.map((m) => m.delta).sort((a, b) => a - b);
  const why = [
    `Each message sends at least ~${k(tokens)} tokens (the conversation so far). Edits send it again at each step. A new chat starts lighter.`,
    ...windows.map(
      (w) =>
        `${w.name} limit: ${pct(w.used)}% used, resets ${resetsLabel(w.resetsAt)}.`,
    ),
    measured.length
      ? `This chat so far: ~${pct(chatTotal)}% of the ${measured[0].window} limit${
          deltas.length > 1
            ? `; its replies used ${pct(deltas[0])}–${pct(deltas[deltas.length - 1])}% each`
            : ""
        } (measured).`
      : null,
    engine === "gemini" ? "Gemini doesn't report its limits to apps." : null,
    copilotUsed !== null && copilotQuota
      ? `Copilot: ${copilotQuota.remaining} of ${copilotQuota.entitlement} premium requests left this month. Each message uses at least one.`
      : null,
    daily
      ? `Today: ${today} of ${daily.known ? "" : "about "}${daily.limit} free requests to ${model}${daily.known ? "" : " (Google confirms the number when it's reached)"}. One message takes a request per step. Resets ${resetsLabel(nextPacificDay(now))}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className="flex items-center gap-1.5 text-[11px] tabular-nums"
      title={why}
    >
      <span className={cn("rounded-full px-2 py-0.5", weight.className)}>
        {weight.label} · {k(tokens)}/msg
      </span>
      {main && (
        <span className={level(main.used)}>
          {main.name} {pct(main.used)}%
        </span>
      )}
      {daily && (
        <span className={level((today / daily.limit) * 100)}>
          Today {today}/{daily.known ? "" : "~"}
          {daily.limit}
        </span>
      )}
    </span>
  );
}
