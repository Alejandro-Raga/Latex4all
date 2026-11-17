/**
 * A project's reading list: the papers to read for it, in the order they'll
 * be read. It's the "Reading list" section of the plan:
 *
 *   ## Reading list
 *
 *   - [ ] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/reading #reading/highlighted [page:: 12/30]
 *   - [x] [The decline of science](zotero://select/library/items/EFGH5678) #reading/read #reading/cited
 *   - [ ] [A paper someone mentioned](https://doi.org/10.1000/xyz) #reading/to-read
 *
 * Each paper has a status, the reader's own: to read, reading, read. It
 * moves to Reading by itself when the paper is opened, which also keeps the
 * last page. What's been done with it shows apart, as marks set by
 * themselves: highlighted, quoted in a note, cited. Papers not in Zotero
 * keep a title, and a DOI or a link if given.
 */
import {
  addSection,
  addTask,
  allTasks,
  type Plan,
  type Task,
  type TaskRef,
  updateTask,
} from "./plan-file";
import { isMilestonesSection } from "./milestones";

export const READING_SECTION = "Reading list";

export const STATUSES = ["to-read", "reading", "read", "reread"] as const;
export type ReadingStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  "to-read": "To read",
  reading: "Reading",
  read: "Read",
  reread: "To re-read",
};

/** What each status means. */
export const STATUS_HINT: Record<ReadingStatus, string> = {
  "to-read": "Not started",
  reading: "Started: set when you open it",
  read: "Finished",
  reread: "Read once, to go back to",
};

export const STATUS_COLOR: Record<ReadingStatus, string> = {
  "to-read": "var(--muted-foreground)",
  reading: "var(--primary)",
  read: "var(--chart-2)",
  reread: "var(--chart-5)",
};

/** What's been done with a paper, each set by itself. */
export const MARKS = ["highlighted", "quoted", "cited"] as const;
export type ReadingMark = (typeof MARKS)[number];

export const MARK_LABEL: Record<ReadingMark, string> = {
  highlighted: "Highlighted",
  quoted: "Quoted",
  cited: "Cited",
};

export const MARK_HINT: Record<ReadingMark, string> = {
  highlighted: "You've highlighted it",
  quoted: "You've quoted it in a note",
  cited: "Your project cites it",
};

export const MARK_COLOR: Record<ReadingMark, string> = {
  highlighted: "var(--chart-4)",
  quoted: "var(--chart-3)",
  cited: "var(--chart-1)",
};

const TAGS = /\s*#reading\/([a-z-]+)/g;
const PAGE = /\s*\[page::\s*(\d+)(?:\s*\/\s*(\d+))?\]/;
const BOOKMARK = /\s*\[bookmark::\s*(\d+)\]/;
const LINK =
  /\[([^\]]*)\]\((?:zotero:\/\/select\/library\/items\/([A-Z0-9]+)|(https?:\/\/[^)\s]+))\)/;
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)])/i;

export interface ReadingItem {
  task: Task;
  ref: TaskRef;
  status: ReadingStatus;
  marks: ReadingMark[];
  /** The last page opened, and how many there are. */
  page?: number;
  pages?: number;
  /** The page the reader bookmarked: where they stopped. */
  bookmark?: number;
  /** The paper's Zotero item, when it's in Zotero. */
  itemKey?: string;
  /** Where to find it otherwise: its DOI's address, or any link. */
  url?: string;
  doi?: string;
  /** Its title, as shown. */
  title: string;
}

export const isReadingSection = (title: string | null) =>
  title?.toLowerCase() === READING_SECTION.toLowerCase();

