/**
 * How heavy the next request will be, before it's sent: light, medium or
 * heavy, and for a Claude plan, about what share of the 5-hour limit it
 * takes. Learned from the user's own requests, so no prices are assumed:
 *
 * - Claude Code reports each request's cost at API prices (even on a plan,
 *   where it isn't billed), and Claude how full its 5-hour window is. What
 *   this window's requests "cost", over the share used, is what 1% costs.
 * - The next request: the chat so far read again (mostly from the cache)
 *   once per step it usually takes, the new text, and a usual-length reply.
 */
import type { AiUsageEntry, ClaudeLimits } from "@/lib/ai-usage";

export type Weight = "light" | "medium" | "heavy";

export interface RequestEstimate {
  /** Tokens it will read, roughly. */
  tokens: number;
  /** Its cost at API prices, when the model's rate is known. */
  costUsd: number | null;
  /** The share of the 5-hour limit it takes, when that can be told. */
  windowPct: number | null;
  /** How full the 5-hour window is now, 0–100. */
  windowUsed: number | null;
  resetsAt: number | null;
  weight: Weight;
  /** Steps a request here usually takes (each reads the chat again). */
  steps: number;
}

const FIVE_HOURS = 5 * 3600e3;
/** Claude's price ratios: cache writes 1.25×, cache reads 0.1×, output 5×. */
const weighted = (
  e: Pick<AiUsageEntry, "input" | "cacheRead" | "cacheWrite" | "output">,
) => e.input + e.cacheWrite * 1.25 + e.cacheRead * 0.1 + e.output * 5;

/** "claude-sonnet-5-…" → "sonnet": requests of a family cost alike. */
export function modelFamily(model: string): string {
  const m = model.toLowerCase();
  for (const f of ["haiku", "sonnet", "opus"]) if (m.includes(f)) return f;
  return m;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function estimateRequest(input: {
  entries: AiUsageEntry[];
  /** Model of the next request ("sonnet", or a full name). */
  model: string;
  /** Claude, or another service (no window, no learned rate). */
  claude: boolean;
  /** What the chat's last request read in all. */
  lastContext: number;
  /** Its last reply's length, read again as new text. */
  lastOutput: number;
  /** What's typed, in tokens. */
  newTokens: number;
  /** Steps this chat's requests took lately (empty: none yet). */
  recentSteps: number[];
  limits: ClaudeLimits | null;
  now?: number;
}): RequestEstimate {
  const now = input.now ?? Date.now();
  const family = modelFamily(input.model);
  const steps = Math.max(1, Math.min(8, median(input.recentSteps) ?? 2));
  const output = 800;
  const tokens = input.lastContext + input.newTokens + input.lastOutput;

  // The model's rate, from the user's own requests: cost per weighted token.
  const priced = input.entries.filter(
    (e) =>
      e.costUsd !== null &&
      e.costUsd > 0 &&
      (e.provider ?? "Claude") === "Claude" &&
      modelFamily(e.model) === family,
  );
  const rate = median(
    priced
      .slice(-30)
      .map((e) => (e.costUsd as number) / Math.max(1, weighted(e))),
  );
  const nextWeighted =
    steps * input.lastContext * 0.1 +
    (input.newTokens + input.lastOutput) * 1.25 +
    output * 5;
  const costUsd = input.claude && rate !== null ? rate * nextWeighted : null;

  // What 1% of the 5-hour window costs: this window's requests over its use.
  let windowPct: number | null = null;
  const w = input.limits?.fiveHour;
  const live = w && w.resetsAt > now ? w : null;
  if (input.claude && live && costUsd !== null && live.utilization >= 0.02) {
    const since = live.resetsAt - FIVE_HOURS;
    const spent = input.entries
      .filter(
        (e) =>
          e.at >= since &&
          (e.provider ?? "Claude") === "Claude" &&
          e.billing !== "api",
      )
      .reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
    if (spent > 0) windowPct = (costUsd / spent) * live.utilization * 100;
  }

  const weight: Weight =
    windowPct !== null
      ? windowPct < 0.5
        ? "light"
        : windowPct < 2
          ? "medium"
          : "heavy"
      : costUsd !== null
        ? costUsd < 0.03
          ? "light"
          : costUsd < 0.2
            ? "medium"
            : "heavy"
        : tokens * steps < 40_000
          ? "light"
          : tokens * steps < 200_000
            ? "medium"
            : "heavy";

  return {
    tokens,
    costUsd,
    windowPct,
    windowUsed: live ? Math.round(live.utilization * 100) : null,
    resetsAt: live?.resetsAt ?? null,
    weight,
    steps,
  };
}
