/**
 * A project's milestones: the steps on the way to its deadline (a first
 * draft, the submission, the revisions), each with its date. They're the
 * "Milestones" section of the plan, written as dated tasks, checked off once
 * reached:
 *
 *   ## Milestones
 *
 *   - [x] Literature review 📅 2026-10-30 ✅ 2026-10-28
 *   - [ ] First draft 📅 2026-12-01
 */
import {
  addSection,
  addTask,
  allTasks,
  type Plan,
  sectionName,
  type Task,
  type TaskRef,
} from "./plan-file";

export const MILESTONES_SECTION = "Milestones";

export const isMilestonesSection = (title: string | null) =>
  title?.toLowerCase() === MILESTONES_SECTION.toLowerCase();

export interface Milestone {
  task: Task;
  ref: TaskRef;
}

/** The milestones, soonest first (undated last). */
export function milestones(plan: Plan): Milestone[] {
  return allTasks(plan)
    .filter((t) => isMilestonesSection(t.section))
    .map((t) => ({ task: t.task, ref: t.ref }))
    .sort((a, b) => (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999"));
}

/** A milestone at the end of the list, its section made if there's none. */
export function addMilestone(plan: Plan, title: string, due?: string): Plan {
  let next = plan;
  let index = next.sections.findIndex((s) => isMilestonesSection(s.title));
  if (index < 0) {
    next = addSection(next, MILESTONES_SECTION);
    index = next.sections.length - 1;
  }
  return addTask(next, { title, due }, index);
}

const LINK = /\s*\[for::\s*([^\]]+?)\s*\]/i;

/** The section a milestone follows the progress of (`[for:: Chapter 2]`). */
export const linkedSection = (task: Pick<Task, "title">) =>
  LINK.exec(task.title)?.[1];

/** The title with the milestone following `section` (none: no link). */
export function withLink(title: string, section: string | null): string {
  const bare = title.replace(LINK, "").trim();
  return section ? `${bare} [for:: ${section}]` : bare;
}

/** How much of a section is done: its tasks and subtasks, checked off. */
export function sectionProgress(
  plan: Plan,
  name: string,
): { done: number; total: number } | null {
  const section = plan.sections.find(
    (s) => s.title !== null && sectionName(s.title) === name,
  );
  if (!section) return null;
  let done = 0;
  let total = 0;
  const count = (t: Task) => {
    total++;
    if (t.done) done++;
    t.subtasks.forEach(count);
  };
  for (const item of section.items) if (item.kind === "task") count(item.task);
  return { done, total };
}

/**
 * Close and far from done: due within a week with less than four fifths
 * finished (or past its date and not done).
 */
export function atRisk(
  progress: { done: number; total: number } | null,
  due: string | undefined,
  days: (iso: string) => number,
): boolean {
  if (!progress || !due || progress.total === 0) return false;
  if (progress.done === progress.total) return false;
  return days(due) <= 7 && progress.done / progress.total < 0.8;
}

/** Icons a milestone can have, by name. */
export const MILESTONE_ICONS = [
  "diamond",
  "flag",
  "star",
  "send",
  "presentation",
  "plane",
  "book",
  "graduation",
  "circle",
] as const;
export type MilestoneIcon = (typeof MILESTONE_ICONS)[number];

/** Its colors: the theme's own, so they suit every theme. */
export const MILESTONE_COLORS = [
  "accent",
  "orange",
  "blue",
  "green",
  "purple",
  "red",
  "grey",
] as const;
export type MilestoneColor = (typeof MILESTONE_COLORS)[number];

const ICON = /\s*\[icon::\s*([^\]]+?)\s*\]/i;
const COLOR = /\s*\[color::\s*([^\]]+?)\s*\]/i;

/** A milestone's icon and color (`[icon:: send] [color:: blue]`), if set. */
export function styleOf(task: Pick<Task, "title">): {
  icon?: MilestoneIcon;
  color?: MilestoneColor;
} {
  const icon = ICON.exec(task.title)?.[1] as MilestoneIcon | undefined;
  const color = COLOR.exec(task.title)?.[1] as MilestoneColor | undefined;
  return {
    ...(icon && MILESTONE_ICONS.includes(icon) ? { icon } : {}),
    ...(color && MILESTONE_COLORS.includes(color) ? { color } : {}),
  };
}

/** The title with its icon and color set (none: the default). */
export function withStyle(
  title: string,
  style: { icon?: MilestoneIcon | null; color?: MilestoneColor | null },
): string {
  let next = title;
  if (style.icon !== undefined) {
    next = next.replace(ICON, "").trim();
    if (style.icon && style.icon !== "diamond")
      next += ` [icon:: ${style.icon}]`;
  }
  if (style.color !== undefined) {
    next = next.replace(COLOR, "").trim();
    if (style.color) next += ` [color:: ${style.color}]`;
  }
  return next;
}

/**
 * Bars in rows so none overlaps another: each in the first row free from
 * its start (ordered by start). Returns each one's row.
 */
export function lanes(spans: { start: number; end: number }[]): number[] {
  const ends: number[] = [];
  const order = spans
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.start - b.start);
  const out: number[] = new Array(spans.length).fill(0);
  for (const s of order) {
    let row = ends.findIndex((end) => end < s.start);
    if (row < 0) row = ends.length;
    ends[row] = s.end;
    out[s.i] = row;
  }
  return out;
}
