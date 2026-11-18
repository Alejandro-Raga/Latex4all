import { describe, expect, it } from "vitest";
import { scaleFor, unitFor } from "./time-scale";

describe("a timeline's scale", () => {
  it("goes from years to days as it's zoomed in", () => {
    expect(unitFor(0.2)).toBe("year");
    expect(unitFor(0.5)).toBe("quarter");
    expect(unitFor(2)).toBe("month");
    expect(unitFor(8)).toBe("week");
    expect(unitFor(30)).toBe("day");
  });

  it("shows months under years for a year at a normal width", () => {
    const s = scaleFor("2027-01-01", "2027-12-31", 800);
    expect(s.unit).toBe("month");
    expect(s.major.map((t) => t.label)).toEqual(["2027"]);
    expect(s.minor).toHaveLength(12);
  });

  it("shows weeks (from Mondays) under months for two months", () => {
    const s = scaleFor("2027-03-01", "2027-04-30", 800);
    expect(s.unit).toBe("week");
    expect(
      s.minor.every((t) => new Date(`${t.date}T00:00`).getDay() === 1),
    ).toBe(true);
    expect(s.major.length).toBe(2);
  });

  it("shows every day, weekends marked, for a few weeks", () => {
    const s = scaleFor("2027-03-01", "2027-03-21", 800);
    expect(s.unit).toBe("day");
    expect(s.minor).toHaveLength(21);
    expect(s.minor.filter((t) => t.weekend)).toHaveLength(6);
    expect(s.minor[0].label).toBe("1");
  });
});
