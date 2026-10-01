import { describe, expect, it } from "vitest";
import { summarize, usageEntry } from "./ai-usage";

const result = {
  type: "result",
  total_cost_usd: 0.42,
  num_turns: 3,
  duration_ms: 12000,
  usage: {
    input_tokens: 1200,
    output_tokens: 800,
    cache_read_input_tokens: 40000,
    cache_creation_input_tokens: 5000,
  },
  modelUsage: { "claude-opus-5-5": {} },
};

describe("AI usage", () => {
  it("reads a request's usage from its result", () => {
    expect(usageEntry(result, "/p/Thesis", "opus", 1000)).toEqual({
      at: 1000,
      model: "claude-opus-5-5",
      project: "/p/Thesis",
      input: 1200,
      output: 800,
      cacheRead: 40000,
      cacheWrite: 5000,
      costUsd: 0.42,
      turns: 3,
      durationMs: 12000,
    });
    // A provider that reports no cost.
    expect(
      usageEntry({ usage: { input_tokens: 5 } }, null, "gpt").costUsd,
    ).toBeNull();
  });

  it("sums a period, by model and by project", () => {
    const a = usageEntry(result, "/p/Thesis", "opus", 100);
    const b = { ...a, at: 200, model: "claude-sonnet-5", costUsd: 0.08 };
    const old = { ...a, at: 10 };
    const s = summarize([old, a, b], 50);
    expect(s.requests).toBe(2);
    expect(s.costUsd).toBeCloseTo(0.5);
    expect(s.cacheRead).toBe(80000);
    expect(s.byModel.map((m) => m.model)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5",
    ]);
    expect(s.byProject).toEqual([
      { project: "/p/Thesis", requests: 2, costUsd: 0.5 },
    ]);
  });
});
