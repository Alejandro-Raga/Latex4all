import { describe, expect, it } from "vitest";
import {
  addSection,
  deleteSection,
  nestTask,
  promoteSubtask,
  addTask,
  allTasks,
  deleteTask,
  moveTask,
  newPlanText,
  parsePlan,
  serializePlan,
  tagsOf,
  toggleSubtask,
  toggleTask,
  updateTask,
} from "./plan-file";

const SAMPLE = `---
project: paper 2
---
# Plan

Some words about the plan.

## To do

- [ ] Draft the discussion ⏫ 📅 2026-11-20 #writing
    - [ ] Compare with [[Cohen1990]]
    - [x] Outline it
    Notes under it.
- [x] Send the outline 📅 2026-11-10 ✅ 2026-11-14

## Waiting

- [ ] Comments from María 🔁 every week
`;

describe("parsePlan / serializePlan", () => {
  it("reads tasks, their dates, priority, subtasks and notes", () => {
    const plan = parsePlan(SAMPLE);
    const tasks = allTasks(plan);
    expect(tasks.map((t) => t.task.title)).toEqual([
      "Draft the discussion #writing",
      "Send the outline",
      "Comments from María 🔁 every week",
    ]);
    const [first, second] = tasks.map((t) => t.task);
    expect(first).toMatchObject({
      priority: 3,
      due: "2026-11-20",
      done: false,
    });
    expect(first.subtasks.map((s) => [s.title, s.done])).toEqual([
      ["Compare with [[Cohen1990]]", false],
      ["Outline it", true],
    ]);
    expect(first.notes).toEqual(["    Notes under it."]);
    expect(second).toMatchObject({ done: true, doneOn: "2026-11-14" });
    expect(tasks.map((t) => t.section)).toEqual(["To do", "To do", "Waiting"]);
  });

  it("writes back what it read, unknown lines and all", () => {
    expect(serializePlan(parsePlan(SAMPLE))).toBe(SAMPLE);
  });

  it("starts a plan with three sections", () => {
    const plan = parsePlan(newPlanText("Paper 2"));
    expect(plan.sections.map((s) => s.title)).toEqual([
      null,
      "To do",
      "In progress",
      "Waiting",
    ]);
  });
});

describe("changes", () => {
  it("adds a task at the end of the first section, spaced as by hand", () => {
    const plan = addTask(parsePlan(newPlanText("P")), {
      title: "Read Cohen",
      due: "2026-11-18",
      priority: 2,
    });
    expect(serializePlan(plan)).toBe(
      "# P\n\n## To do\n\n- [ ] Read Cohen 🔼 📅 2026-11-18\n\n## In progress\n\n## Waiting\n",
    );
    const again = addTask(plan, { title: "Second" });
    expect(serializePlan(again)).toContain(
      "- [ ] Read Cohen 🔼 📅 2026-11-18\n- [ ] Second\n\n## In progress",
    );
  });

  it("adds to a chosen section", () => {
    const plan = parsePlan(newPlanText("P"));
    const next = addTask(plan, { title: "Later" }, 3);
    expect(serializePlan(next)).toBe(
      "# P\n\n## To do\n\n## In progress\n\n## Waiting\n\n- [ ] Later\n",
    );
  });

  it("checks a task off with today's date, and back", () => {
    const plan = parsePlan(SAMPLE);
    const ref = allTasks(plan)[0].ref;
    const done = toggleTask(plan, ref, new Date("2026-11-16T10:00:00"));
    // Its line as written, the box ticked and the date added.
    expect(serializePlan(done)).toContain(
      "- [x] Draft the discussion ⏫ 📅 2026-11-20 #writing ✅ 2026-11-16",
    );
    const undone = toggleTask(done, ref);
    // Back as it was written.
    expect(serializePlan(undone)).toContain(
      "- [ ] Draft the discussion ⏫ 📅 2026-11-20 #writing\n",
    );
  });

  it("checks a subtask off", () => {
    const plan = parsePlan(SAMPLE);
    const next = toggleSubtask(plan, allTasks(plan)[0].ref, 0);
    expect(serializePlan(next)).toContain(
      "    - [x] Compare with [[Cohen1990]]",
    );
  });

  it("edits, deletes and moves tasks between sections", () => {
    const plan = parsePlan(SAMPLE);
    const [a, , c] = allTasks(plan);
    const edited = updateTask(plan, a.ref, { due: undefined, priority: 0 });
    expect(serializePlan(edited)).toContain(
      "- [ ] Draft the discussion #writing\n    - [ ] Compare",
    );
    const gone = deleteTask(plan, a.ref);
    expect(allTasks(gone).map((t) => t.task.title)).toEqual([
      "Send the outline",
      "Comments from María 🔁 every week",
    ]);
    // To "Waiting", before its task: subtasks and notes go with it.
    const moved = moveTask(plan, a.ref, c.ref.section, c.ref.item);
    const after = allTasks(moved);
    expect(after.map((t) => [t.task.title, t.section])).toEqual([
      ["Send the outline", "To do"],
      ["Draft the discussion #writing", "Waiting"],
      ["Comments from María 🔁 every week", "Waiting"],
    ]);
    expect(serializePlan(moved)).toContain(
      "## Waiting\n\n- [ ] Draft the discussion ⏫ 📅 2026-11-20 #writing\n    - [ ] Compare",
    );
  });

  it("moves within a section", () => {
    const plan = parsePlan(SAMPLE);
    const [a, b] = allTasks(plan);
    const moved = moveTask(plan, b.ref, a.ref.section, a.ref.item);
    expect(
      allTasks(moved)
        .map((t) => t.task.title)
        .slice(0, 2),
    ).toEqual(["Send the outline", "Draft the discussion #writing"]);
  });

  it("adds a section at the end", () => {
    const plan = addSection(parsePlan(newPlanText("P")), "Revisions");
    expect(serializePlan(plan)).toBe(
      "# P\n\n## To do\n\n## In progress\n\n## Waiting\n\n## Revisions\n",
    );
  });
});

it("finds tags, as Obsidian does", () => {
  expect(tagsOf("Draft #writing and #paper-2/intro, not a#b")).toEqual([
    "writing",
    "paper-2/intro",
  ]);
});

describe("headings and subtasks", () => {
  it("deletes a heading, its tasks kept under the one before", () => {
    const plan = parsePlan(SAMPLE);
    const next = deleteSection(plan, 2);
    expect(next.sections.map((s) => s.title)).toEqual([null, "To do"]);
    expect(allTasks(next).map((t) => [t.task.title, t.section])).toEqual([
      ["Draft the discussion #writing", "To do"],
      ["Send the outline", "To do"],
      ["Comments from María 🔁 every week", "To do"],
    ]);
  });

  it("nests a task under another, and back out", () => {
    const plan = parsePlan(SAMPLE);
    const [a, b] = allTasks(plan);
    const nested = nestTask(plan, b.ref, a.ref);
    expect(allTasks(nested).map((t) => t.task.title)).toEqual([
      "Draft the discussion #writing",
      "Comments from María 🔁 every week",
    ]);
    expect(serializePlan(nested)).toContain(
      "    - [x] Outline it\n    - [x] Send the outline 📅 2026-11-10 ✅ 2026-11-14\n    Notes under it.",
    );
    const out = promoteSubtask(nested, a.ref, 2);
    expect(allTasks(out).map((t) => t.task.title)).toEqual([
      "Draft the discussion #writing",
      "Send the outline",
      "Comments from María 🔁 every week",
    ]);
  });
});
