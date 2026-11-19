/**
 * A plan's dated tasks for a timeline: one lane per section, and on each
 * lane the tasks placed by date, those too close together to tell apart
 * gathered into one group (shown as a count).
 */
import { isMilestonesSection } from "./milestones";
import { allTasks, type Plan, sectionDue, sectionName } from "./plan-file";
import { daysUntil } from "./dates";

export interface LaneTask {
  date: string;
  title: string;
  overdue: boolean;
}

export interface Lane {
  name: string;
  /** The section's own date, if it has one. */
  due?: string;
  tasks: LaneTask[];
}

/** Sections with open dated tasks (or a date of their own), in plan order. */
export function lanesOf(plan: Plan, plain: (title: string) => string): Lane[] {
  const tasks = allTasks(plan).filter(
    (t) => !t.task.done && t.task.due && !isMilestonesSection(t.section),
  );
  return plan.sections.flatMap((s, i) => {
    if (s.title !== null && isMilestonesSection(s.title)) return [];
    const mine = tasks
      .filter((t) => t.ref.section === i)
      .map((t) => ({
        date: t.task.due as string,
        title: plain(t.task.title),
        overdue: daysUntil(t.task.due as string) < 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const due = s.title ? sectionDue(s.title) : undefined;
    if (mine.length === 0 && !due) return [];
    return [
      {
        name: s.title ? sectionName(s.title) : "Tasks",
        ...(due ? { due } : {}),
        tasks: mine,
      },
    ];
  });
}

export interface Group<T> {
  /** Where it's drawn: the middle of its tasks. */
  x: number;
  items: T[];
}

/** Items closer than `gap` pixels to the one before join its group. */
export function gather<T extends { x: number }>(
  items: T[],
  gap = 14,
): Group<T>[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const groups: Group<T>[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const lastX = last?.items[last.items.length - 1].x;
    if (last && lastX !== undefined && item.x - lastX < gap) {
      last.items.push(item);
      last.x = last.items.reduce((sum, i) => sum + i.x, 0) / last.items.length;
    } else {
      groups.push({ x: item.x, items: [item] });
    }
  }
  return groups;
}

/** One thing drawn on a lane: a task, the section's own date, or a count
 * of tasks there was no room to name. */
export interface Placed<T> {
  kind: "task" | "due" | "more";
  x: number;
  row: number;
  /** Its name's width (0: none), and whether it's to the left of the dot. */
  labelW: number;
  left: boolean;
  items: T[];
}

/**
 * Lays a lane out so no two names overlap: each task's dot at its date with
 * its name beside it (to the left near the end of the line), in the first
 * of `rows` rows with room, its name shortened if that makes it fit. What
 * still doesn't fit is counted ("+3") in one more row.
 */
export function layoutLane<T extends { x: number; label: string }>(
  items: Array<T & { kind?: "task" | "due" }>,
  width: number,
  rows = 3,
  charW = 5.8,
  /** Room already taken at the start of the first row (the lane's name). */
  taken = 0,
): { placed: Placed<T>[]; rows: number } {
  const DOT = 10;
  const GAP = 10;
  const MAX = 200;
  const MIN = 56;
  const ends: number[] = taken > 0 ? [taken] : [];
  const placed: Placed<T>[] = [];
  const left: Array<T & { kind?: "task" | "due" }> = [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const span = (x: number, w: number) => {
    const flip = x + DOT + w > width;
    return flip
      ? { from: x - DOT - w, to: x + 4, flip }
      : { from: x - 4, to: x + DOT + w, flip };
  };
  for (const item of sorted) {
    const full = Math.min(MAX, item.label.length * charW + 4);
    let done = false;
    for (const w of [full, Math.min(full, 120), Math.min(full, MIN)]) {
      const s = span(item.x, w);
      let row = ends.findIndex((end) => end + GAP <= s.from);
      if (row < 0 && ends.length < rows) row = ends.length;
      if (row < 0) continue;
      ends[row] = s.to;
      placed.push({
        kind: item.kind ?? "task",
        x: item.x,
        row,
        labelW: w,
        left: s.flip,
        items: [item],
      });
      done = true;
      break;
    }
    if (!done) left.push(item);
  }
  let used = ends.length;
  if (left.length) {
    for (const g of gather(left, 28)) {
      placed.push({
        kind: "more",
        x: g.x,
        row: used,
        labelW: 0,
        left: false,
        items: g.items,
      });
    }
    used += 1;
  }
  return { placed, rows: used };
}
