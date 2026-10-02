import { describe, expect, it } from "vitest";
import { useAiUsage } from "@/lib/ai-usage";
import { planWindowNow } from "@/stores/claude-chat-store";
import { chatWeight } from "./request-weight";

describe("what's known before sending", () => {
  it("weighs a chat by what every message reads at least", () => {
    expect(chatWeight(25_000)).toBe("light");
    expect(chatWeight(80_000)).toBe("medium");
    expect(chatWeight(150_000)).toBe("heavy");
  });

  it("notes the plan window a request counts against", () => {
    useAiUsage.setState({
      claudeLimits: {
        fiveHour: { utilization: 0.42, resetsAt: 9e12 },
        status: "allowed",
        limitedUntil: null,
        limitType: "five_hour",
        observedAt: 0,
      },
      codexLimits: {
        primary: { usedPercent: 12.5, minutes: 300, resetsAt: 8e12 },
        plan: "plus",
        observedAt: 0,
      },
    });
    expect(planWindowNow(null)).toEqual({
      service: "claude",
      used: 42,
      resetsAt: 9e12,
    });
    expect(planWindowNow("__codex__")).toEqual({
      service: "codex",
      used: 12.5,
      resetsAt: 8e12,
    });
    // A service with a key, or Gemini: no window to measure against.
    expect(planWindowNow("deepseek-1")).toBeNull();
    expect(planWindowNow("__gemini__")).toBeNull();
  });
});
