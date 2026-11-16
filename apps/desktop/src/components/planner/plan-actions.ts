/**
 * Changing plans from the Planner: edits against a plan's latest text,
 * moving tasks between plans, and what's being dragged.
 */
import { toast } from "sonner";
import { create } from "zustand";
import { dayFromToday } from "@/lib/plan/dates";
import {
  addSection,
  addTask,
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

/** A task (or reading entry) being dragged, and where it's from. */
export interface DragTask {
  list: Pick<PlanList, "key" | "name">;
  ref: TaskRef;
  reading?: boolean;
}

export const useTaskDrag = create<{
  drag: DragTask | null;
  /** What it's over: a row's or column's id, for the drop marker. */
  over: string | null;
  start: (drag: DragTask) => void;
  setOver: (over: string | null) => void;
  end: () => void;
}>((set) => ({
  drag: null,
  over: null,
  start: (drag) => set({ drag, over: null }),
  setOver: (over) => set((s) => (s.over === over ? s : { over })),
  end: () => set({ drag: null, over: null }),
}));

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
    const task = taskAt(source, drag.ref);
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
    await writePlan(drag.list.key, serializePlan(deleteTask(source, drag.ref)));
    toast.success(`Moved to ${target.name}`);
  } catch (err) {
    toast.error(`Couldn't move it: ${errorText(err)}`);
  }
}

/** Dropped on Today or Tomorrow: due then. */
export const dueOn = (drag: DragTask, days: number) =>
  editPlan(drag.list, (p) =>
    updateTask(p, drag.ref, { due: dayFromToday(days) }),
  );

/** Dropped on Completed: done. */
export const completeDrag = (drag: DragTask) =>
  editPlan(drag.list, (p) =>
    taskAt(p, drag.ref)?.done ? p : toggleTask(p, drag.ref),
  );
