import { type ReactNode, useState } from "react";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CoffeeIcon,
  InboxIcon,
  PlusIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daysUntil, dayFromToday } from "@/lib/plan/dates";
import {
  addSection,
  addTask,
  deleteTask,
  moveTask,
  newPlanText,
  type Plan,
  parsePlan,
  type Task,
  type TaskRef,
  today,
  toggleSubtask,
  toggleTask,
  updateTask,
} from "@/lib/plan/plan-file";
import {
  INBOX,
  type PlanList,
  usePlanText,
  usePlanTexts,
} from "@/lib/plan/plan-store";
import type { QuickTask } from "@/lib/plan/quick-add";
import {
  isReadingSection,
  READING_SECTION,
  type ReadingItem,
  type ReadingStatus,
  readingItems,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
  setReadingStatus,
  workTasks,
} from "@/lib/plan/reading";
import { cn } from "@/lib/utils";
import {
  type DragTask,
  editPlan,
  moveToPlan,
  useTaskDrag,
} from "./plan-actions";
import { ProjectIcon } from "./project-icon";
import {
  Check,
  DueBadge,
  PRIORITY_COLOR,
  Progress,
  QuickAdd,
  Tags,
  type TaskActions,
  type TaskContext,
  TaskRow,
  TitleText,
} from "./task-parts";

export type PlanViewMode = "list" | "board";

/** A task picked in a list, its details shown beside. */
export interface Selected {
  list: PlanList;
  ref: TaskRef;
}

const sameRef = (a?: TaskRef, b?: TaskRef) =>
  !!a && !!b && a.section === b.section && a.item === b.item;

/** The sections tasks go in (the reading list apart). */
export const workSections = (plan: Plan) =>
  plan.sections.flatMap((s, index) =>
    s.title === null || isReadingSection(s.title)
      ? []
      : [{ index, title: s.title }],
  );

export function actionsFor(
  list: PlanList,
  ref: TaskRef,
  plan: Plan,
): TaskActions {
  const edit = (change: (p: Plan) => Plan) => editPlan(list, change);
  return {
    toggle: () => edit((p) => toggleTask(p, ref)),
    toggleSub: (i) => edit((p) => toggleSubtask(p, ref, i)),
    change: (patch) => edit((p) => updateTask(p, ref, patch)),
    remove: () => edit((p) => deleteTask(p, ref)),
    sections: workSections(plan),
    section: ref.section,
    move: (section) => edit((p) => moveTask(p, ref, section)),
  };
}

/** A new task: in the first section that isn't the reading list. */
const addQuick = (list: PlanList, task: QuickTask, section?: number) =>
  editPlan(list, (p) => {
    const first = section ?? workSections(p)[0]?.index;
    if (first !== undefined) return addTask(p, task, first);
    // None yet: a To do section, before any reading list.
    const reading = p.sections.findIndex((s) => isReadingSection(s.title));
    if (reading < 0) return addTask(p, task);
    const withTodo = addSection(p, "To do");
    const moved = withTodo.sections.pop();
    if (moved) withTodo.sections.splice(reading, 0, moved);
    return addTask(withTodo, task, reading);
  });

/** Drag props for a row or card, and dropping before it. */
function useDragRow(
  list: PlanList,
  ref: TaskRef,
  id: string,
  onDrop: (drag: DragTask) => void,
  reading?: boolean,
) {
  const drag = useTaskDrag((s) => s.drag);
  const over = useTaskDrag((s) => s.over === id);
  const dragging = drag?.list.key === list.key && sameRef(drag.ref, ref);
  return {
    dragging,
    over: over && !!drag && !dragging,
    props: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        useTaskDrag.getState().start({ list, ref, reading });
      },
      onDragEnd: () => useTaskDrag.getState().end(),
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        useTaskDrag.getState().setOver(id);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const d = useTaskDrag.getState().drag;
        useTaskDrag.getState().end();
        if (d) onDrop(d);
      },
    },
  };
}

/** Dropped before a task: moved there (or into this plan, from another). */
function dropBefore(list: PlanList, section: number, before?: number) {
  return (d: DragTask) => {
    if (d.list.key !== list.key) {
      void moveToPlan(d, list);
      return;
    }
    void editPlan(list, (p) => moveTask(p, d.ref, section, before));
  };
}

