/**
 * A project's reading list: the papers to read for it, in reading order,
 * each with how far it's got. It's the "Reading list" section of the plan:
 *
 *   ## Reading list
 *
 *   - [ ] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/to-read
 *   - [x] [The decline of science](zotero://select/library/items/EFGH5678) #reading/cited
 *
 * The status moves forward on its own as the paper is opened, highlighted,
 * quoted in a note and cited; by hand it can go anywhere.
 */
import {
  allTasks,
  type Plan,
  type Task,
  type TaskRef,
  addSection,
  addTask,
  updateTask,
} from "./plan-file";

export const READING_SECTION = "Reading list";

export const STATUSES = [
  "to-read",
  "reading",
  "read",
  "noted",
  "cited",
] as const;
export type ReadingStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  "to-read": "To read",
  reading: "Reading",
  read: "Highlighted",
  noted: "Quoted",
  cited: "Cited",
};

/** What each status means, and what sets it by itself. */
export const STATUS_HINT: Record<ReadingStatus, string> = {
  "to-read": "Not opened yet",
  reading: "Set when you open it",
  read: "Set when you highlight it",
  noted: "Set when you quote it in a note",
  cited: "Set when your project cites it",
};

/** The theme's own colors, so every theme keeps its look. */
export const STATUS_COLOR: Record<ReadingStatus, string> = {
  "to-read": "var(--muted-foreground)",
  reading: "var(--primary)",
  read: "var(--chart-2)",
  noted: "var(--chart-4)",
  cited: "var(--chart-1)",
};

const STATUS_TAG = /\s*#reading\/([a-z-]+)/;
const ZOTERO_LINK =
  /\[([^\]]*)\]\(zotero:\/\/select\/library\/items\/([A-Z0-9]+)\)/;

export interface ReadingItem {
  task: Task;
  ref: TaskRef;
  status: ReadingStatus;
  /** The paper's Zotero item, if it came from Zotero. */
  itemKey?: string;
  /** Its title, as shown. */
  title: string;
}

export const isReadingSection = (title: string | null) =>
  title?.toLowerCase() === READING_SECTION.toLowerCase();

export function readingItem(task: Task, ref: TaskRef): ReadingItem {
  const tag = STATUS_TAG.exec(task.title)?.[1];
  const status = (STATUSES as readonly string[]).includes(tag ?? "")
    ? (tag as ReadingStatus)
    : task.done
      ? "read"
      : "to-read";
  const link = ZOTERO_LINK.exec(task.title);
  const title = task.title
    .replace(STATUS_TAG, "")
    .replace(ZOTERO_LINK, (_, text: string) => text)
    .trim();
  return { task, ref, status, itemKey: link?.[2], title };
}

/** The reading list, in reading order. */
export function readingItems(plan: Plan): ReadingItem[] {
  return allTasks(plan)
    .filter((t) => isReadingSection(t.section))
    .map((t) => readingItem(t.task, t.ref));
}

/** The plan's tasks, the reading list left out. */
export function workTasks(plan: Plan) {
  return allTasks(plan).filter((t) => !isReadingSection(t.section));
}

/** The reading list's section, made if there's none. */
function readingSection(plan: Plan): { plan: Plan; index: number } {
  const index = plan.sections.findIndex((s) => isReadingSection(s.title));
  if (index >= 0) return { plan, index };
  const next = addSection(plan, READING_SECTION);
  return { plan: next, index: next.sections.length - 1 };
}

const entryTitle = (
  title: string,
  itemKey: string | undefined,
  status: ReadingStatus,
) =>
  `${itemKey ? `[${title.replace(/[[\]]/g, "")}](zotero://select/library/items/${itemKey})` : title} #reading/${status}`;

/** Adds a paper at the end of the list, unless it's there already. */
export function addReading(
  plan: Plan,
  paper: { title: string; itemKey?: string },
): Plan {
  if (
    paper.itemKey &&
    readingItems(plan).some((r) => r.itemKey === paper.itemKey)
  ) {
    return plan;
  }
  const { plan: withSection, index } = readingSection(plan);
  return addTask(
    withSection,
    { title: entryTitle(paper.title, paper.itemKey, "to-read") },
    index,
  );
}

/** Done once read: what's read, noted or cited is checked off. */
const doneAt = (status: ReadingStatus) =>
  STATUSES.indexOf(status) >= STATUSES.indexOf("read");

export function setReadingStatus(
  plan: Plan,
  ref: TaskRef,
  status: ReadingStatus,
  today?: string,
): Plan {
  const item = readingItems(plan).find(
    (r) => r.ref.section === ref.section && r.ref.item === ref.item,
  );
  if (!item) return plan;
  const done = doneAt(status);
  return updateTask(plan, ref, {
    title: entryTitle(item.title, item.itemKey, status),
    done,
    doneOn: done ? (item.task.doneOn ?? today) : undefined,
  });
}

/**
 * Moves a paper's status forward to `status`, never back: opening a paper
 * read long ago leaves it read. Unchanged if the paper isn't on the list.
 */
export function advanceReading(
  plan: Plan,
  itemKey: string,
  status: ReadingStatus,
  today?: string,
): Plan {
  let next = plan;
  for (const item of readingItems(plan)) {
    if (item.itemKey !== itemKey) continue;
    if (STATUSES.indexOf(item.status) >= STATUSES.indexOf(status)) continue;
    next = setReadingStatus(next, item.ref, status, today);
  }
  return next;
}
