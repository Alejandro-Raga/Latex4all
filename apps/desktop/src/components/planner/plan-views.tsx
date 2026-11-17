import { type ReactNode, useState } from "react";
import {
  ArrowUpFromLineIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  CoffeeIcon,
  CornerDownRightIcon,
  FlagIcon,
  FolderInputIcon,
  InboxIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  deleteSection,
  deleteTask,
  moveTask,
  nestTask,
  newPlanText,
  type Plan,
  type Priority,
  parsePlan,
  projectDue,
  promoteSubtask,
  renameSection,
  type Task,
  type TaskRef,
  toggleSubtask,
  toggleTask,
  updateTask,
} from "@/lib/plan/plan-file";
import {
  INBOX,
  type PlanList,
  usePlanLists,
  usePlanText,
  usePlanTexts,
} from "@/lib/plan/plan-store";
import type { QuickTask } from "@/lib/plan/quick-add";
import { isSpecialSection, readingItems, workTasks } from "@/lib/plan/reading";
import { cn } from "@/lib/utils";
import { AllReading } from "./reading-views";
import {
  dropOnSection,
  dropOnTask,
  editPlan,
  moveToPlan,
} from "./plan-actions";
import {
  type DragTask,
  DropMarker,
  useDropArea,
  useTaskDnd,
} from "./planner-dnd";
import { ProjectIcon } from "./project-icon";
import {
  Check,
  DueBadge,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
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
    s.title === null || isSpecialSection(s.title)
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

/** A new task: in the given section, else the first that isn't reading. */
const addQuick = (list: PlanList, task: QuickTask, section?: number) =>
  editPlan(list, (p) => {
    const first = section ?? workSections(p)[0]?.index;
    if (first !== undefined) return addTask(p, task, first);
    // None yet: a To do section, before any reading list.
    const reading = p.sections.findIndex((s) => isSpecialSection(s.title));
    if (reading < 0) return addTask(p, task);
    const withTodo = addSection(p, "To do");
    const moved = withTodo.sections.pop();
    if (moved) withTodo.sections.splice(reading, 0, moved);
    return addTask(withTodo, task, reading);
  });

export function Empty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="font-medium text-sm">{title}</p>
      {text && (
        <p className="mt-1 max-w-72 text-muted-foreground text-xs">{text}</p>
      )}
    </div>
  );
}

/* ─────────────────────────── Menus ─────────────────────────── */