export function readingItem(task: Task, ref: TaskRef): ReadingItem {
  const tags = [...task.title.matchAll(TAGS)].map((m) => m[1]);
  const marks = new Set<ReadingMark>(
    tags.filter((t): t is ReadingMark =>
      (MARKS as readonly string[]).includes(t),
    ),
  );
  let status = tags.find((t): t is ReadingStatus =>
    (STATUSES as readonly string[]).includes(t),
  );
  // Lists from before statuses and marks were apart.
  if (tags.includes("noted")) marks.add("quoted");
  if (!status && (tags.includes("noted") || marks.has("cited")))
    status = "read";
  if (!status && marks.has("highlighted")) status = "reading";
  if (
    status === "read" &&
    tags.includes("read") &&
    marks.size === 0 &&
    !task.done
  ) {
    // "read" once meant highlighted.
    status = "reading";
    marks.add("highlighted");
  }
  status ??= task.done ? "read" : "to-read";
  const page = PAGE.exec(task.title);
  const bookmark = BOOKMARK.exec(task.title);
  const link = LINK.exec(task.title);
  const url = link?.[3];
  const title = task.title
    .replace(TAGS, "")
    .replace(PAGE, "")
    .replace(BOOKMARK, "")
    .replace(LINK, (_, text: string) => text)
    .trim();
  return {
    task,
    ref,
    status,
    marks: MARKS.filter((m) => marks.has(m)),
    page: page ? Number(page[1]) : undefined,
    pages: page?.[2] ? Number(page[2]) : undefined,
    bookmark: bookmark ? Number(bookmark[1]) : undefined,
    itemKey: link?.[2],
    url,
    doi: url ? DOI.exec(decodeURIComponent(url))?.[1] : undefined,
    title,
  };
}

/** The reading list, in reading order. */
export function readingItems(plan: Plan): ReadingItem[] {
  return allTasks(plan)
    .filter((t) => isReadingSection(t.section))
    .map((t) => readingItem(t.task, t.ref));
}

/** The plan's tasks, the reading list left out. */
/** Sections that aren't headings of tasks: the reading list, milestones. */
export const isSpecialSection = (title: string | null) =>
  isReadingSection(title) || isMilestonesSection(title);

/** The plan's tasks, the reading list and milestones left out. */
export function workTasks(plan: Plan) {
  return allTasks(plan).filter((t) => !isSpecialSection(t.section));
}

/**
 * Subtasks with a date of their own, at any depth: they count in Today,
 * the week and the calendar like any task.
 */
export function datedSubtasks(plan: Plan) {
  const out: { task: Task; ref: TaskRef; section: string | null }[] = [];
  const walk = (task: Task, ref: TaskRef, section: string | null) => {
    task.subtasks.forEach((sub, i) => {
      const own = { ...ref, path: [...(ref.path ?? []), i] };
      if (sub.due) out.push({ task: sub, ref: own, section });
      walk(sub, own, section);
    });
  };
  for (const t of workTasks(plan)) walk(t.task, t.ref, t.section);
  return out;
}

/** The reading list's section, made if there's none. */
export function readingSection(plan: Plan): { plan: Plan; index: number } {
  const index = plan.sections.findIndex((s) => isReadingSection(s.title));
  if (index >= 0) return { plan, index };
  const next = addSection(plan, READING_SECTION);
  return { plan: next, index: next.sections.length - 1 };
}

interface Entry {
  title: string;
  itemKey?: string;
  url?: string;
  status: ReadingStatus;
  marks: ReadingMark[];
  page?: number;
  pages?: number;
  bookmark?: number;
}

function entryTitle(item: Entry): string {
  const text = item.title.replace(/[[\]]/g, "");
  const name = item.itemKey
    ? `[${text}](zotero://select/library/items/${item.itemKey})`
    : item.url
      ? `[${text}](${item.url})`
      : item.title;
  const parts = [
    name,
    `#reading/${item.status}`,
    ...item.marks.map((m) => `#reading/${m}`),
  ];
  if (item.page) {
    parts.push(`[page:: ${item.page}${item.pages ? `/${item.pages}` : ""}]`);
  }
  if (item.bookmark) parts.push(`[bookmark:: ${item.bookmark}]`);
  return parts.join(" ");
}

/**
 * What was typed to add a paper: a title, a DOI, a link, or a title with
 * either. A DOI becomes its doi.org address.
 */
