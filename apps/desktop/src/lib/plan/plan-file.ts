/**
 * A project's plan: Plan.md at the project root, tasks written the way
 * Obsidian's Tasks plugin writes them, so the file reads and checks off in
 * Obsidian too:
 *
 *   # Plan
 *
 *   ## To do
 *
 *   - [ ] Draft the discussion ⏫ 📅 2026-11-20 #writing
 *       - [ ] Compare with Cohen 1990
 *       Notes under a task are indented.
 *   - [x] Send the outline ✅ 2026-11-14
 *
 * `##` headings are the sections (a board's columns). Anything else in the
 * file is kept as it is, in its place.
 */

export const PLAN_FILE = "Plan.md";

/** None, low, medium, high, highest: 🔽 🔼 ⏫ 🔺. */
export type Priority = 0 | 1 | 2 | 3 | 4;

const PRIORITY_MARK: Record<Exclude<Priority, 0>, string> = {
  1: "🔽",
  2: "🔼",
  3: "⏫",
  4: "🔺",
};
const MARK_PRIORITY: Record<string, Priority> = {
  "🔽": 1,
  "🔼": 2,
  "⏫": 3,
  "🔺": 4,
};

export interface Task {
  done: boolean;
  /** The words, tags and [[links]] included; dates and priority apart. */
  title: string;
  /** YYYY-MM-DD. */
  due?: string;
  /** When it was checked off, YYYY-MM-DD. */
  doneOn?: string;
  priority: Priority;
  subtasks: Task[];
  /** Indented lines under it that aren't subtasks, as written. */
  notes: string[];
  /** Its line as read, kept while nothing on it changes. */
  raw?: string;
}

export type Item =
  | { kind: "task"; task: Task }
  | { kind: "line"; line: string };

export interface Section {
  /** The `##` heading; null for what comes before the first one. */
  title: string | null;
  items: Item[];
}

export interface Plan {
  sections: Section[];
}

/** Where a task is: its section and its place among the section's items. */
export interface TaskRef {
  section: number;
  item: number;
}

const TASK = /^- \[([ xX])\] (.*)$/;
const SUBTASK = /^\s+- \[([ xX])\] (.*)$/;
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const DUE = new RegExp(`\\s*📅\\s*${DATE}`);
const DONE = new RegExp(`\\s*✅\\s*${DATE}`);
const PRIORITY = /\s*([🔺⏫🔼🔽])️?/u;

/** A task's line, after the checkbox. */
function parseTaskText(done: boolean, text: string): Task {
  let rest = text;
  const take = (re: RegExp): string | undefined => {
    const m = re.exec(rest);
    if (!m) return undefined;
    rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length);
    return m[1];
  };
  const due = take(DUE);
  const doneOn = take(DONE);
  const mark = take(PRIORITY);
  return {
    done,
    title: rest.trim(),
    due,
    doneOn,
    priority: mark ? MARK_PRIORITY[mark] : 0,
    subtasks: [],
    notes: [],
  };
}

export function parsePlan(text: string): Plan {
  const sections: Section[] = [{ title: null, items: [] }];
  let current = sections[0];
  let last: Task | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^## (.*)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), items: [] };
      sections.push(current);
      last = null;
      continue;
    }
    const task = TASK.exec(line);
    if (task) {
      last = { ...parseTaskText(task[1] !== " ", task[2]), raw: line };
      current.items.push({ kind: "task", task: last });
      continue;
    }
    if (last && /^\s+\S/.test(line)) {
      const sub = SUBTASK.exec(line);
      if (sub) {
        last.subtasks.push({
          ...parseTaskText(sub[1] !== " ", sub[2]),
          raw: line,
        });
      } else last.notes.push(line);
      continue;
    }
    last = null;
    current.items.push({ kind: "line", line });
  }
  // The split leaves one empty line for a final newline: not an item.
  const tail = sections[sections.length - 1].items;
  const end = tail[tail.length - 1];
  if (end?.kind === "line" && end.line === "") tail.pop();
  return { sections };
}

function taskLine(task: Task, indent = ""): string {
  // Unchanged: as it was written (tags after the date, say).
  if (task.raw !== undefined) {
    const was = TASK.exec(task.raw.trimStart());
    if (was) {
      const read = parseTaskText(was[1] !== " ", was[2]);
      if (canonical(read) === canonical(task)) return task.raw;
      // Only checked off, or back: the line as written, its box and date.
      const same = (t: Task) => canonical({ ...t, done: false });
      if (same(read) === same(task)) {
        const box = task.raw.replace(
          /- \[[ xX]\]/,
          `- [${task.done ? "x" : " "}]`,
        );
        const bare = box.replace(DONE, "");
        return task.done && task.doneOn ? `${bare} ✅ ${task.doneOn}` : bare;
      }
    }
  }
  const parts = [`${indent}- [${task.done ? "x" : " "}] ${task.title}`];
  if (task.priority) parts.push(PRIORITY_MARK[task.priority]);
  if (task.due) parts.push(`📅 ${task.due}`);
  if (task.done && task.doneOn) parts.push(`✅ ${task.doneOn}`);
  return parts.join(" ");
}

