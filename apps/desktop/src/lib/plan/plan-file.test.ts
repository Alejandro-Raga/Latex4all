import { describe, expect, it } from "vitest";
import {
  addSection,
  deleteSection,
  nestTask,
  projectDue,
  promoteSubtask,
  setProjectDue,
  addTask,
  allTasks,
  deleteTask,
  moveTask,
  newPlanText,
  childRef,
  taskAt,
  sectionDue,
  sectionName,
  withSectionDue,
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

  it("starts a plan with its title and no sections", () => {
    const plan = parsePlan(newPlanText("Paper 2"));
    expect(plan.sections.map((s) => s.title)).toEqual([null]);
    // A task then goes under the title.
    expect(serializePlan(addTask(plan, { title: "First" }))).toBe(
      "# Paper 2\n\n- [ ] First\n",
    );
  });

  it("keeps a section's date in its heading", () => {
    expect(sectionName("Draft 📅 2026-12-01")).toBe("Draft");
    expect(sectionDue("Draft 📅 2026-12-01")).toBe("2026-12-01");
    expect(sectionDue("Draft")).toBeUndefined();
    expect(withSectionDue("Draft 📅 2026-12-01", "2027-01-02")).toBe(
      "Draft 📅 2027-01-02",
    );
    expect(withSectionDue("Draft 📅 2026-12-01")).toBe("Draft");
  });
});

describe("changes", () => {
  it("adds a task at the end of the first section, spaced as by hand", () => {
    const plan = addTask(parsePlan(threeSections("P")), {
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
    const plan = parsePlan(threeSections("P"));
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
    const plan = addSection(parsePlan(threeSections("P")), "Revisions");
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

describe("the project's deadline", () => {
  it("is the plan's due property, set, changed and taken away", () => {
    const plan = parsePlan(threeSections("P"));
    expect(projectDue(plan)).toBeUndefined();
    const set = setProjectDue(plan, "2026-12-15");
    expect(serializePlan(set)).toBe(
      "---\ndue: 2026-12-15\n---\n# P\n\n## To do\n\n## In progress\n\n## Waiting\n",
    );
    expect(projectDue(set)).toBe("2026-12-15");
    const moved = setProjectDue(set, "2027-01-10");
    expect(projectDue(moved)).toBe("2027-01-10");
    expect(serializePlan(setProjectDue(moved, undefined))).toBe(
      serializePlan(plan),
    );
  });

  it("keeps the other properties", () => {
    const plan = parsePlan(SAMPLE);
    const set = setProjectDue(plan, "2026-12-15");
    expect(serializePlan(set)).toMatch(
      /^---\nproject: paper 2\ndue: 2026-12-15\n---\n/,
    );
    expect(serializePlan(setProjectDue(set, undefined))).toBe(SAMPLE);
  });
});

function threeSections(name: string) {
  return `# ${name}\n\n## To do\n\n## In progress\n\n## Waiting\n`;
}

describe("nested subtasks", () => {
  const TEXT = `# P

## To do

- [ ] Write the paper 📅 2027-01-10
    - [ ] Draft the intro 📅 2026-12-01
        - [ ] Find the opening quote
            - [x] Ask María ✅ 2026-11-15
            A note on the quote.
    - [ ] Methods
`;

  it("are read at any depth, each with its own date, and written back as they were", () => {
    const plan = parsePlan(TEXT);
    const ref = { section: 1, item: 1 };
    const top = taskAt(plan, ref);
    expect(top?.subtasks.map((s) => s.title)).toEqual([
      "Draft the intro",
      "Methods",
    ]);
    const intro = taskAt(plan, childRef(ref, 0));
    expect(intro?.due).toBe("2026-12-01");
    const quote = taskAt(plan, { ...ref, path: [0, 0] });
    expect(quote?.title).toBe("Find the opening quote");
    expect(quote?.notes).toEqual(["            A note on the quote."]);
    expect(taskAt(plan, { ...ref, path: [0, 0, 0] })?.done).toBe(true);
    expect(serializePlan(plan)).toBe(TEXT);
  });

  it("are changed, checked off and taken out where they are", () => {
    const plan = parsePlan(TEXT);
    const deep = { section: 1, item: 1, path: [0, 0] };
    const dated = updateTask(plan, deep, { due: "2026-11-30" });
    expect(serializePlan(dated)).toContain(
      "        - [ ] Find the opening quote 📅 2026-11-30\n",
    );
    const done = toggleTask(plan, deep, new Date("2026-11-17T12:00:00"));
    expect(serializePlan(done)).toContain(
      "        - [x] Find the opening quote ✅ 2026-11-17\n",
    );
    const gone = deleteTask(plan, deep);
    expect(serializePlan(gone)).not.toContain("opening quote");
    expect(serializePlan(gone)).not.toContain("Ask María");
    expect(serializePlan(gone)).toContain("    - [ ] Methods\n");
  });
});

describe("the project's priority", () => {
  it("is the plan's priority property, beside its deadline", async () => {
    const { projectPriority, setProjectPriority, setProjectDue } = await import(
      "./plan-file"
    );
    const dated = setProjectDue(parsePlan("# P\n"), "2027-01-15");
    const high = setProjectPriority(dated, 3);
    expect(serializePlan(high)).toBe(
      "---\ndue: 2027-01-15\npriority: high\n---\n# P\n",
    );
    expect(projectPriority(high)).toBe(3);
    expect(projectDue(high)).toBe("2027-01-15");
    const none = setProjectPriority(high, 0);
    expect(serializePlan(none)).toBe("---\ndue: 2027-01-15\n---\n# P\n");
    expect(projectPriority(none)).toBe(0);
  });
});

describe("pins", () => {
  it("are links under the task, apart from its description", async () => {
    const { pinsOf, withPins, notesText, notesLines } = await import(
      "./plan-file"
    );
    const plan = parsePlan(
      "# P\n\n- [ ] Read for the intro\n    Start with the review.\n    📌 [[Cohen 1990]]\n",
    );
    const task = plan.sections[0].items.find((i) => i.kind === "task");
    if (task?.kind !== "task") throw new Error("no task");
    expect(pinsOf(task.task)).toEqual(["Cohen 1990"]);
    expect(notesText(task.task)).toBe("Start with the review.");
    expect(withPins(task.task, ["Cohen 1990", "Absorptive capacity"])).toEqual([
      "    Start with the review.",
      "    📌 [[Cohen 1990]]",
      "    📌 [[Absorptive capacity]]",
    ]);
    // A new description keeps them.
    expect(notesLines("Read it twice.", pinsOf(task.task))).toEqual([
      "    Read it twice.",
      "    📌 [[Cohen 1990]]",
    ]);
  });
});
