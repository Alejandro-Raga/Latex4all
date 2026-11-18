/**
 * The Eisenhower matrix: every open task by how important it is (its
 * priority, high or highest) and how urgent (due in less than five days, or late).
 * Dropping a task in a box makes it so: its priority and date change.
 */
import { daysUntil, dayFromToday } from "@/lib/plan/dates";
import { outOfMatrix, withoutMatrixField } from "@/lib/plan/matrix-opt";
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
/** Due in less than five days, or late. */
export const isUrgent = (t: Task) => !!t.due && daysUntil(t.due) < 5;

export function quadrantOf(t: Task): Quadrant {
  if (isImportant(t)) return isUrgent(t) ? "do" : "schedule";
  return isUrgent(t) ? "squeeze" : "later";
}

const BOXES: { id: Quadrant; title: string; color: string }[] = [
  { id: "do", title: "Urgent & important", color: "var(--destructive)" },
  { id: "schedule", title: "Important, not urgent", color: "var(--chart-1)" },
  { id: "squeeze", title: "Urgent, not important", color: "var(--chart-4)" },
  { id: "later", title: "Neither", color: "var(--muted-foreground)" },
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
    // Subtasks with a priority or date of their own go in their own box.
    const own = (sub: Task) => sub.priority > 0 || !!sub.due;
    const subs: { task: Task; ref: TaskRef; parent: string }[] = [];
    const walk = (task: Task, ref: TaskRef) =>
      task.subtasks.forEach((sub, i) => {
        // Left out of the matrix: and what's under it.
        if (outOfMatrix(sub)) return;
        const at = childRef(ref, i);
        if (!sub.done && own(sub))
          subs.push({
            task: sub,
            ref: at,
            parent: withoutMatrixField(task.title),
          });
        walk(sub, at);
      });
    const top = workTasks(plan).filter(
      (t) => !t.task.done && !outOfMatrix(t.task),
    );
    for (const t of top) walk(t.task, t.ref);
    return [
      ...top.map((t) => ({
        ...t,
        list,
        plan,
        parent: undefined as string | undefined,
      })),
      ...subs.map((s) => ({ ...s, list, plan })),
    ];
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
              title={<span className="font-semibold text-sm">{box.title}</span>}
              color={box.color}
              count={inBox.length}
              onDrop={(d) => drop(d, box.id, plans)}
              fill
            >
              {inBox.map((t) => (
                <TaskCard
                  key={`${t.list.key}-${t.ref.section}-${t.ref.item}-${(t.ref.path ?? []).join(".")}`}
                  list={t.list}
                  plan={t.plan}
                  task={t.task}
                  taskRef={t.ref}
                  parentTitle={t.parent}
                  showSub={(sub) => !(sub.priority > 0 || sub.due)}
                  selected={
                    selected?.list.key === t.list.key &&
                    selected.ref.section === t.ref.section &&
                    selected.ref.item === t.ref.item &&
                    (selected.ref.path ?? []).join(".") ===
                      (t.ref.path ?? []).join(".")
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
