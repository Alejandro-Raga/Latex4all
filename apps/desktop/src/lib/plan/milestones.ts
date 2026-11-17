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
