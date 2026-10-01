import { describe, expect, it } from "vitest";
import {
  claudeLimited,
  entryCost,
  nextLimits,
  summarize,
  usageEntry,
} from "./ai-usage";

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
      provider: "Claude",
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

describe("Claude's plan limits", () => {
  const now = 1_700_000_000_000;
  it("reads both windows from a rate limit event", () => {
    const l = nextLimits(
      null,
      {
        status: "allowed_warning",
        rateLimitType: "five_hour",
        unifiedWindows: {
          five_hour: { utilization: 0.82, resetsAt: now / 1000 + 3600 },
          seven_day: { utilization: 0.31, resetsAt: now / 1000 + 86400 },
        },
      },
      now,
    );
    expect(l.fiveHour).toEqual({
      utilization: 0.82,
      resetsAt: now + 3_600_000,
    });
    expect(l.sevenDay?.utilization).toBe(0.31);
    expect(claudeLimited(l, now)).toBe(false);
  });

  it("knows when Claude refuses, and until when", () => {
    const l = nextLimits(
      null,
      {
        status: "rejected",
        rateLimitType: "five_hour",
        resetsAt: now / 1000 + 600,
        utilization: 1,
      },
      now,
    );
    expect(l.fiveHour).toEqual({ utilization: 1, resetsAt: now + 600_000 });
    expect(claudeLimited(l, now)).toBe(true);
    expect(claudeLimited(l, now + 700_000)).toBe(false);
    // A later event that doesn't mention a window keeps it until it resets.
    const later = nextLimits(l, { status: "allowed" }, now + 1000);
    expect(later.fiveHour?.utilization).toBe(1);
    expect(claudeLimited(later, now + 1000)).toBe(false);
  });

  it("prices only Claude", () => {
    const e = usageEntry(
      { total_cost_usd: 1 },
      null,
      "deepseek-chat",
      0,
      "DeepSeek",
    );
    expect(e.costUsd).toBeNull();
    expect(summarize([e], 0).byModel[0].model).toBe("DeepSeek · deepseek-chat");
  });
});

describe("prices for other services", () => {
  it("costs a request from the prices set, per million tokens", () => {
    const e = usageEntry(
      { usage: { input_tokens: 2_000_000, output_tokens: 500_000 } },
      null,
      "gpt-5",
      0,
      "OpenAI",
    );
    const prices = { OpenAI: { input: 1.25, output: 10 } };
    expect(entryCost(e, prices)).toBeCloseTo(7.5);
    expect(entryCost(e)).toBe(0);
    const s = summarize([e], 0, prices);
    expect(s.costUsd).toBeCloseTo(7.5);
    expect(s.byService).toEqual([
      { service: "OpenAI", requests: 1, costUsd: 7.5 },
    ]);
  });
});
