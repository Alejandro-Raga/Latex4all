import { useState } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { daysUntil, dayFromToday } from "@/lib/plan/dates";
import {
  addSection,
  addTask,
  allTasks,
  deleteTask,
  moveTask,
  newPlanText,
  type Plan,
  parsePlan,
  serializePlan,
  type Task,
  type TaskRef,
  taskSections,
  toggleSubtask,
  toggleTask,
  updateTask,
} from "@/lib/plan/plan-file";
import {
  INBOX,
  type PlanKey,
  type PlanList,
  usePlanText,
  usePlanTexts,
  writePlan,
} from "@/lib/plan/plan-store";
import type { QuickTask } from "@/lib/plan/quick-add";
import { cn } from "@/lib/utils";
import { QuickAdd, type TaskActions, TaskRow } from "./task-parts";

export type PlanViewMode = "list" | "board";

/** Applies a change to a plan as it is now, starting one if there's none. */
export async function editPlan(
  key: PlanKey,
  text: string | null | undefined,
  name: string,
  change: (plan: Plan) => Plan,
) {
  const current = parsePlan(text ?? newPlanText(name));
  try {
    await writePlan(key, serializePlan(change(current)));
  } catch (err) {
    toast.error(
      `Couldn't save the plan: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function actionsFor(
  key: PlanKey,
  text: string | null | undefined,
  name: string,
  ref: TaskRef,
  plan: Plan,
): TaskActions {
  const edit = (change: (p: Plan) => Plan) => editPlan(key, text, name, change);
  return {
    toggle: () => edit((p) => toggleTask(p, ref)),
    toggleSub: (i) => edit((p) => toggleSubtask(p, ref, i)),
    change: (patch) => edit((p) => updateTask(p, ref, patch)),
    remove: () => edit((p) => deleteTask(p, ref)),
    sections: taskSections(plan),
    section: ref.section,
    move: (section) => edit((p) => moveTask(p, ref, section)),
  };
}

const addQuick = (
  key: PlanKey,
  text: string | null | undefined,
  name: string,
  task: QuickTask,
  section?: number,
) => editPlan(key, text, name, (p) => addTask(p, task, section));

/** One plan: a project's, or the Inbox. */
export function PlanView({
  list,
  mode,
  compact,
}: {
  list: PlanList;
  mode: PlanViewMode;
  compact?: boolean;
}) {
  const text = usePlanText(list.key);
  if (text === undefined) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  const plan = parsePlan(text ?? newPlanText(list.name));
  return mode === "board" ? (
    <Board list={list} text={text} plan={plan} />
  ) : (
    <ListView list={list} text={text} plan={plan} compact={compact} />
  );
}

function ListView({
  list,
  text,
  plan,
  compact,
}: {
  list: PlanList;
  text: string | null;
  plan: Plan;
  compact?: boolean;
}) {
  const [showDone, setShowDone] = useState(false);
  const tasks = allTasks(plan);
  const done = tasks.filter((t) => t.task.done);
  const groups = plan.sections
    .map((s, index) => ({
      index,
      title: s.title,
      tasks: tasks.filter((t) => t.ref.section === index && !t.task.done),
    }))
    .filter((g) => g.title !== null || g.tasks.length > 0);
  const row = (t: (typeof tasks)[number]) => (
    <TaskRow
      key={`${t.ref.section}-${t.ref.item}-${t.task.title}`}
      task={t.task}
      compact={compact}
      actions={actionsFor(list.key, text, list.name, t.ref, plan)}
    />
  );
  return (
    <div className={cn("space-y-3", compact ? "p-2" : "p-4")}>
      <QuickAdd onAdd={(task) => addQuick(list.key, text, list.name, task)} />
      {text === null && (
        <p className="px-2 text-muted-foreground text-xs">
          {list.key === INBOX
            ? "For tasks that don't belong to a project."
            : "No tasks yet. Add the first one above."}
        </p>
      )}
      {groups.map((g) => (
        <SectionBlock
          key={g.index}
          title={g.title}
          count={g.tasks.length}
          // Sections only matter once there are some.
          plain={groups.length === 1 && g.title === null}
        >
          {g.tasks.map(row)}
        </SectionBlock>
      ))}
      {done.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone(!showDone)}
            className="flex items-center gap-1 px-2 text-muted-foreground text-xs hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform",
                showDone && "rotate-90",
              )}
            />
            Completed · {done.length}
          </button>
          {showDone && <div className="mt-1">{done.map(row)}</div>}
        </div>
      )}
    </div>
  );
}

function SectionBlock({
  title,
  count,
  plain,
  children,
}: {
  title: string | null;
  count: number;
  plain?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (plain) return <div>{children}</div>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {title ?? "Tasks"}
        <span className="ml-1 font-normal tabular-nums">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

/** Sections as columns; cards drag between them. */
function Board({
  list,
  text,
  plan,
}: {
  list: PlanList;
  text: string | null;
  plan: Plan;
}) {
  const [dragging, setDragging] = useState<TaskRef | null>(null);
  const [newSection, setNewSection] = useState("");
  const tasks = allTasks(plan);
  const columns = taskSections(plan);
  const drop = (section: number, before?: number) => {
    if (!dragging) return;
    const from = dragging;
    setDragging(null);
    void editPlan(list.key, text, list.name, (p) =>
      moveTask(p, from, section, before),
    );
  };
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-4">
      {columns.map((col) => {
        const cards = tasks.filter(
          (t) => t.ref.section === col.index && !t.task.done,
        );
        return (
          <div
            key={col.index}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(col.index)}
            className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40 p-2"
          >
            <div className="flex items-center gap-1 px-1 pb-2 font-medium text-xs">
              {col.title}
              <span className="font-normal text-muted-foreground tabular-nums">
                {cards.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {cards.map((t) => (
                <div
                  key={`${t.ref.section}-${t.ref.item}-${t.task.title}`}
                  draggable
                  onDragStart={() => setDragging(t.ref)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.stopPropagation();
                    drop(col.index, t.ref.item);
                  }}
                  className={cn(
                    "rounded-md border border-border bg-background shadow-xs",
                    dragging?.section === t.ref.section &&
                      dragging.item === t.ref.item &&
                      "opacity-40",
                  )}
                >
                  <TaskRow
                    task={t.task}
                    compact
                    actions={actionsFor(list.key, text, list.name, t.ref, plan)}
                  />
                </div>
              ))}
            </div>
            <div className="pt-2">
              <QuickAdd
                placeholder="Add a task"
                onAdd={(task) =>
                  addQuick(list.key, text, list.name, task, col.index)
                }
              />
            </div>
          </div>
        );
      })}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const title = newSection.trim();
          if (!title) return;
          void editPlan(list.key, text, list.name, (p) => addSection(p, title));
          setNewSection("");
        }}
        className="w-60 shrink-0"
      >
        <div className="flex items-center gap-1 rounded-lg border border-border border-dashed px-2">
          <PlusIcon className="size-3.5 text-muted-foreground" />
          <input
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            placeholder="Add section"
            aria-label="Add section"
            className="h-8 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </form>
    </div>
  );
}

export type SmartFilter = "today" | "week" | "all";

export const SMART_LABEL: Record<SmartFilter, string> = {
  today: "Today",
  week: "Next 7 days",
  all: "All",
};

/** Tasks from every plan: due today, this week, or all of them. */
export function SmartView({
  filter,
  lists,
}: {
  filter: SmartFilter;
  lists: PlanList[];
}) {
  const texts = usePlanTexts(lists.map((l) => l.key));
  const inbox = lists.find((l) => l.key === INBOX);
  const items = lists.flatMap((list) => {
    const text = texts[list.key];
    if (!text) return [];
    const plan = parsePlan(text);
    return allTasks(plan)
      .filter((t) => !t.task.done)
      .filter((t) => {
        if (filter === "all") return true;
        if (!t.task.due) return false;
        const days = daysUntil(t.task.due);
        return filter === "today" ? days <= 0 : days <= 6;
      })
      .map((t) => ({ ...t, list, text, plan }));
  });

  // Overdue, then by day; undated last, by plan.
  const groups = new Map<string, typeof items>();
  const groupOf = (task: Task, list: PlanList) => {
    if (filter === "all") return list.name;
    const days = daysUntil(task.due ?? "");
    if (days < 0) return "Overdue";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return new Date(`${task.due}T00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
  };
  const sorted = [...items].sort(
    (a, b) =>
      (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999") ||
      b.task.priority - a.task.priority,
  );
  for (const item of sorted) {
    const g = groupOf(item.task, item.list);
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }

  return (
    <div className="space-y-3 p-4">
      {inbox && (
        <QuickAdd
          autoFocus
          placeholder={
            filter === "today"
              ? "Add a task for today, to the Inbox"
              : "Add a task to the Inbox"
          }
          defaults={{ due: filter === "today" ? dayFromToday(0) : undefined }}
          onAdd={(task) =>
            addQuick(inbox.key, texts[inbox.key], inbox.name, task)
          }
        />
      )}
      {items.length === 0 && (
        <p className="px-2 py-6 text-center text-muted-foreground text-sm">
          {filter === "today"
            ? "Nothing due today."
            : filter === "week"
              ? "Nothing due this week."
              : "No tasks yet."}
        </p>
      )}
      {[...groups].map(([title, group]) => (
        <SectionBlock key={title} title={title} count={group.length}>
          {group.map((t) => (
            <TaskRow
              key={`${t.list.key}-${t.ref.section}-${t.ref.item}-${t.task.title}`}
              task={t.task}
              context={filter === "all" ? undefined : t.list.name}
              actions={actionsFor(
                t.list.key,
                t.text,
                t.list.name,
                t.ref,
                t.plan,
              )}
            />
          ))}
        </SectionBlock>
      ))}
    </div>
  );
}