export function parsePaperInput(text: string): {
  title: string;
  url?: string;
  doi?: string;
} {
  const raw = text.trim();
  const doi = DOI.exec(raw)?.[1];
  const link = /https?:\/\/\S+/.exec(raw)?.[0];
  const url = doi ? `https://doi.org/${doi}` : link;
  const title = raw
    .replace(/https?:\/\/\S+/, "")
    .replace(
      doi
        ? new RegExp(
            `(?:doi:\\s*)?${doi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            "i",
          )
        : /$^/,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/^[\s,–—-]+|[\s,–—-]+$/g, "")
    .trim();
  return { title: title || doi || link || raw, url, doi };
}

/** Adds a paper at the end of the list, unless it's there already. */
export function addReading(
  plan: Plan,
  paper: { title: string; itemKey?: string; url?: string },
): Plan {
  const items = readingItems(plan);
  if (
    (paper.itemKey && items.some((r) => r.itemKey === paper.itemKey)) ||
    (paper.url && items.some((r) => r.url === paper.url))
  ) {
    return plan;
  }
  const { plan: withSection, index } = readingSection(plan);
  return addTask(
    withSection,
    { title: entryTitle({ ...paper, status: "to-read", marks: [] }) },
    index,
  );
}

function rewrite(
  plan: Plan,
  item: ReadingItem,
  change: Partial<Entry>,
  today?: string,
): Plan {
  const next = { ...item, ...change };
  const title = entryTitle(next);
  const done = next.status === "read";
  if (title === item.task.title && done === item.task.done) return plan;
  return updateTask(plan, item.ref, {
    title,
    done,
    doneOn: done ? (item.task.doneOn ?? today) : undefined,
  });
}

function itemAt(plan: Plan, ref: TaskRef) {
  return readingItems(plan).find(
    (r) => r.ref.section === ref.section && r.ref.item === ref.item,
  );
}

/** Sets a paper's status by hand: anything goes. */
export function setReadingStatus(
  plan: Plan,
  ref: TaskRef,
  status: ReadingStatus,
  today?: string,
): Plan {
  const item = itemAt(plan, ref);
  return item ? rewrite(plan, item, { status }, today) : plan;
}

/** A paper now in Zotero: linked to its item, the rest kept. */
export function linkReading(
  plan: Plan,
  ref: TaskRef,
  itemKey: string,
  title?: string,
): Plan {
  const item = itemAt(plan, ref);
  return item
    ? rewrite(plan, item, {
        itemKey,
        url: undefined,
        title: title ?? item.title,
      })
    : plan;
}

/** The status after this one, as a click on the marker goes. */
export const nextStatus = (status: ReadingStatus): ReadingStatus =>
  status === "to-read" ? "reading" : status === "reading" ? "read" : "to-read";

/** Applies a change to every entry of a paper. */
function eachOf(
  plan: Plan,
  itemKey: string,
  change: (item: ReadingItem) => Partial<Entry> | null,
): Plan {
  let next = plan;
  for (const item of readingItems(plan)) {
    if (item.itemKey !== itemKey) continue;
    const patch = change(item);
    if (patch) next = rewrite(next, item, patch);
  }
  return next;
}

/** Opened: being read, unless it's been read already. */
export const markOpened = (plan: Plan, itemKey: string) =>
  eachOf(plan, itemKey, (item) =>
    item.status === "to-read" || item.status === "reread"
      ? { status: "reading" }
      : null,
  );

/** The last page opened, of how many; opening it is starting it. */
export const markPage = (
  plan: Plan,
  itemKey: string,
  page: number,
  pages?: number,
) =>
  eachOf(plan, itemKey, (item) =>
    item.page === page &&
    (pages === undefined || item.pages === pages) &&
    item.status !== "to-read" &&
    item.status !== "reread"
      ? null
      : {
          page,
          pages: pages ?? item.pages,
          status:
            item.status === "to-read" || item.status === "reread"
              ? "reading"
              : item.status,
        },
  );

/** Highlighted, quoted or cited: the mark, kept. Highlighting starts it. */
export const addMark = (plan: Plan, itemKey: string, mark: ReadingMark) =>
  eachOf(plan, itemKey, (item) =>
    item.marks.includes(mark)
      ? null
      : {
          marks: MARKS.filter((m) => m === mark || item.marks.includes(m)),
          status:
            mark === "highlighted" && item.status === "to-read"
              ? "reading"
              : item.status,
        },
  );

/** Bookmarked at a page (or not, with none), on every entry of the paper. */
export const markBookmark = (
  plan: Plan,
  itemKey: string,
  bookmark: number | undefined,
  pages?: number,
) =>
  eachOf(plan, itemKey, (item) =>
    item.bookmark === bookmark
      ? null
      : {
          bookmark,
          pages: pages ?? item.pages,
          status:
            bookmark && (item.status === "to-read" || item.status === "reread")
              ? "reading"
              : item.status,
        },
  );

/** How far into a paper: its bookmark if it has one, else the last page. */
export function progress(item: ReadingItem): number | undefined {
  const at = item.bookmark ?? item.page;
  if (!at || !item.pages) return undefined;
  return Math.min(1, at / item.pages);
}
