import { describe, expect, it } from "vitest";
import { describeRule, nextOccurrence, parseRule, ruleText } from "./repeat";

describe("repeat rules", () => {
  it("read and write Obsidian's way", () => {
    for (const text of [
      "every day",
      "every 2 weeks",
      "every week on Monday, Wednesday, Friday",
      "every day until 2026-12-14",
      "every 3 months",
    ]) {
      const rule = parseRule(text);
      expect(rule, text).not.toBeNull();
      expect(ruleText(rule as never)).toBe(text);
    }
    expect(parseRule("every week on mon, fri")?.days).toEqual([1, 5]);
    expect(parseRule("someday")).toBeNull();
  });

  it("come back on the right day", () => {
    const n = (from: string, text: string) =>
      nextOccurrence(from, parseRule(text) as never);
    expect(n("2026-11-17", "every day")).toBe("2026-11-18");
    expect(n("2026-11-17", "every 2 weeks")).toBe("2026-12-01");
    expect(n("2026-01-31", "every month")).toBe("2026-02-28");
    // Tuesday 17: Wednesday, then Friday, then next Monday.
    expect(n("2026-11-17", "every week on Monday, Wednesday, Friday")).toBe(
      "2026-11-18",
    );
    expect(n("2026-11-20", "every week on Monday, Wednesday, Friday")).toBe(
      "2026-11-23",
    );
    expect(n("2026-11-20", "every 2 weeks on Monday, Friday")).toBe(
      "2026-11-30",
    );
    // Four weeks of days, then it stops.
    expect(n("2026-12-13", "every day until 2026-12-14")).toBe("2026-12-14");
    expect(n("2026-12-14", "every day until 2026-12-14")).toBeNull();
  });

  it("say what they do", () => {
    expect(
      describeRule(
        parseRule(
          "every week on Monday, Tuesday, Wednesday, Thursday, Friday",
        ) as never,
      ),
    ).toBe("Every week on weekdays");
    expect(describeRule(parseRule("every 2 weeks on Monday") as never)).toBe(
      "Every 2 weeks on Mon",
    );
  });
});
