import { describe, expect, it } from "vitest";
import type { AiUsageEntry } from "./ai-usage";
import { estimateRequest, modelFamily } from "./request-estimate";

const now = 1_700_000_000_000;
const entry = (over: Partial<AiUsageEntry>): AiUsageEntry => ({
  at: now - 3600e3,
  provider: "Claude",
  billing: "plan",
  model: "claude-sonnet-5",
  project: null,
  input: 2_000,
  output: 1_000,
  cacheRead: 40_000,
  cacheWrite: 2_000,
  costUsd: 0.05,
  turns: 3,
  durationMs: 0,
  ...over,
});

describe("how heavy the next request is", () => {
  it("tells the share of the 5-hour window, from the user's own use", () => {
    // Four requests at $0.05 filled 10% of the window: 1% ≈ $0.02.
    const entries = [1, 2, 3, 4].map(() => entry({}));
    const est = estimateRequest({
      entries,
      model: "sonnet",
      claude: true,
      lastContext: 44_000,
      lastOutput: 1_000,
      newTokens: 50,
      recentSteps: [3, 3],
      limits: {
        fiveHour: { utilization: 0.1, resetsAt: now + 3600e3 },
        status: "allowed",
        limitedUntil: null,
        limitType: "five_hour",
        observedAt: now,
      },
      now,
    });
    expect(est.windowUsed).toBe(10);
    expect(est.windowPct).not.toBeNull();
    expect(est.windowPct as number).toBeGreaterThan(0.5);
    expect(est.windowPct as number).toBeLessThan(5);
    expect(est.costUsd as number).toBeGreaterThan(0);
  });

  it("weighs by tokens with nothing to learn from", () => {
    const light = estimateRequest({
      entries: [],
      model: "deepseek-chat",
      claude: false,
      lastContext: 3_000,
      lastOutput: 200,
      newTokens: 40,
      recentSteps: [],
      limits: null,
    });
    expect(light.weight).toBe("light");
    expect(light.windowPct).toBeNull();
    const heavy = estimateRequest({
      entries: [],
      model: "x",
      claude: false,
      lastContext: 150_000,
      lastOutput: 2_000,
      newTokens: 100,
      recentSteps: [4],
      limits: null,
    });
    expect(heavy.weight).toBe("heavy");
  });

  it("groups models by family", () => {
    expect(modelFamily("claude-opus-5-5")).toBe("opus");
    expect(modelFamily("haiku")).toBe("haiku");
  });
});
