import { describe, expect, it } from "vitest";
import {
  calendarEntries,
  monthDays,
  shiftMonth,
  toIcs,
  weekDays,
} from "./calendar";
import { addMilestone, milestones } from "./milestones";
import { parsePlan, serializePlan, setProjectDue } from "./plan-file";
import { workTasks } from "./reading";

const PLAN = `# Paper

## To do

- [ ] Draft the intro 📅 2026-11-20 #writing
- [ ] No date
- [x] Done one 📅 2026-11-18 ✅ 2026-11-18

## Milestones

- [ ] First draft 📅 2026-12-01
`;

describe("milestones", () => {
  it("are their own section, apart from the tasks", () => {
    const plan = parsePlan(PLAN);
    expect(milestones(plan).map((m) => [m.task.title, m.task.due])).toEqual([
      ["First draft", "2026-12-01"],
    ]);
    expect(workTasks(plan).map((t) => t.task.title)).toEqual([
      "Draft the intro #writing",
      "No date",
      "Done one",
    ]);
  });

  it("are added under Milestones, made if missing", () => {
    const plan = addMilestone(
      parsePlan("# P\n\n## To do\n"),
      "Submission",
      "2027-01-15",
    );
    expect(serializePlan(plan)).toBe(
      "# P\n\n## To do\n\n## Milestones\n\n- [ ] Submission 📅 2027-01-15\n",
    );
  });
});

describe("calendar", () => {
  const plan = setProjectDue(parsePlan(PLAN), "2027-01-15");
  const entries = calendarEntries([
    { key: "project:/p", name: "Paper", plan, project: true },
  ]);

  it("gathers dated tasks, milestones and the deadline", () => {
    expect(entries.map((e) => [e.kind, e.date, e.title, e.done])).toEqual([
      ["task", "2026-11-20", "Draft the intro #writing", false],
      ["task", "2026-11-18", "Done one", true],
      ["milestone", "2026-12-01", "First draft", false],
      ["deadline", "2027-01-15", "Paper is due", false],
    ]);
  });

  it("lays out weeks from Monday, and six weeks a month", () => {
    expect(weekDays("2026-11-18")).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    const days = monthDays(2026, 10);
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-10-26");
    expect(days).toContain("2026-11-30");
    expect(shiftMonth("2026-11-18", 2)).toBe("2027-01-01");
  });

  it("writes an .ics calendar of what's not done, readable", () => {
    const ics = toIcs(entries, new Date("2026-11-17T10:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain(
      "DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121",
    );
    expect(ics).toContain("SUMMARY:Draft the intro (Paper)");
    expect(ics).toContain("SUMMARY:◆ First draft (Paper)");
    expect(ics).toContain("SUMMARY:Paper is due");
    expect(ics).not.toContain("Done one");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });
});
