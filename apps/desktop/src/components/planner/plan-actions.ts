/**
 * Changing plans from the Planner: edits against a plan's latest text,
 * moving tasks between plans, and what's being dragged.
 */
import { toast } from "sonner";
import { dayFromToday } from "@/lib/plan/dates";
import {
  addSection,
  addTask,
  moveTask,
  nestTask,
  promoteSubtask,
  deleteTask,
  detached,
  newPlanText,
  type Plan,
  parsePlan,
  serializePlan,
  type TaskRef,
  taskAt,
  updateTask,
  toggleTask,
} from "@/lib/plan/plan-file";
import {
  type PlanKey,
  type PlanList,
  planTextNow,
  usePlanStore,
  writePlan,
} from "@/lib/plan/plan-store";
import { isReadingSection, READING_SECTION } from "@/lib/plan/reading";
import type { DragTask, Zone } from "./planner-dnd";

async function textNow(key: PlanKey): Promise<string | null> {
  let text = planTextNow(key);
  if (text === undefined) {
    await usePlanStore.getState().load(key);
    text = planTextNow(key);
  }
  return text ?? null;
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Applies a change to a plan as it is now, starting one if there's none. */
export async function editPlan(
  list: Pick<PlanList, "key" | "name">,
  change: (plan: Plan) => Plan,
): Promise<void> {
  try {
    const text = await textNow(list.key);
    const plan = parsePlan(text ?? newPlanText(list.name));
    const next = serializePlan(change(plan));
    if (next !== text) await writePlan(list.key, next);
  } catch (err) {
    toast.error(`Couldn't save: ${errorText(err)}`);
  }
}

export type { DragTask } from "./planner-dnd";

/** Moves a task to another plan: into its first section (or its reading list). */
export async function moveToPlan(
  drag: DragTask,
  target: Pick<PlanList, "key" | "name">,
): Promise<void> {
  if (drag.list.key === target.key) return;
  try {
    const sourceText = await textNow(drag.list.key);
    if (!sourceText) return;
    const source = parsePlan(sourceText);
    const parent = taskAt(source, drag.ref);
    const task = drag.sub === undefined ? parent : parent?.subtasks[drag.sub];
    if (!task) return;
    await editPlan(target, (plan) => {
      const reading = plan.sections.findIndex((s) => isReadingSection(s.title));
      if (drag.reading) {
        if (reading >= 0) return addTask(plan, detached(task), reading);
        const withList = addSection(plan, READING_SECTION);
        return addTask(withList, detached(task), withList.sections.length - 1);
      }
      const first = plan.sections.findIndex(
        (s) => s.title !== null && !isReadingSection(s.title),
      );
      return addTask(plan, detached(task), first >= 0 ? first : undefined);
    });
    const left =
      drag.sub === undefined || !parent
        ? deleteTask(source, drag.ref)
        : updateTask(source, drag.ref, {
            subtasks: parent.subtasks.filter((_, i) => i !== drag.sub),
          });
    await writePlan(drag.list.key, serializePlan(left));
    toast.success(`Moved to ${target.name}`);
  } catch (err) {
    toast.error(`Couldn't move it: ${errorText(err)}`);
  }
}

/** Dropped on Today or Tomorrow: due then. */
export const dueOn = (drag: DragTask, days: number) =>
  editPlan(drag.list, (p) => {
    const { plan, ref } = lifted(p, drag);
    return updateTask(plan, ref, { due: dayFromToday(days) });
  });

/** Dropped on Completed: done. */
export const completeDrag = (drag: DragTask) =>
  editPlan(drag.list, (p) => {
    if (drag.sub !== undefined) {
      const parent = taskAt(p, drag.ref);
      if (!parent) return p;
      return updateTask(p, drag.ref, {
        subtasks: parent.subtasks.map((s, i) =>
          i === drag.sub ? { ...s, done: true } : s,
        ),
      });
    }
    return taskAt(p, drag.ref)?.done ? p : toggleTask(p, drag.ref);
  });

/**
 * A subtask dragged out becomes a task first, right after its parent;
 * gives the plan and where that task now is.
 */
function lifted(plan: Plan, drag: DragTask): { plan: Plan; ref: TaskRef } {
  if (drag.sub === undefined) return { plan, ref: drag.ref };
  return {
    plan: promoteSubtask(plan, drag.ref, drag.sub),
    ref: { section: drag.ref.section, item: drag.ref.item + 1 },
  };
}

/** Where a target task is once a subtask was lifted out before it. */
function shifted(target: TaskRef, drag: DragTask): TaskRef {
  if (
    drag.sub !== undefined &&
    target.section === drag.ref.section &&
    target.item > drag.ref.item
  ) {
    return { ...target, item: target.item + 1 };
  }
  return target;
}

/** Dropped on a task: before or after it, or inside as its subtask. */
export function dropOnTask(
  list: Pick<PlanList, "key" | "name">,
  target: TaskRef,
  drag: DragTask,
  zone: Zone,
): void {
  if (drag.list.key !== list.key) {
    void moveToPlan(drag, list);
    return;
  }
  void editPlan(list, (p) => {
    // A subtask dropped on its own parent: nothing to do.
    if (
      drag.sub !== undefined &&
      zone === "inside" &&
      target.section === drag.ref.section &&
      target.item === drag.ref.item
    ) {
      return p;
    }
    const { plan, ref } = lifted(p, drag);
    const at = shifted(target, drag);
    if (zone === "inside") return nestTask(plan, ref, at);
    return moveTask(
      plan,
      ref,
      at.section,
      zone === "after" ? at.item + 1 : at.item,
    );
  });
}

/** Dropped on a heading or column: to the end of that section. */
export function dropOnSection(
  list: Pick<PlanList, "key" | "name">,
  section: number,
  drag: DragTask,
): void {
  if (drag.list.key !== list.key) {
    void moveToPlan(drag, list);
    return;
  }
  void editPlan(list, (p) => {
    const { plan, ref } = lifted(p, drag);
    return moveTask(plan, ref, section);
  });
}
