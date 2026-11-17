/**
 * The Eisenhower matrix: every open task by how important it is (its
 * priority, high or highest) and how urgent (due within two days, or late).
 * Dropping a task in a box makes it so: its priority and date change.
 */
import { daysUntil, dayFromToday } from "@/lib/plan/dates";
import {
  childRef,
  parsePlan,
  type Plan,
  type Task,
  type TaskRef,
  taskAt,
  updateTask,
} from "@/lib/plan/plan-file";
import { type PlanList, usePlanTexts } from "@/lib/plan/plan-store";
import { workTasks } from "@/lib/plan/reading";
import { editPlan } from "./plan-actions";
import { Column, TaskCard, type Selected } from "./plan-views";
import type { DragTask } from "./planner-dnd";

export type Quadrant = "do" | "schedule" | "squeeze" | "later";

export const isImportant = (t: Task) => t.priority >= 3;
export const isUrgent = (t: Task) => !!t.due && daysUntil(t.due) <= 2;

export function quadrantOf(t: Task): Quadrant {
  if (isImportant(t)) return isUrgent(t) ? "do" : "schedule";
  return isUrgent(t) ? "squeeze" : "later";
}

const BOXES: { id: Quadrant; title: string; hint: string; color: string }[] = [
  {
    id: "do",
    title: "Do first",
    hint: "Important and urgent",
    color: "var(--destructive)",
  },
  {
    id: "schedule",
    title: "Schedule",
    hint: "Important, not urgent",
    color: "var(--chart-1)",
  },
  {
    id: "squeeze",
    title: "Squeeze in",
    hint: "Urgent, not important",
    color: "var(--chart-4)",
  },
  {
    id: "later",
    title: "Later",
    hint: "Neither",
    color: "var(--muted-foreground)",
  },
];

/** What a task becomes, dropped in a box. */
export function moveToQuadrant(task: Task, box: Quadrant): Partial<Task> {
  const important = box === "do" || box === "schedule";
  const urgent = box === "do" || box === "squeeze";
  const patch: Partial<Task> = {};
  if (important !== isImportant(task)) patch.priority = important ? 3 : 0;
  if (urgent && !isUrgent(task)) patch.due = dayFromToday(0);
  if (!urgent && isUrgent(task)) patch.due = dayFromToday(7);
  return patch;
}

function drop(d: DragTask, box: Quadrant, plans: Map<string, Plan>) {
  const plan = plans.get(d.list.key);
  if (!plan) return;
  const ref: TaskRef = d.sub === undefined ? d.ref : childRef(d.ref, d.sub);
  const task = taskAt(plan, ref);
  if (!task) return;
  const patch = moveToQuadrant(task, box);
  if (Object.keys(patch).length === 0) return;
  void editPlan(d.list as PlanList, (p) => updateTask(p, ref, patch));
}

export function MatrixView({
  lists,
  selected,
  onSelect,
}: {
  lists: PlanList[];
  selected?: Selected | null;
  onSelect?: (s: Selected) => void;
}) {
  const texts = usePlanTexts(lists.map((l) => l.key));
  const plans = new Map<string, Plan>();
  const tasks = lists.flatMap((list) => {
    const text = texts[list.key];
    if (!text) return [];
    const plan = parsePlan(text);
    plans.set(list.key, plan);
    return workTasks(plan)
      .filter((t) => !t.task.done)
      .map((t) => ({ ...t, list, plan }));
  });
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2 md:grid-rows-2">
      {BOXES.map((box) => {
        const inBox = tasks
          .filter((t) => quadrantOf(t.task) === box.id)
          .sort((a, b) =>
            (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999"),
          );
        return (
          <div key={box.id} className="flex min-h-48 min-w-0 flex-col">
            <Column
              id={`matrix:${box.id}`}
              accepts="tasks"
              title={
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-sm">{box.title}</span>
                  <span className="font-normal text-[11px] text-muted-foreground">
                    {box.hint}
                  </span>
                </span>
              }
              color={box.color}
              count={inBox.length}
              onDrop={(d) => drop(d, box.id, plans)}
              fill
            >
              {inBox.map((t) => (
                <TaskCard
                  key={`${t.list.key}-${t.ref.section}-${t.ref.item}`}
                  list={t.list}
                  plan={t.plan}
                  task={t.task}
                  taskRef={t.ref}
                  selected={
                    selected?.list.key === t.list.key &&
                    selected.ref.section === t.ref.section &&
                    selected.ref.item === t.ref.item &&
                    !selected.ref.path?.length
                  }
                  onSelect={onSelect}
                />
              ))}
            </Column>
          </div>
        );
      })}
    </div>
  );
}
