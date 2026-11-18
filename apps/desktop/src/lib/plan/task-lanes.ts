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