/** A task's fields that show on its line. */
const canonical = (t: Task) =>
  JSON.stringify([
    t.done,
    t.title,
    t.priority,
    t.due ?? "",
    t.done ? (t.doneOn ?? "") : "",
  ]);

export function serializePlan(plan: Plan): string {
  const lines: string[] = [];
  for (const section of plan.sections) {
    if (section.title !== null) lines.push(`## ${section.title}`);
    for (const item of section.items) {
      if (item.kind === "line") {
        lines.push(item.line);
        continue;
      }
      lines.push(taskLine(item.task));
      for (const sub of item.task.subtasks) lines.push(taskLine(sub, "    "));
      lines.push(...item.task.notes);
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** A plan to start from. */
export function newPlanText(name: string): string {
  return `# ${name}\n\n## To do\n\n## In progress\n\n## Waiting\n`;
}

export const today = (now = new Date()): string => {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
};

/** Tags in a title: #word, as Obsidian has them. */
export function tagsOf(title: string): string[] {
  return [...title.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]);
}

/** The sections that hold tasks (headings), with their indices. */
export function taskSections(plan: Plan): { index: number; title: string }[] {
  return plan.sections.flatMap((s, index) =>
    s.title === null ? [] : [{ index, title: s.title }],
  );
}

export function taskAt(plan: Plan, ref: TaskRef): Task | undefined {
  const item = plan.sections[ref.section]?.items[ref.item];
  return item?.kind === "task" ? item.task : undefined;
}

/** Every task in the plan, with where it is. */
export function allTasks(
  plan: Plan,
): { task: Task; ref: TaskRef; section: string | null }[] {
  return plan.sections.flatMap((s, section) =>
    s.items.flatMap((item, i) =>
      item.kind === "task"
        ? [{ task: item.task, ref: { section, item: i }, section: s.title }]
        : [],
    ),
  );
}

const clone = (plan: Plan): Plan => structuredClone(plan);

/** The index just after a section's last task (before its trailing blanks). */
function endOfTasks(section: Section): number {
  let at = section.items.length;
  while (at > 0) {
    const item = section.items[at - 1];
    if (item.kind === "line" && item.line.trim() === "") at--;
    else break;
  }
  return at;
}

/** Keeps a blank line between a section's heading and its first task. */
function insertTask(section: Section, at: number, task: Task) {
  if (section.title !== null && at === 0) {
    const first = section.items[0];
    if (!(first?.kind === "line" && first.line.trim() === "")) {
      section.items.unshift({ kind: "line", line: "" });
    }
    at = 1;
  }
  section.items.splice(at, 0, { kind: "task", task });
  // And one after the last task, before the next heading.
  const end = endOfTasks(section);
  if (end === section.items.length)
    section.items.push({ kind: "line", line: "" });
}

/** A new task at the end of a section (the first one with a heading if none). */
export function addTask(
  plan: Plan,
  fields: Partial<Task> & { title: string },
  section?: number,
): Plan {
  const next = clone(plan);
  let index = section ?? taskSections(next)[0]?.index;
  if (index === undefined) {
    next.sections.push({ title: "To do", items: [{ kind: "line", line: "" }] });
    index = next.sections.length - 1;
  }
  const target = next.sections[index];
  insertTask(target, endOfTasks(target), {
    done: false,
    priority: 0,
    subtasks: [],
    notes: [],
    ...fields,
  });
  return next;
}

export function updateTask(
  plan: Plan,
  ref: TaskRef,
  patch: Partial<Task>,
): Plan {
  const next = clone(plan);
  const item = next.sections[ref.section]?.items[ref.item];
  if (item?.kind !== "task") return plan;
  item.task = { ...item.task, ...patch };
  return next;
}

/** Checks a task off (dated today), or back on. */
export function toggleTask(plan: Plan, ref: TaskRef, now = new Date()): Plan {
  const task = taskAt(plan, ref);
  if (!task) return plan;
  return updateTask(plan, ref, {
    done: !task.done,
    doneOn: task.done ? undefined : today(now),
  });
}

export function toggleSubtask(plan: Plan, ref: TaskRef, sub: number): Plan {
  const task = taskAt(plan, ref);
  if (!task?.subtasks[sub]) return plan;
  const subtasks = task.subtasks.map((s, i) =>
    i === sub ? { ...s, done: !s.done } : s,
  );
  return updateTask(plan, ref, { subtasks });
}

export function deleteTask(plan: Plan, ref: TaskRef): Plan {
  if (!taskAt(plan, ref)) return plan;
  const next = clone(plan);
  next.sections[ref.section].items.splice(ref.item, 1);
  return next;
}

/**
 * Moves a task to another section, before the task at `before` there (an
 * item index), or at its end.
 */
export function moveTask(
  plan: Plan,
  ref: TaskRef,
  section: number,
  before?: number,
): Plan {
  const task = taskAt(plan, ref);
  if (!task || !plan.sections[section]) return plan;
  const next = clone(plan);
  next.sections[ref.section].items.splice(ref.item, 1);
  let at = before;
  if (at !== undefined && section === ref.section && ref.item < at) at--;
  const target = next.sections[section];
  insertTask(target, at ?? endOfTasks(target), structuredClone(task));
  return next;
}

export function addSection(plan: Plan, title: string): Plan {
  const next = clone(plan);
  const last = next.sections[next.sections.length - 1];
  const end = last.items[last.items.length - 1];
  if (!(end?.kind === "line" && end.line.trim() === "")) {
    last.items.push({ kind: "line", line: "" });
  }
  next.sections.push({ title, items: [{ kind: "line", line: "" }] });
  return next;
}

export function renameSection(plan: Plan, index: number, title: string): Plan {
  if (plan.sections[index]?.title == null) return plan;
  const next = clone(plan);
  next.sections[index].title = title;
  return next;
}

/** A task's description: its note lines, without their indent. */
export const notesText = (task: Task) =>
  task.notes
    .map((n) => n.replace(/^\s{1,4}/, ""))
    .join("\n")
    .trim();

/** Description text as note lines under the task. */
export const notesLines = (text: string) =>
  text.trim()
    ? text
        .trim()
        .split("\n")
        .map((l) => `    ${l}`)
    : [];

/** A copy of a task to put in another plan (its line rewritten there). */
export const detached = (task: Task): Task => {
  const { raw: _raw, ...rest } = task;
  return {
    ...rest,
    subtasks: task.subtasks.map(({ raw: _r, ...s }) => s),
  };
};

/**
 * Deletes a heading; its tasks go to the heading before it (or the first
 * one left), or stay above the headings if there's none.
 */
export function deleteSection(plan: Plan, index: number): Plan {
  const section = plan.sections[index];
  if (!section || section.title === null) return plan;
  const next = clone(plan);
  const [gone] = next.sections.splice(index, 1);
  const tasks = gone.items.filter((i) => i.kind === "task");
  if (tasks.length === 0) return next;
  // The heading before, else the first left that isn't the opening part.
  let target = index - 1;
  if (target < 1 || next.sections[target]?.title == null) {
    target = next.sections.findIndex((s, i) => i > 0 && s.title !== null);
  }
  if (target < 0) target = 0;
  const into = next.sections[target];
  for (const item of tasks) {
    if (item.kind === "task") insertTask(into, endOfTasks(into), item.task);
  }
  return next;
}

/** Makes a task a subtask of another (its own subtasks come along, flat). */
export function nestTask(plan: Plan, ref: TaskRef, parent: TaskRef): Plan {
  const task = taskAt(plan, ref);
  const host = taskAt(plan, parent);
  if (
    !task ||
    !host ||
    (ref.section === parent.section && ref.item === parent.item)
  ) {
    return plan;
  }
  const { subtasks, notes: _notes, raw: _raw, ...rest } = task;
  const added = [
    { ...rest, subtasks: [], notes: [] },
    ...subtasks.map((s) => ({ ...s, raw: undefined })),
  ];
  const withSubs = updateTask(plan, parent, {
    subtasks: [...host.subtasks, ...added],
  });
  return deleteTask(withSubs, ref);
}

/** Makes a subtask a task again, right after its parent. */
export function promoteSubtask(plan: Plan, ref: TaskRef, sub: number): Plan {
  const host = taskAt(plan, ref);
  const child = host?.subtasks[sub];
  if (!host || !child) return plan;
  const next = updateTask(plan, ref, {
    subtasks: host.subtasks.filter((_, i) => i !== sub),
  });
  const section = next.sections[ref.section];
  section.items.splice(ref.item + 1, 0, {
    kind: "task",
    task: { ...child, raw: undefined, subtasks: [], notes: [] },
  });
  return next;
}
