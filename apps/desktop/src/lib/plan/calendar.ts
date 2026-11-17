/**
 * The Planner's calendar: every dated thing in the plans, by day (tasks,
 * milestones, projects' deadlines), the days a month or week shows, and the
 * same written as an .ics file for Apple, Google or Outlook calendars.
 */
import { milestones } from "./milestones";
import { type Plan, projectDue, type TaskRef, today } from "./plan-file";
import { workTasks } from "./reading";

export type EntryKind = "task" | "milestone" | "deadline";

export interface CalendarEntry {
  kind: EntryKind;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  done: boolean;
  /** The plan it's in. */
  listKey: string;
  listName: string;
  /** The task or milestone, to change it (not for deadlines). */
  ref?: TaskRef;
}

/** Everything dated in these plans. */
export function calendarEntries(
  plans: { key: string; name: string; plan: Plan; project: boolean }[],
): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const { key, name, plan, project } of plans) {
    for (const t of workTasks(plan)) {
      if (!t.task.due) continue;
      out.push({
        kind: "task",
        date: t.task.due,
        title: t.task.title,
        done: t.task.done,
        listKey: key,
        listName: name,
        ref: t.ref,
      });
    }
    for (const m of milestones(plan)) {
      if (!m.task.due) continue;
      out.push({
        kind: "milestone",
        date: m.task.due,
        title: m.task.title,
        done: m.task.done,
        listKey: key,
        listName: name,
        ref: m.ref,
      });
    }
    const due = project ? projectDue(plan) : undefined;
    if (due) {
      out.push({
        kind: "deadline",
        date: due,
        title: `${name} is due`,
        done: false,
        listKey: key,
        listName: name,
      });
    }
  }
  return out;
}

const asDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso: string, n: number) => {
  const d = asDate(iso);
  d.setDate(d.getDate() + n);
  return today(d);
};

/** The Monday of the week a day is in. */
export function weekStart(iso: string): string {
  const day = asDate(iso).getDay();
  return addDays(iso, -((day + 6) % 7));
}

/** The seven days of a day's week, Monday first. */
export function weekDays(iso: string): string[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The six weeks a month's calendar shows, Monday first. */
export function monthDays(year: number, month: number): string[] {
  const first = today(new Date(year, month, 1));
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Moves a day by whole months, kept within the month. */
export function shiftMonth(iso: string, months: number): string {
  const d = asDate(iso);
  return today(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

export { addDays };

/* ─────────────────────────── .ics ─────────────────────────── */

const icsText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/** Lines no longer than 75 characters, as the format asks. */
const fold = (line: string) => {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
};

/** A short stable id, so a calendar updates an event rather than doubling it. */
function uid(entry: CalendarEntry): string {
  let hash = 0;
  for (const ch of `${entry.listKey}|${entry.kind}|${entry.title}`) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return `${entry.kind}-${hash.toString(36)}@latex4all`;
}

/** Readable titles: links as their text, tags and marks left out. */
const plainTitle = (title: string) =>
  title
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, n: string, a?: string) => a ?? n,
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** All-day events for the entries not done, as an .ics calendar. */
export function toIcs(entries: CalendarEntry[], now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Latex4All//Planner//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Latex4All",
  ];
  for (const e of entries) {
    if (e.done) continue;
    const start = e.date.replace(/-/g, "");
    const end = addDays(e.date, 1).replace(/-/g, "");
    const what =
      e.kind === "deadline"
        ? plainTitle(e.title)
        : e.kind === "milestone"
          ? `◆ ${plainTitle(e.title)} (${e.listName})`
          : `${plainTitle(e.title)} (${e.listName})`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid(e)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      fold(`SUMMARY:${icsText(what)}`),
      `CATEGORIES:${e.kind === "task" ? "Task" : e.kind === "milestone" ? "Milestone" : "Deadline"}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