/** The places a task can move to: the Inbox and the other projects. */
export function MoveToMenu({
  list,
  onPick,
  label = "Move to",
}: {
  list: PlanList;
  onPick: (target: PlanList) => void;
  label?: string;
}) {
  const lists = usePlanLists().filter((l) => l.key !== list.key);
  const inbox = lists.find((l) => l.key === INBOX);
  const projects = lists
    .filter((l) => l.key !== INBOX)
    .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInputIcon className="size-3.5" />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-52 overflow-y-auto">
        {inbox && (
          <ContextMenuItem onClick={() => onPick(inbox)}>
            <InboxIcon className="size-3.5" />
            Inbox
          </ContextMenuItem>
        )}
        {projects.length > 0 && <ContextMenuSeparator />}
        {projects.map((p) => (
          <ContextMenuItem key={p.key} onClick={() => onPick(p)}>
            <ProjectIcon list={p} className="size-3.5" />
            <span className="truncate">{p.name}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** A task's right-click menu: date, priority, where it goes, nesting. */
function TaskMenu({
  list,
  plan,
  taskRef,
  task,
  children,
}: {
  list: PlanList;
  plan: Plan;
  taskRef: TaskRef;
  task: Task;
  children: ReactNode;
}) {
  const edit = (change: (p: Plan) => Plan) => void editPlan(list, change);
  const sections = workSections(plan).filter(
    (s) => s.index !== taskRef.section,
  );
  const others = workTasks(plan).filter(
    (t) => !t.task.done && !sameRef(t.ref, taskRef),
  );
  const drag: DragTask = { list, ref: taskRef, label: task.title };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CalendarIcon className="size-3.5" />
            Date
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            {(
              [
                ["Today", 0],
                ["Tomorrow", 1],
                ["Next week", 7],
              ] as const
            ).map(([label, days]) => (
              <ContextMenuItem
                key={label}
                onClick={() =>
                  edit((p) =>
                    updateTask(p, taskRef, { due: dayFromToday(days) }),
                  )
                }
              >
                {label}
              </ContextMenuItem>
            ))}
            {task.due && (
              <ContextMenuItem
                onClick={() =>
                  edit((p) => updateTask(p, taskRef, { due: undefined }))
                }
              >
                No date
              </ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FlagIcon className="size-3.5" />
            Priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-36">
            {([4, 3, 2, 1, 0] as Priority[]).map((p) => (
              <ContextMenuItem
                key={p}
                onClick={() =>
                  edit((pl) => updateTask(pl, taskRef, { priority: p }))
                }
              >
                <FlagIcon
                  className="size-3.5"
                  style={{ color: PRIORITY_COLOR[p] }}
                  fill={p ? PRIORITY_COLOR[p] : "none"}
                />
                {PRIORITY_LABEL[p]}
                {task.priority === p && (
                  <CheckIcon className="ml-auto size-3.5" />
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <MoveToMenu
          list={list}
          onPick={(target) => void moveToPlan(drag, target)}
        />
        {sections.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ListIcon className="size-3.5" />
              Move to heading
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 w-48 overflow-y-auto">
              {sections.map((s) => (
                <ContextMenuItem
                  key={s.index}
                  onClick={() => edit((p) => moveTask(p, taskRef, s.index))}
                >
                  <span className="truncate">{s.title}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {others.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <CornerDownRightIcon className="size-3.5" />
              Make subtask of
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 w-60 overflow-y-auto">
              {others.slice(0, 30).map((t) => (
                <ContextMenuItem
                  key={`${t.ref.section}-${t.ref.item}`}
                  onClick={() => edit((p) => nestTask(p, taskRef, t.ref))}
                >
                  <span className="truncate">
                    <TitleText title={t.task.title} />
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => edit((p) => deleteTask(p, taskRef))}
        >
          <Trash2Icon className="size-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ─────────────────────────── Tasks and subtasks ─────────────────────────── */

function SubtaskRow({
  list,
  parent,
  index,
  sub,
}: {
  list: PlanList;
  parent: TaskRef;
  index: number;
  sub: Task;
}) {
  const id = `sub:${list.key}:${parent.section}:${parent.item}:${index}`;
  const dnd = useTaskDnd(
    id,
    { list, ref: parent, sub: index, label: sub.title },
    {
      accepts: "tasks",
      // Dropped on a subtask: before it, among its parent's subtasks.
      onDrop: (d, zone) =>
        dropOnTask(list, parent, d, zone === "after" ? "after" : "inside"),
    },
  );
  const edit = (change: (p: Plan) => Plan) => void editPlan(list, change);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dnd.ref}
          {...(dnd.handlers as React.HTMLAttributes<HTMLDivElement>)}
          className={cn(
            "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/70",
            dnd.dragging && "opacity-30",
          )}
        >
          <DropMarker zone={dnd.over === "inside" ? null : dnd.over} />
          <Check
            small
            done={sub.done}
            priority={sub.priority}
            onToggle={() => edit((p) => toggleSubtask(p, parent, index))}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              sub.done && "text-muted-foreground line-through",
            )}
          >
            <TitleText title={sub.title} />
          </span>
          {sub.due && !sub.done && <DueBadge due={sub.due} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={() => edit((p) => promoteSubtask(p, parent, index))}
        >
          <ArrowUpFromLineIcon className="size-3.5" />
          Make it a task
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() =>
            edit((p) => {
              const host = p.sections[parent.section]?.items[parent.item];
              if (host?.kind !== "task") return p;
              return updateTask(p, parent, {
                subtasks: host.task.subtasks.filter((_, i) => i !== index),
              });
            })
          }
        >
          <Trash2Icon className="size-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A task in a list: drags, takes drops, opens on click, nests its subtasks. */
function TaskItem({
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
  const id = `task:${list.key}:${taskRef.section}:${taskRef.item}`;
  const dnd = useTaskDnd(
    id,
    { list, ref: taskRef, label: task.title },
    {
      accepts: "tasks",
      nestable: true,
      onDrop: (d, zone) => dropOnTask(list, taskRef, d, zone),
    },
  );
  return (
    <TaskRow
      task={task}
      actions={actionsFor(list, taskRef, plan)}
      inline={inline}
      selected={selected}
      onSelect={() => onSelect?.({ list, ref: taskRef })}
      dnd={dnd}
      context={context}
      menu={(row) => (
        <TaskMenu list={list} plan={plan} taskRef={taskRef} task={task}>
          {row}
        </TaskMenu>
      )}
      subtasks={task.subtasks.map((s, i) => (
        <SubtaskRow
          key={`${i}-${s.title}`}
          list={list}
          parent={taskRef}
          index={i}
          sub={s}
        />
      ))}
    />
  );
}

/* ─────────────────────────── Headings ─────────────────────────── */

/** A heading's menu: rename it, or delete it (its tasks stay). */
function HeadingMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Heading options"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover/heading:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onRename}>
          <PencilIcon className="size-3.5" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon className="size-3.5" />
          Delete heading
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeadingTitle({
  title,
  editing,
  onDone,
  className,
}: {
  title: string;
  editing: boolean;
  onDone: (title: string | null) => void;
  className?: string;
}) {
  const [value, setValue] = useState(title);
  if (!editing) return <span className={className}>{title}</span>;
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: renaming starts here.
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
      }}
      aria-label="Heading"
      className={cn(
        "min-w-0 flex-1 rounded bg-background px-1 outline-none ring-1 ring-ring",
        className,
      )}
    />
  );
}

/** A heading in a project's list, as in Things: a title over its tasks. */
function Heading({
  list,
  index,
  title,
  count,
  children,
}: {
  list: PlanList;
  index: number;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const drop = useDropArea(`head:${list.key}:${index}`, {
    accepts: "tasks",
    onDrop: (d) => dropOnSection(list, index, d),
  });
  return (
    <section className="pt-3">
      <div
        ref={drop.ref}
        className={cn(
          "group/heading flex items-center gap-1.5 border-border border-b px-1 pb-1.5",
          drop.over && "border-primary",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Fold" : "Unfold"}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon
            className={cn("size-4 transition-transform", open && "rotate-90")}
          />
        </button>
        <HeadingTitle
          title={title}
          editing={editing}
          className="font-semibold text-[15px] text-foreground"
          onDone={(name) => {
            setEditing(false);
            if (name && name !== title) {
              void editPlan(list, (p) => renameSection(p, index, name));
            }
          }}
        />
        <span className="text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
        <span className="flex-1" />
        <HeadingMenu
          onRename={() => setEditing(true)}
          onDelete={() => void editPlan(list, (p) => deleteSection(p, index))}
        />
      </div>
      {open && <div className="pt-1">{children}</div>}
      {open && count === 0 && (
        <p className="px-3 py-2 text-muted-foreground/70 text-xs">
          Drop tasks here
        </p>
      )}
    </section>
  );
}

function AddHeading({ list }: { list: PlanList }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
      >
        <PlusIcon className="size-3.5" />
        Add heading
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const name = title.trim();
        if (name) {
          void editPlan(list, (p) => {
            // Before the reading list, which stays last.
            const next = addSection(p, name);
            const reading = next.sections.findIndex((s) =>
              isSpecialSection(s.title),
            );
            if (reading >= 0 && reading < next.sections.length - 1) {
              const added = next.sections.pop();
              if (added) next.sections.splice(reading, 0, added);
            }
            return next;
          });
        }
        setTitle("");
        setAdding(false);
      }}
      className="mt-3 border-border border-b px-1 pb-1.5"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: just asked to add one.
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setAdding(false)}
        placeholder="Heading"
        aria-label="New heading"
        className="w-full bg-transparent font-semibold text-[15px] outline-none placeholder:text-muted-foreground/60"
      />
    </form>
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

function Completed({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1 text-muted-foreground text-xs hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {open ? "Hide" : "Show"} {count} completed
      </button>
      {open && <div className="pt-1">{children}</div>}
    </section>
  );
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
  const item = (t: (typeof tasks)[number]) => (
    <TaskItem
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
    <div className={cn(inline ? "p-2" : "px-8 py-5")}>
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
          title={
            isNew
              ? list.key === INBOX
                ? "For tasks that don't belong to a project."
                : "No tasks yet. Add the first one above."
              : "All done here."
          }
        />
      )}
      <div className="pt-2">{loose.map(item)}</div>
      {open.length > 0 &&
        sections.map((s) => {
          const items = open.filter((t) => t.ref.section === s.index);
          return (
            <Heading
              key={`${s.index}-${s.title}`}
              list={list}
              index={s.index}
              title={s.title}
              count={items.length}
            >
              {items.map(item)}
            </Heading>
          );
        })}
      {!isNew && <AddHeading list={list} />}
      {done.length > 0 && (
        <Completed count={done.length}>{done.map(item)}</Completed>
      )}
    </div>
  );
}

/** Columns of cards: side by side when there's room, stacked when not. */
export function BoardFrame({
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

export function Column({
  id,
  title,
  color,
  count,
  onDrop,
  accepts,
  menu,
  children,
  footer,
}: {
  id: string;
  title: ReactNode;
  color: string;
  count: number;
  onDrop: (d: DragTask) => void;
  accepts: "tasks" | "reading";
  menu?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const drop = useDropArea(id, { accepts, onDrop: (d) => onDrop(d) });
  return (
    <div
      ref={drop.ref}
      className={cn(
        "group/heading flex @3xl:max-h-full @3xl:w-72 w-full shrink-0 flex-col rounded-xl bg-muted/50 transition-colors",
        drop.over && "bg-accent",
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        {title}
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {count}
        </span>
        <span className="flex-1" />
        {menu}
      </div>
      <div className="min-h-10 space-y-2 overflow-y-auto px-2 pb-2">
        {children}
      </div>
      {footer && <div className="px-2 pb-2">{footer}</div>}
    </div>
  );
}

export function Card({
  dnd,
  children,
  edge,
  onClick,
  selected,
}: {
  dnd: ReturnType<typeof useTaskDnd>;
  children: ReactNode;
  edge?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div
      ref={dnd.ref}
      {...(dnd.handlers as React.HTMLAttributes<HTMLDivElement>)}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick?.();
      }}
      className={cn(
        "relative rounded-lg border bg-background p-2.5 shadow-xs outline-none transition-shadow hover:shadow-md",
        selected ? "border-ring" : "border-border",
        dnd.over === "inside" && "ring-1 ring-primary/50",
        dnd.dragging && "opacity-30",
      )}
      style={edge ? { borderLeft: `3px solid ${edge}` } : undefined}
    >
      <DropMarker zone={dnd.over} />
      {children}
    </div>
  );
}

function TaskCard({
  list,
  plan,
  task,
  taskRef,
  selected,
  onSelect,
}: {
  list: PlanList;
  plan: Plan;
  task: Task;
  taskRef: TaskRef;
  selected?: boolean;
  onSelect?: (s: Selected) => void;
}) {
  const dnd = useTaskDnd(
    `card:${list.key}:${taskRef.section}:${taskRef.item}`,
    { list, ref: taskRef, label: task.title },
    {
      accepts: "tasks",
      nestable: true,
      onDrop: (d, zone) => dropOnTask(list, taskRef, d, zone),
    },
  );
  const actions = actionsFor(list, taskRef, plan);
  const meta =
    task.due || task.subtasks.length > 0 || /(^|\s)#[^\s]/.test(task.title);
  return (
    <TaskMenu list={list} plan={plan} taskRef={taskRef} task={task}>
      <div>
        <Card
          dnd={dnd}
          edge={task.priority ? PRIORITY_COLOR[task.priority] : undefined}
          selected={selected}
          onClick={() => onSelect?.({ list, ref: taskRef })}
        >
          <div className="flex items-start gap-2">
            <span className="pt-px">
              <Check
                done={task.done}
                priority={task.priority}
                onToggle={actions.toggle}
              />
            </span>
            <span className="min-w-0 flex-1 text-sm leading-snug">
              <TitleText title={task.title} />
            </span>
          </div>
          {task.subtasks.length > 0 && (
            <div className="mt-1.5 space-y-0.5 pl-[26px]">
              {task.subtasks.slice(0, 4).map((s, i) => (
                <div
                  key={`${i}-${s.title}`}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Check
                    small
                    done={s.done}
                    priority={s.priority}
                    onToggle={() => actions.toggleSub(i)}
                  />
                  <span
                    className={cn(
                      "truncate",
                      s.done && "text-muted-foreground line-through",
                    )}
                  >
                    {s.title}
                  </span>
                </div>
              ))}
              {task.subtasks.length > 4 && (
                <p className="text-[11px] text-muted-foreground">
                  +{task.subtasks.length - 4} more
                </p>
              )}
            </div>
          )}
          {meta && (task.due || /(^|\s)#[^\s]/.test(task.title)) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-[26px]">
              {task.due && <DueBadge due={task.due} icon />}
              <Tags title={task.title} />
            </div>
          )}
        </Card>
      </div>
    </TaskMenu>
  );
}

const COLUMN_COLORS = [
  "var(--muted-foreground)",
  "var(--primary)",
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

function BoardColumn({
  list,
  plan,
  index,
  title,
  color,
  tasks,
  selected,
  onSelect,
}: {
  list: PlanList;
  plan: Plan;
  index: number;
  title: string;
  color: string;
  tasks: ReturnType<typeof workTasks>;
  selected?: Selected | null;
  onSelect?: (s: Selected) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Column
      id={`col:${list.key}:${index}`}
      accepts="tasks"
      title={
        <HeadingTitle
          title={title}
          editing={editing}
          className="font-semibold text-sm"
          onDone={(name) => {
            setEditing(false);
            if (name && name !== title) {
              void editPlan(list, (p) => renameSection(p, index, name));
            }
          }}
        />
      }
      color={color}
      count={tasks.length}
      onDrop={(d) => dropOnSection(list, index, d)}
      menu={
        <HeadingMenu
          onRename={() => setEditing(true)}
          onDelete={() => void editPlan(list, (p) => deleteSection(p, index))}
        />
      }
      footer={
        <QuickAdd
          className="bg-transparent"
          placeholder="Add a task"
          onAdd={(task) => addQuick(list, task, index)}
        />
      }
    >
      {tasks.map((t) => (
        <TaskCard
          key={`${t.ref.section}-${t.ref.item}-${t.task.title}`}
          list={list}
          plan={plan}
          task={t.task}
          taskRef={t.ref}
          selected={
            selected?.list.key === list.key && sameRef(selected.ref, t.ref)
          }
          onSelect={onSelect}
        />
      ))}
    </Column>
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
      {columns.map((col, i) => (
        <BoardColumn
          key={`${col.index}-${col.title}`}
          list={list}
          plan={plan}
          index={col.index}
          title={col.title}
          color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
          tasks={tasks.filter((t) => t.ref.section === col.index)}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </BoardFrame>
  );
}

export { ReadingView } from "./reading-views";

/* ─────────────────────────── Smart lists ─────────────────────────── */

export type SmartFilter =
  | "today"
  | "tomorrow"
  | "week"
  | "calendar"
  | "reading"
  | "all"
  | "completed";

export const SMART_LABEL: Record<SmartFilter, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  calendar: "Calendar",
  reading: "Reading list",
  all: "All tasks",
  completed: "Completed",
};

export const contextOf = (list: PlanList): TaskContext => ({
  name: list.key === INBOX ? "Inbox" : list.name,
  icon:
    list.key === INBOX ? (
      <InboxIcon className="size-3" />
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

function Group({
  title,
  count,
  color,
  children,
}: {
  title: string;
  count: number;
  color?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 border-border border-b px-1 pb-1.5 text-left font-semibold text-[15px]"
      >
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        {color && (
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        {title}
        <span className="font-normal text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      </button>
      {open && <div className="pt-1">{children}</div>}
    </section>
  );
}

/** Tasks gathered from every plan: by date, by plan, or finished. */
export function SmartView({
  filter,
  lists,
  selected,
  onSelect,
  onOpenPlan,
}: {
  filter: SmartFilter;
  lists: PlanList[];
  selected?: Selected | null;
  onSelect?: (s: Selected) => void;
  /** Opens a project's own list (from its deadline). */
  onOpenPlan?: (list: PlanList) => void;
}) {
  const texts = usePlanTexts(lists.map((l) => l.key));
  const inbox = lists.find((l) => l.key === INBOX);
  const plans = lists.flatMap((list) => {
    const text = texts[list.key];
    return text ? [{ list, plan: parsePlan(text) }] : [];
  });

  if (filter === "reading") {
    return (
      <AllReading
        general={inbox}
        rows={plans.flatMap(({ list, plan }) =>
          readingItems(plan).map((item) => ({
            list,
            item,
            context: contextOf(list),
          })),
        )}
      />
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

  // Projects due in the range: their deadlines, apart from the tasks.
  const deadlines =
    filter === "today" || filter === "tomorrow" || filter === "week"
      ? plans
          .flatMap(({ list, plan }) => {
            const due = list.key === INBOX ? undefined : projectDue(plan);
            if (!due) return [];
            const days = daysUntil(due);
            const inRange =
              filter === "today"
                ? days <= 0
                : filter === "tomorrow"
                  ? days === 1
                  : days <= 6;
            return inRange ? [{ list, due }] : [];
          })
          .sort((a, b) => a.due.localeCompare(b.due))
      : [];
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

  const empty: Record<Exclude<SmartFilter, "reading" | "calendar">, string> = {
    today: "Nothing due today.",
    tomorrow: "Nothing due tomorrow.",
    week: "Nothing due this week.",
    all: "No tasks yet.",
    completed: "Nothing finished yet.",
  };
  const addDefaults =
    filter === "today"
      ? { due: dayFromToday(0) }
      : filter === "tomorrow"
        ? { due: dayFromToday(1) }
        : undefined;
  return (
    <div className="px-8 py-5">
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
      {deadlines.length > 0 && (
        <Group
          title="Deadlines"
          count={deadlines.length}
          color="var(--destructive)"
        >
          {deadlines.map(({ list, due }) => (
            <button
              key={list.key}
              type="button"
              onClick={() => onOpenPlan?.(list)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left hover:bg-muted/70"
            >
              <FlagIcon className="size-[18px] shrink-0 text-destructive" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                <ProjectIcon list={list} className="size-3.5" />
                <span className="truncate">{list.name}</span>
                <span className="text-muted-foreground text-xs">is due</span>
              </span>
              <DueBadge due={due} />
            </button>
          ))}
        </Group>
      )}
      {shown.length === 0 && deadlines.length === 0 && (
        <Empty
          icon={
            filter === "completed" ? (
              <CheckCircle2Icon className="size-6" />
            ) : (
              <CoffeeIcon className="size-6" />
            )
          }
          title={empty[filter as keyof typeof empty]}
        />
      )}
      {[...groups].map(([title, group]) => (
        <Group
          key={title}
          title={title}
          count={group.length}
          color={title === "Overdue" ? "var(--destructive)" : undefined}
        >
          {group.map((t) => (
            <TaskItem
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
