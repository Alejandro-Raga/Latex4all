import { describe, expect, it } from "vitest";
import {
  parseClaudeUsage,
  parseResetTime,
  lastCallContext,
  codexLimitsFrom,
  windowName,
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
    const a = usageEntry(result, "/p/Thesis", "opus", 100, "Claude", "api");
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

describe("what costs money", () => {
  it("prices only requests outside a plan", () => {
    const plan = usageEntry(result, null, "opus", 1, "Claude", "plan");
    const extra = usageEntry(result, null, "opus", 2, "Claude", "extra");
    const key = usageEntry(result, null, "opus", 3, "Claude", "api");
    // Logged before billing was kept: a Claude sign-in, so a plan.
    const old = usageEntry(result, null, "opus", 4, "Claude");
    expect(entryCost(plan)).toBe(0);
    expect(entryCost(old)).toBe(0);
    expect(entryCost(extra)).toBeCloseTo(0.42);
    expect(entryCost(key)).toBeCloseTo(0.42);
    const s = summarize([plan, extra, key, old], 0);
    expect(s.requests).toBe(4);
    expect(s.costUsd).toBeCloseTo(0.84);
  });

  it("notes when Claude is on extra usage", () => {
    const l = nextLimits(null, { status: "allowed", isUsingOverage: true }, 0);
    expect(l.usingOverage).toBe(true);
  });
});

describe("ChatGPT's plan windows", () => {
  it("reads Codex's record and names its windows", () => {
    const l = codexLimitsFrom(
      {
        primary: { used_percent: 12.5, window_minutes: 300, resets_at: 100 },
        secondary: { used_percent: 3, window_minutes: 10080, resets_at: 200 },
        plan_type: "plus",
      },
      0,
    );
    expect(l?.primary).toEqual({
      usedPercent: 12.5,
      minutes: 300,
      resetsAt: 100000,
    });
    expect(l?.plan).toBe("plus");
    expect(windowName(300)).toBe("5h");
    expect(windowName(10080)).toBe("week");
    expect(windowName(43200)).toBe("month");
    expect(codexLimitsFrom(null)).toBeNull();
  });
});

describe("a chat's size", () => {
  it("is what one call reads, not the request's total over its steps", () => {
    const step = (cacheRead: number) => ({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 500,
          cache_read_input_tokens: cacheRead,
          output_tokens: 100,
        },
      },
    });
    const messages = [
      { type: "user", message: { content: [{ type: "text" }] } },
      step(30_000),
      { type: "user", message: { content: [{ type: "tool_result" }] } },
      step(32_000),
      {
        type: "result",
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 262_000,
          output_tokens: 200,
        },
      },
    ];
    expect(lastCallContext(messages).context).toBe(32_500);
  });

  it("divides a total by the steps when calls don't say", () => {
    const messages = [
      { type: "user", message: { content: [{ type: "text" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use" }] } },
      { type: "assistant", message: { content: [{ type: "text" }] } },
      { type: "result", usage: { input_tokens: 60_000, output_tokens: 10 } },
    ];
    expect(lastCallContext(messages).context).toBe(30_000);
  });
});

describe("Claude Code's /usage", () => {
  const text =
    "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 3% used · resets Oct 3 at 2am (Europe/Madrid)\nCurrent week (all models): 29% used · resets Oct 8 at 7pm (Europe/Madrid)\n\nWhat's contributing…";

  it("reads both windows and when they reset", () => {
    const now = new Date(2026, 9, 2, 21, 30);
    const usage = parseClaudeUsage(text, now);
    expect(usage?.fiveHour?.utilization).toBeCloseTo(0.03);
    expect(new Date(usage?.fiveHour?.resetsAt ?? 0)).toEqual(
      new Date(2026, 9, 3, 2, 0),
    );
    expect(usage?.sevenDay?.utilization).toBeCloseTo(0.29);
    expect(new Date(usage?.sevenDay?.resetsAt ?? 0)).toEqual(
      new Date(2026, 9, 8, 19, 0),
    );
  });

  it("reads a time alone as the next one, and a date into next year", () => {
    const now = new Date(2026, 11, 31, 22, 0);
    expect(new Date(parseResetTime("7:30pm", now) ?? 0)).toEqual(
      new Date(2027, 0, 1, 19, 30),
    );
    expect(new Date(parseResetTime("Jan 2 at 1am", now) ?? 0)).toEqual(
      new Date(2027, 0, 2, 1, 0),
    );
  });

  it("is null without plan limits", () => {
    expect(parseClaudeUsage("You are using an API key")).toBeNull();
  });
});
