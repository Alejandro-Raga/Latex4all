import { describe, expect, it } from "vitest";
import { parsePlan } from "./plan-file";
import { gather, lanesOf } from "./task-lanes";

describe("tasks on a timeline", () => {
  it("are in one lane per section, milestones and done tasks left out", () => {
    const plan = parsePlan(
      [
        "# P",
        "",
        "## To do",
        "",
        "- [ ] Reply 📅 2027-02-01",
        "- [x] Done already 📅 2027-01-01",
        "- [ ] Undated",
        "",
        "## Chapter 2 📅 2027-03-01",
        "",
        "- [ ] Section 2.1 📅 2027-02-20",
        "",
        "## Milestones",
        "",
        "- [ ] Submission 📅 2027-06-01",
        "",
      ].join("\n"),
    );
    const lanes = lanesOf(plan, (t) => t);
    expect(lanes.map((l) => l.name)).toEqual(["To do", "Chapter 2"]);
    expect(lanes[0].tasks.map((t) => t.title)).toEqual(["Reply"]);
    expect(lanes[1].due).toBe("2027-03-01");
  });

  it("gathers tasks too close to tell apart", () => {
    const groups = gather([
      { x: 0 },
      { x: 5 },
      { x: 10 },
      { x: 100 },
      { x: 200 },
    ]);
    expect(groups.map((g) => g.items.length)).toEqual([3, 1, 1]);
    expect(groups[0].x).toBe(5);
  });
});