export function Empty({
  icon,
  color,
  title,
  text,
}: {
  icon: ReactNode;
  color: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span
        className="mb-3 flex size-14 items-center justify-center rounded-2xl"
        style={{
          color,
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        }}
      >
        {icon}
      </span>
      <p className="font-medium text-sm">{title}</p>
      {text && (
        <p className="mt-1 max-w-72 text-muted-foreground text-xs">{text}</p>
      )}
    </div>
  );
}

/** Dropping onto a whole area (a section, a column). */
function dropArea(id: string, onDrop: (d: DragTask) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      useTaskDrag.getState().setOver(id);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const d = useTaskDrag.getState().drag;
      useTaskDrag.getState().end();
      if (d) onDrop(d);
    },
  };
}

function Group({
  title,
  count,
  color,
  children,
  dropId,
  onDrop,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  color?: string;
  children: ReactNode;
  dropId?: string;
  onDrop?: (d: DragTask) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const over = useTaskDrag((s) => !!dropId && s.over === dropId && !!s.drag);
  return (
    <section
      {...(dropId && onDrop ? dropArea(dropId, onDrop) : {})}
      className={cn("rounded-lg transition-colors", over && "bg-primary/5")}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-semibold text-muted-foreground text-xs hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {color && (
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        {title}
        <span className="font-normal tabular-nums opacity-70">{count}</span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </section>
  );
}

/* ─────────────────────────── A plan's tasks ─────────────────────────── */

interface ViewProps {
  list: PlanList;
  plan: Plan;
  inline?: boolean;
  selected?: Selected | null;
  onSelect?: (s: Selected) => void;
  isNew: boolean;
}

export function PlanView({
  list,
  mode,
  inline,
  selected,
  onSelect,
}: {
  list: PlanList;
  mode: PlanViewMode;
  /** Narrow: details open under the task, columns stack. */
  inline?: boolean;
  selected?: Selected | null;
  onSelect?: (s: Selected) => void;
}) {
  const text = usePlanText(list.key);
  if (text === undefined) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  const plan = parsePlan(text ?? newPlanText(list.name));
  const props = {
    list,
    plan,
    inline,
    selected,
    onSelect,
    isNew: text === null,
  };
  return mode === "board" ? <Board {...props} /> : <ListView {...props} />;
}

function ListView({
  list,
  plan,
  inline,
  selected,
  onSelect,
  isNew,
}: ViewProps) {
  const tasks = workTasks(plan);
  const open = tasks.filter((t) => !t.task.done);
  const done = tasks.filter((t) => t.task.done);
  const sections = workSections(plan);
  const loose = open.filter((t) => plan.sections[t.ref.section].title === null);
  const row = (t: (typeof tasks)[number]) => (
    <DraggableRow
      key={`${t.ref.section}-${t.ref.item}-${t.task.title}`}
      list={list}
      plan={plan}
      task={t.task}
      taskRef={t.ref}
      inline={inline}
      selected={selected?.list.key === list.key && sameRef(selected.ref, t.ref)}
      onSelect={onSelect}
    />
  );
  return (
    <div className={cn("space-y-2", inline ? "p-2" : "px-6 py-4")}>
      <QuickAdd onAdd={(task) => addQuick(list, task)} />
      {open.length === 0 && (
        <Empty
          icon={
            list.key === INBOX ? (
              <InboxIcon className="size-6" />
            ) : (
              <CoffeeIcon className="size-6" />
            )
          }
          color={list.key === INBOX ? "#0ea5e9" : "#22c55e"}
          title={
            isNew
              ? list.key === INBOX
                ? "For tasks that don't belong to a project."
                : "No tasks yet. Add the first one above."
              : "All done here."
          }
        />
      )}
      {loose.map(row)}
      {open.length > 0 &&
        sections.map((s) => {
          const items = open.filter((t) => t.ref.section === s.index);
          return (
            <Group
              key={s.index}
              title={s.title}
              count={items.length}
              dropId={`section:${list.key}:${s.index}`}
              onDrop={dropBefore(list, s.index)}
            >
              {items.map(row)}
            </Group>
          );
        })}
      {done.length > 0 && (
        <Group
          title="Completed"
          count={done.length}
          color="#22c55e"
          defaultOpen={false}
        >
          {done.map(row)}
        </Group>
      )}
    </div>
  );
}

function DraggableRow({
  list,
  plan,
  task,
  taskRef,
  inline,
  selected,
  onSelect,
  context,
}: {
  list: PlanList;
  plan: Plan;
  task: Task;
  taskRef: TaskRef;
  inline?: boolean;
  selected?: boolean;
  onSelect?: (s: Selected) => void;
  context?: TaskContext;
}) {
  const id = `row:${list.key}:${taskRef.section}:${taskRef.item}`;
  const { props, over, dragging } = useDragRow(
    list,
    taskRef,
    id,
    dropBefore(list, taskRef.section, taskRef.item),
  );
  return (
    <div className={cn(dragging && "opacity-40")}>
      <TaskRow
        task={task}
        actions={actionsFor(list, taskRef, plan)}
        inline={inline}
        selected={selected}
        onSelect={() => onSelect?.({ list, ref: taskRef })}
        drag={props}
        dropMarker={over}
        context={context}
      />
    </div>
  );
}

const COLUMN_COLORS = [
  "#64748b",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

/** Columns of cards: side by side when there's room, stacked when not. */
function BoardFrame({
  children,
  add,
}: {
  children: ReactNode;
  add?: ReactNode;
}) {
  return (
    <div className="@container h-full">
      <div className="flex h-full @3xl:flex-row flex-col @3xl:items-start gap-3 @3xl:overflow-x-auto overflow-y-auto @3xl:overflow-y-hidden @3xl:p-5 p-3">
        {children}
        {add}
      </div>
    </div>
  );
}

function Column({
  title,
  color,
  count,
  dropId,
  onDrop,
  children,
  footer,
}: {
  title: string;
  color: string;
  count: number;
  dropId: string;
  onDrop: (d: DragTask) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const over = useTaskDrag((s) => s.over === dropId && !!s.drag);
  return (
    <div
      {...dropArea(dropId, onDrop)}
      className={cn(
        "flex @3xl:max-h-full @3xl:w-72 w-full shrink-0 flex-col rounded-xl bg-muted/50 transition-colors",
        over && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-semibold text-sm">{title}</span>
        <span className="rounded-full bg-background px-1.5 text-[11px] text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      <div className="min-h-10 space-y-2 overflow-y-auto px-2 pb-2">
        {children}
        {over && (
          <div className="h-10 rounded-lg border-2 border-primary/40 border-dashed" />
        )}
      </div>
      {footer && <div className="px-2 pb-2">{footer}</div>}
    </div>
  );
}

function Card({
  id,
  list,
  taskRef,
  onDrop,
  reading,
  children,
  edge,
  onClick,
  selected,
}: {
  id: string;
  list: PlanList;
  taskRef: TaskRef;
  onDrop: (d: DragTask) => void;
  reading?: boolean;
  children: ReactNode;
  edge?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  const { props, over, dragging } = useDragRow(
    list,
    taskRef,
    id,
    onDrop,
    reading,
  );
  return (
    <>
      {over && (
        <div className="h-10 rounded-lg border-2 border-primary/40 border-dashed" />
      )}
      <div
        {...props}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") onClick?.();
        }}
        className={cn(
          "cursor-grab rounded-lg border bg-background p-2.5 shadow-xs transition-shadow hover:shadow-md",
          selected ? "border-primary" : "border-border",
          dragging && "opacity-40",
        )}
        style={edge ? { borderLeft: `3px solid ${edge}` } : undefined}
      >
        {children}
      </div>
    </>
  );
}

function Board({ list, plan, selected, onSelect }: ViewProps) {
  const [newSection, setNewSection] = useState("");
  const tasks = workTasks(plan).filter((t) => !t.task.done);
  const columns = workSections(plan);
  return (
    <BoardFrame
      add={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const title = newSection.trim();
            if (!title) return;
            void editPlan(list, (p) => addSection(p, title));
            setNewSection("");
          }}
          className="@3xl:w-60 w-full shrink-0"
        >
          <div className="flex items-center gap-1.5 rounded-xl border border-border border-dashed px-3">
            <PlusIcon className="size-3.5 text-muted-foreground" />
            <input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              placeholder="Add section"
              aria-label="Add section"
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </form>
      }
    >
      {columns.map((col, i) => {
        const cards = tasks.filter((t) => t.ref.section === col.index);
        return (
          <Column
            key={col.index}
            title={col.title}
            color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
            count={cards.length}
            dropId={`col:${list.key}:${col.index}`}
            onDrop={dropBefore(list, col.index)}
            footer={
              <QuickAdd
                className="bg-transparent"
                onAdd={(task) => addQuick(list, task, col.index)}
              />
            }
          >
            {cards.map((t) => {
              const actions = actionsFor(list, t.ref, plan);
              const meta =
                t.task.due ||
                t.task.subtasks.length > 0 ||
                /(^|\s)#[^\s]/.test(t.task.title);
              return (
                <Card
                  key={`${t.ref.section}-${t.ref.item}-${t.task.title}`}
                  id={`card:${list.key}:${t.ref.section}:${t.ref.item}`}
                  list={list}
                  taskRef={t.ref}
                  onDrop={dropBefore(list, col.index, t.ref.item)}
                  edge={
                    t.task.priority
                      ? PRIORITY_COLOR[t.task.priority]
                      : undefined
                  }
                  selected={
                    selected?.list.key === list.key &&
                    sameRef(selected.ref, t.ref)
                  }
                  onClick={() => onSelect?.({ list, ref: t.ref })}
                >
                  <div className="flex items-start gap-2">
                    <span className="pt-px">
                      <Check
                        done={t.task.done}
                        priority={t.task.priority}
                        onToggle={actions.toggle}
                      />
                    </span>
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                      <TitleText title={t.task.title} />
                    </span>
                  </div>
                  {meta && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-[26px]">
                      {t.task.due && <DueBadge due={t.task.due} icon />}
                      <Progress subtasks={t.task.subtasks} />
                      <Tags title={t.task.title} />
                    </div>
                  )}
                </Card>
              );
            })}
          </Column>
        );
      })}
    </BoardFrame>
  );
}

/* ─────────────────────────── Reading lists ─────────────────────────── */

function StatusPill({
  status,
  onChange,
}: {
  status: ReadingStatus;
  onChange: (s: ReadingStatus) => void;
}) {
  const color = STATUS_COLOR[status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Status: ${STATUS_LABEL[status]}`}
          className="shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px]"
          style={{
            color,
            backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}
        >
          {STATUS_LABEL[status]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {STATUSES.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onChange(s)}>
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: STATUS_COLOR[s] }}
            />
            {STATUS_LABEL[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const setStatus = (list: PlanList, ref: TaskRef, status: ReadingStatus) =>
  editPlan(list, (p) => setReadingStatus(p, ref, status, today()));

function ReadingRow({
  list,
  item,
  context,
  index,
}: {
  list: PlanList;
  item: ReadingItem;
  context?: TaskContext;
  index?: number;
}) {
  const id = `read:${list.key}:${item.ref.section}:${item.ref.item}`;
  const { props, over, dragging } = useDragRow(
    list,
    item.ref,
    id,
    dropBefore(list, item.ref.section, item.ref.item),
    true,
  );
  return (
    <div className={cn("relative", dragging && "opacity-40")}>
      {over && (
        <span className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded-full bg-primary" />
      )}
      <div
        {...props}
        className="group flex cursor-grab items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/70"
      >
        {index !== undefined && (
          <span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
            {index}
          </span>
        )}
        <BookOpenIcon
          className="size-4 shrink-0"
          style={{ color: STATUS_COLOR[item.status] }}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            item.status === "cited" && "text-muted-foreground",
          )}
          title={item.title}
        >
          {item.title}
        </span>
        {context && (
          <span className="flex max-w-32 items-center gap-1 text-[11px] text-muted-foreground">
            {context.icon}
            <span className="truncate">{context.name}</span>
          </span>
        )}
        <StatusPill
          status={item.status}
          onChange={(s) => void setStatus(list, item.ref, s)}
        />
      </div>
    </div>
  );
}

/** A plan's reading list: in reading order, or by status on a board. */
export function ReadingView({
  list,
  mode,
  inline,
}: {
  list: PlanList;
  mode: PlanViewMode;
  inline?: boolean;
}) {
  const text = usePlanText(list.key);
  const [title, setTitle] = useState("");
  if (text === undefined) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  const plan = parsePlan(text ?? newPlanText(list.name));
  const items = readingItems(plan);

  if (mode === "board") {
    return (
      <BoardFrame>
        {STATUSES.map((s) => {
          const cards = items.filter((r) => r.status === s);
          const toStatus = (d: DragTask) => {
            if (d.list.key === list.key) void setStatus(list, d.ref, s);
          };
          return (
            <Column
              key={s}
              title={STATUS_LABEL[s]}
              color={STATUS_COLOR[s]}
              count={cards.length}
              dropId={`status:${list.key}:${s}`}
              onDrop={toStatus}
            >
              {cards.map((r) => (
                <Card
                  key={`${r.ref.item}-${r.title}`}
                  id={`rcard:${list.key}:${r.ref.item}`}
                  list={list}
                  taskRef={r.ref}
                  reading
                  onDrop={toStatus}
                >
                  <p className="flex items-start gap-2 text-sm leading-snug">
                    <BookOpenIcon
                      className="mt-0.5 size-3.5 shrink-0"
                      style={{ color: STATUS_COLOR[s] }}
                    />
                    {r.title}
                  </p>
                </Card>
              ))}
            </Column>
          );
        })}
      </BoardFrame>
    );
  }

  const active = items.filter((r) => r.status !== "cited");
  const cited = items.filter((r) => r.status === "cited");
  return (
    <div className={cn("space-y-2", inline ? "p-2" : "px-6 py-4")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = title.trim();
          if (!name) return;
          void editPlan(list, (p) => {
            const at = p.sections.findIndex((s) => isReadingSection(s.title));
            const withList = at >= 0 ? p : addSection(p, READING_SECTION);
            const index = at >= 0 ? at : withList.sections.length - 1;
            return addTask(
              withList,
              { title: `${name} #reading/to-read` },
              index,
            );
          });
          setTitle("");
        }}
        className="flex items-center gap-2 rounded-lg border border-transparent bg-muted/60 px-2.5 focus-within:border-ring focus-within:bg-background"
      >
        <PlusIcon className="size-4 text-primary" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add something to read"
          aria-label="Add something to read"
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </form>
      {items.length === 0 ? (
        <Empty
          icon={<BookOpenIcon className="size-6" />}
          color="#8b5cf6"
          title="Nothing to read yet."
          text="Right-click a paper in your Zotero library and choose Add to reading list. It moves along by itself as you open, highlight, take notes on and cite it."
        />
      ) : (
        <>
          <div>
            {active.map((r, i) => (
              <ReadingRow
                key={`${r.ref.item}-${r.title}`}
                list={list}
                item={r}
                index={i + 1}
              />
            ))}
          </div>
          {cited.length > 0 && (
            <Group
              title="Cited"
              count={cited.length}
              color={STATUS_COLOR.cited}
              defaultOpen={false}
            >
              {cited.map((r) => (
                <ReadingRow
                  key={`${r.ref.item}-${r.title}`}
                  list={list}
                  item={r}
                />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Smart lists ─────────────────────────── */

export type SmartFilter =
  | "today"
  | "tomorrow"
  | "week"
  | "reading"
  | "all"
  | "completed";

export const SMART_LABEL: Record<SmartFilter, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  reading: "Reading list",
  all: "All tasks",
  completed: "Completed",
};

export const contextOf = (list: PlanList): TaskContext => ({
  name: list.key === INBOX ? "Inbox" : list.name,
  icon:
    list.key === INBOX ? (
      <InboxIcon className="size-3 text-sky-500" />
    ) : (
      <ProjectIcon list={list} className="size-3" />
    ),
});

const dayTitle = (iso: string) => {
  const days = daysUntil(iso);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return new Date(`${iso}T00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
};

/** Tasks gathered from every plan: by date, by plan, or finished. */
export function SmartView({
  filter,
  lists,
  selected,
  onSelect,
}: {
  filter: SmartFilter;
  lists: PlanList[];
  selected?: Selected | null;
  onSelect?: (s: Selected) => void;
}) {
  const texts = usePlanTexts(lists.map((l) => l.key));
  const inbox = lists.find((l) => l.key === INBOX);
  const plans = lists.flatMap((list) => {
    const text = texts[list.key];
    return text ? [{ list, plan: parsePlan(text) }] : [];
  });

  if (filter === "reading") {
    const rows = plans.flatMap(({ list, plan }) =>
      readingItems(plan).map((item) => ({ list, item })),
    );
    const order: ReadingStatus[] = ["reading", "to-read", "read", "noted"];
    const active = rows.filter((r) => r.item.status !== "cited");
    return (
      <div className="space-y-2 px-6 py-4">
        {active.length === 0 && (
          <Empty
            icon={<BookOpenIcon className="size-6" />}
            color="#8b5cf6"
            title="Nothing to read yet."
            text="Right-click a paper in your Zotero library and choose Add to reading list."
          />
        )}
        {order.map((status) => {
          const group = rows.filter((r) => r.item.status === status);
          if (group.length === 0) return null;
          return (
            <Group
              key={status}
              title={STATUS_LABEL[status]}
              count={group.length}
              color={STATUS_COLOR[status]}
            >
              {group.map((r) => (
                <ReadingRow
                  key={`${r.list.key}-${r.item.ref.item}-${r.item.title}`}
                  list={r.list}
                  item={r.item}
                  context={contextOf(r.list)}
                />
              ))}
            </Group>
          );
        })}
      </div>
    );
  }

  const tasks = plans.flatMap(({ list, plan }) =>
    workTasks(plan).map((t) => ({ ...t, list, plan })),
  );
  const shown = tasks.filter((t) => {
    if (filter === "completed") return t.task.done;
    if (t.task.done) return false;
    if (filter === "all") return true;
    if (!t.task.due) return false;
    const days = daysUntil(t.task.due);
    if (filter === "today") return days <= 0;
    if (filter === "tomorrow") return days === 1;
    return days <= 6;
  });

  const groups = new Map<string, typeof shown>();
  const groupOf = (t: (typeof shown)[number]) => {
    if (filter === "completed") {
      return t.task.doneOn ? dayTitle(t.task.doneOn) : "Earlier";
    }
    if (filter === "all") return contextOf(t.list).name;
    const days = daysUntil(t.task.due ?? "");
    return days < 0 ? "Overdue" : dayTitle(t.task.due ?? "");
  };
  const sorted = [...shown].sort((a, b) =>
    filter === "completed"
      ? (b.task.doneOn ?? "").localeCompare(a.task.doneOn ?? "")
      : (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999") ||
        b.task.priority - a.task.priority,
  );
  for (const t of sorted) {
    const g = groupOf(t);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }

  const empty: Record<Exclude<SmartFilter, "reading">, [string, string]> = {
    today: ["Nothing due today.", "#3b82f6"],
    tomorrow: ["Nothing due tomorrow.", "#f59e0b"],
    week: ["Nothing due this week.", "#8b5cf6"],
    all: ["No tasks yet.", "#64748b"],
    completed: ["Nothing finished yet.", "#22c55e"],
  };
  const addDefaults =
    filter === "today"
      ? { due: dayFromToday(0) }
      : filter === "tomorrow"
        ? { due: dayFromToday(1) }
        : undefined;
  return (
    <div className="space-y-2 px-6 py-4">
      {inbox && filter !== "completed" && (
        <QuickAdd
          autoFocus
          placeholder={
            filter === "today"
              ? "Add a task for today"
              : filter === "tomorrow"
                ? "Add a task for tomorrow"
                : "Add a task"
          }
          defaults={addDefaults}
          onAdd={(task) => addQuick(inbox, task)}
        />
      )}
      {shown.length === 0 && (
        <Empty
          icon={
            filter === "completed" ? (
              <CheckCircle2Icon className="size-6" />
            ) : (
              <CoffeeIcon className="size-6" />
            )
          }
          color={empty[filter][1]}
          title={empty[filter][0]}
        />
      )}
      {[...groups].map(([title, group]) => (
        <Group
          key={title}
          title={title}
          count={group.length}
          color={title === "Overdue" ? "#ef4444" : undefined}
        >
          {group.map((t) => (
            <DraggableRow
              key={`${t.list.key}-${t.ref.section}-${t.ref.item}-${t.task.title}`}
              list={t.list}
              plan={t.plan}
              task={t.task}
              taskRef={t.ref}
              selected={
                selected?.list.key === t.list.key &&
                sameRef(selected.ref, t.ref)
              }
              onSelect={onSelect}
              context={filter === "all" ? undefined : contextOf(t.list)}
            />
          ))}
        </Group>
      ))}
    </div>
  );
}
