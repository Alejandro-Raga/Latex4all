import { describe, expect, it } from "vitest";
import type { AiUsageEntry } from "./ai-usage";
import {
  dailyLimit,
  pacificDayStart,
  parseQuota,
  quotaMessage,
  requestsToday,
} from "./provider-quota";

const entry = (at: number, model: string, turns: number) =>
  ({ at, model, turns }) as AiUsageEntry;

describe("free-tier daily limits", () => {
  it("reads the quota the proxy passes on", () => {
    const text =
      'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit: models/gemini-3.8-flash has used its requests for today. [quota day=20 model=gemini-3.8-flash retry=34]"}}';
    expect(parseQuota(text)).toEqual({
      period: "day",
      limit: 20,
      model: "gemini-3.8-flash",
      retrySecs: 34,
    });
    expect(parseQuota("[quota minute= model=models/x]")).toEqual({
      period: "minute",
      limit: null,
      model: "x",
      retrySecs: null,
    });
    expect(parseQuota("429 Too Many Requests")).toBeNull();
  });

  it("guesses until Google says, then keeps what it said", () => {
    expect(dailyLimit("models/gemini-3.5-flash-lite", {})).toEqual({
      limit: 500,
      known: false,
    });
    expect(dailyLimit("gemini-3.8-flash", {})).toEqual({
      limit: 20,
      known: false,
    });
    expect(dailyLimit("gemini-3.8-flash", { "gemini-3.8-flash": 25 })).toEqual({
      limit: 25,
      known: true,
    });
    expect(dailyLimit("gemma-4-31b-it", {})).toBeNull();
  });

  it("counts each step since midnight Pacific", () => {
    const now = Date.UTC(2026, 9, 2, 18, 0, 0); // 11:00 in California
    const start = pacificDayStart(now);
    expect(new Date(start).toISOString()).toBe("2026-10-02T07:00:00.000Z");
    const entries = [
      entry(start - 1000, "gemini-3.8-flash", 5),
      entry(start + 1000, "models/gemini-3.8-flash", 3),
      entry(start + 2000, "gemini-3.8-flash", 0),
      entry(start + 3000, "gemini-3.5-flash-lite", 4),
    ];
    expect(requestsToday(entries, "gemini-3.8-flash", now)).toBe(4);
  });

  it("says which limit ran out", () => {
    expect(
      quotaMessage("Gemini", {
        period: "day",
        limit: 20,
        model: "gemini-3.8-flash",
        retrySecs: null,
      }),
    ).toMatch(/used its 20 free requests for today.*Flash-Lite/);
  });
});
