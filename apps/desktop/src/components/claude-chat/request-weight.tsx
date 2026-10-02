import { useMemo } from "react";
import { resetsLabel } from "@/components/settings/ai-usage-settings";
import { engineOfProvider } from "@/lib/agent-events";
import { contextTokens, type ResultUsage, useAiUsage } from "@/lib/ai-usage";
import { estimateRequest, type Weight } from "@/lib/request-estimate";
import { cn } from "@/lib/utils";
import {
  billingOf,
  CLAUDE_CODE_PROVIDER_ID,
  resolveClaudeModel,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";

const STYLE: Record<Weight, { label: string; className: string }> = {
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
const pct = (n: number) =>
  n < 0.1 ? "<0.1" : n < 10 ? n.toFixed(1) : String(Math.round(n));

/**
 * Beside the send button: how heavy this message will be (light, medium,
 * heavy), and on a Claude plan, about what share of the 5-hour limit it
 * takes; the reasons on hover.
 */
export function RequestWeight({ input }: { input: string }) {
  const tab = useClaudeChatStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const selectedModel = useClaudeChatStore((s) => s.selectedModel);
  const providerId = useClaudeChatStore((s) => s.selectedProviderCredentialId);
  const entries = useAiUsage((s) => s.entries);
  const limits = useAiUsage((s) => s.claudeLimits);

  const est = useMemo(() => {
    const results = (tab?.messages ?? [])
      .filter((m) => m.type === "result")
      .map((m) => m as ResultUsage);
    const last = results[results.length - 1]?.usage;
    const lastContext = last
      ? contextTokens({
          input: last.input_tokens ?? 0,
          cacheRead: last.cache_read_input_tokens ?? 0,
          cacheWrite: last.cache_creation_input_tokens ?? 0,
        })
      : 0;
    const claude =
      (!providerId || providerId === CLAUDE_CODE_PROVIDER_ID) &&
      !engineOfProvider(providerId);
    return estimateRequest({
      entries,
      model: claude ? resolveClaudeModel(selectedModel, input) : "other",
      claude,
      lastContext,
      lastOutput: last?.output_tokens ?? 0,
      newTokens: Math.round(input.length / 4),
      recentSteps: results.slice(-3).map((r) => r.num_turns ?? 1),
      limits,
    });
  }, [tab?.messages, providerId, selectedModel, input, entries, limits]);

  if (!tab || tab.isStreaming || (est.tokens === 0 && !input.trim())) {
    return null;
  }
  const billing = billingOf(tab);
  const style = STYLE[est.weight];
  const detail =
    est.windowPct !== null
      ? `~${pct(est.windowPct)}% of 5h`
      : est.costUsd !== null && billing !== "plan"
        ? `~$${est.costUsd < 0.1 ? est.costUsd.toFixed(3) : est.costUsd.toFixed(2)}`
        : `~${k(est.tokens)}`;
  const why = [
    `Reads about ${k(est.tokens)} tokens: the chat so far${est.steps > 1 ? `, again at each of the ~${est.steps} steps requests take here,` : ""} and your message.`,
    est.windowPct !== null && est.windowUsed !== null && est.resetsAt
      ? `About ${pct(est.windowPct)}% of your 5-hour Claude limit, which is ${est.windowUsed}% used and resets ${resetsLabel(est.resetsAt)}.`
      : null,
    est.costUsd !== null && billing !== "plan"
      ? `About $${est.costUsd.toFixed(3)}, billed.`
      : null,
    est.weight !== "light" && est.tokens > 30_000
      ? "Most of it is the conversation: a new chat makes this much lighter."
      : null,
    "An estimate from your recent requests.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] tabular-nums",
        style.className,
      )}
      title={why}
    >
      {style.label} · {detail}
    </span>
  );
}
