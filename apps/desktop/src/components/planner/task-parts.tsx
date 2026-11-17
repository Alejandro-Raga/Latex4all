import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  FlagIcon,
  ChevronRightIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { openInVault } from "@/components/workspace/highlight-quote";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dueLabel } from "@/lib/plan/dates";
import {
  notesLines,
  notesText,
  type Priority,
  type Task,
  sectionName,
} from "@/lib/plan/plan-file";
import { parseQuickAdd, type QuickTask } from "@/lib/plan/quick-add";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { DropMarker } from "./planner-dnd";

/** A priority's color: the checkbox's ring, the flag, a card's edge. */
export const PRIORITY_COLOR: Record<Priority, string> = {
  0: "var(--muted-foreground)",
  1: "var(--chart-2)",
  2: "var(--chart-4)",
  3: "var(--chart-1)",
  4: "var(--destructive)",
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Highest",
};

const TONE_CLASS = {
  overdue: "text-destructive",
  today: "text-primary",
  soon: "text-chart-1",
  later: "text-muted-foreground",
};

/** A round checkbox ringed in the task's priority color, as TickTick has. */
export function Check({
  done,
  priority,
  onToggle,
  small,
}: {
  done: boolean;
  priority: Priority;
  onToggle: () => void;
  small?: boolean;
}) {
  const color = PRIORITY_COLOR[priority];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:scale-110",
        small ? "size-3.5" : "size-[18px]",
      )}
      style={{
        borderColor: color,
        backgroundColor: done
          ? color
          : `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {done && <CheckIcon className="size-2.5 text-white" strokeWidth={3.5} />}
    </button>
  );
}

/** A title with [[links]] that open the note and [text](url) as its text. */
export function TitleText({ title }: { title: string }) {
  const parts: ReactNode[] = [];
  const re =
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]*)\]\([^)]*\)|(?:^|(?<=\s))#([\p{L}\p{N}_/-]+)/gu;
  let last = 0;
  for (const m of title.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(title.slice(last, at));
    if (m[1]) {
      const name = m[1];
      parts.push(
        <button
          key={at}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openInVault(name);
          }}
          className="text-primary underline-offset-2 hover:underline"
        >
          {m[2] ?? name}
        </button>,
      );
    } else if (m[3] !== undefined) {
      parts.push(m[3]);
    }
    // Tags show apart, as chips (see Tags).
    last = at + m[0].length;
  }
  if (last < title.length) parts.push(title.slice(last));
  return <>{parts}</>;
}

export function Tags({ title }: { title: string }) {
  const tags = [...title.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)]
    .map((m) => m[1])
    .filter((t) => !t.startsWith("reading/"));
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] text-primary"
        >
          {t}
        </span>
      ))}
    </>
  );
}

export function DueBadge({ due, icon }: { due: string; icon?: boolean }) {
  const { label, tone } = dueLabel(due);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-[11px] tabular-nums",
        TONE_CLASS[tone],
      )}
    >
      {icon && <CalendarIcon className="size-3" />}
      {label}
    </span>
  );
}

/** Subtasks done, as a count and a thin bar. */
export function Progress({ subtasks }: { subtasks: Task[] }) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.done).length;
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
      <span className="h-1 w-8 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${(done / subtasks.length) * 100}%` }}
        />
      </span>
      {done}/{subtasks.length}
    </span>
  );
}

export interface TaskActions {
  toggle: () => void;
  toggleSub: (index: number) => void;
  change: (patch: Partial<Task>) => void;
  remove: () => void;
  /** The sections it can move to, and moving it there. */
  sections?: { index: number; title: string }[];
  section?: number;
  move?: (section: number) => void;
}

/** Where a task is from, in lists that gather several plans. */
export interface TaskContext {
  name: string;
  icon: ReactNode;
}

/** What a row needs to drag and take drops (see planner-dnd). */
export interface RowDnd {
  ref: (el: HTMLElement | null) => void;
  handlers: Record<string, unknown>;
  over: "before" | "inside" | "after" | null;
  dragging: boolean;
}

/**
 * One task in a list: checkbox, title, tags, where it's from, its date, and
 * its subtasks folded under it. A click selects it (its details open
 * beside), or in a narrow panel opens them below.
 */
export function TaskRow({
  task,
  actions,
  context,
  selected,
  onSelect,
  dnd,
  inline,
  subtasks,
  menu,
}: {
  task: Task;
  actions: TaskActions;
  context?: TaskContext;
  selected?: boolean;
  onSelect?: () => void;
  dnd?: RowDnd;
  /** Details open under the row (narrow panels). */
  inline?: boolean;
  /** Its subtasks, drawn as a tree under it. */
  subtasks?: ReactNode;
  /** Wraps the row in its right-click menu. */
  menu?: (row: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const click = () => (inline ? setOpen(!open) : onSelect?.());
  const hasSubs = task.subtasks.length > 0;
  const row = (
    <div
      ref={dnd?.ref}
      {...(dnd?.handlers as React.HTMLAttributes<HTMLDivElement>)}
      role="button"
      tabIndex={0}
      onClick={click}
      onKeyDown={(e) => {
        if (e.key === "Enter") click();
      }}
      className={cn(
        "group relative flex cursor-default items-center gap-2.5 rounded-lg px-2 py-[7px] outline-none transition-colors",
        selected || open ? "bg-accent" : "hover:bg-muted/70",
        dnd?.over === "inside" && "bg-primary/10 ring-1 ring-primary/50",
        dnd?.dragging && "opacity-30",
      )}
    >
      <DropMarker zone={dnd?.over ?? null} />
      <span className="flex w-3 shrink-0 justify-center">
        {hasSubs && subtasks && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFolded(!folded);
            }}
            aria-label={folded ? "Show subtasks" : "Hide subtasks"}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform",
                !folded && "rotate-90",
              )}
            />
          </button>
        )}
      </span>
      <Check
        done={task.done}
        priority={task.priority}
        onToggle={actions.toggle}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            task.done && "text-muted-foreground line-through",
          )}
        >
          <TitleText title={task.title} />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Tags title={task.title} />
        {(!subtasks || folded) && <Progress subtasks={task.subtasks} />}
        {context && (
          <span className="flex max-w-32 items-center gap-1 text-[11px] text-muted-foreground">
            {context.icon}
            <span className="truncate">{context.name}</span>
          </span>
        )}
        {task.due && !task.done && <DueBadge due={task.due} />}
      </span>
    </div>
  );
  return (
    <div>
      {menu ? menu(row) : row}
      {hasSubs && subtasks && !folded && (
        <div className="ml-[22px] border-border/70 border-l pl-1.5">
          {subtasks}
        </div>
      )}
      {inline && open && (
        <div className="px-2 pb-2">
          <TaskDetails task={task} actions={actions} />
        </div>
      )}
    </div>
  );
}

/** Choosing a due date: quick picks, a calendar, or none. */
export function DueButton({
  due,
  onChange,
  label = "Date",
  ariaLabel,
}: {
  due?: string;
  onChange: (due?: string) => void;
  /** What it says when there's none ("Date", "Deadline"). */
  label?: string;
  /** Its name for screen readers, if not its label's. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (d?: string) => {
    onChange(d);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted"
          aria-label={ariaLabel ?? (label === "Date" ? "Due date" : label)}
        >
          {due ? (
            <>
              {label !== "Date" && (
                <span className="text-muted-foreground">{label}</span>
              )}
              <DueBadge due={due} icon />
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarIcon className="size-3.5" />
              {label}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <DatePicker value={due} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}

export function PriorityButtons({
  priority,
  onChange,
}: {
  priority: Priority;
  onChange: (p: Priority) => void;
}) {
  return (
    <span className="flex items-center">
      {([4, 3, 2, 1, 0] as Priority[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          title={`${PRIORITY_LABEL[p]} priority`}
          aria-label={`${PRIORITY_LABEL[p]} priority`}
          aria-pressed={priority === p}
          className={cn(
            "flex size-7 items-center justify-center rounded-md",
            priority === p ? "bg-muted" : "hover:bg-muted/70",
          )}
        >
          <FlagIcon
            className="size-3.5"
            style={{ color: PRIORITY_COLOR[p] }}
            fill={p ? PRIORITY_COLOR[p] : "none"}
          />
        </button>
      ))}
    </span>
  );
}

/** A textarea that grows with what's in it. */
function Grow(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string },
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

/** A task's details: title, date, priority, description, subtasks. */
export function TaskDetails({
  task,
  actions,
  footer,
  onClose,
}: {
  task: Task;
  actions: TaskActions;
  footer?: ReactNode;
  onClose?: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(notesText(task));
  const [newSub, setNewSub] = useState("");
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(notesText(task)), [task.notes.join("\n")]);
  const saveTitle = () => {
    const next = title.replace(/\s+/g, " ").trim();
    if (next && next !== task.title) actions.change({ title: next });
    else setTitle(task.title);
  };
  const saveNotes = () => {
    if (notes.trim() !== notesText(task)) {
      actions.change({ notes: notesLines(notes) });
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-border border-b px-3 py-2">
        <Check
          done={task.done}
          priority={task.priority}
          onToggle={actions.toggle}
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <DueButton due={task.due} onChange={(due) => actions.change({ due })} />
        <span className="flex-1" />
        <PriorityButtons
          priority={task.priority}
          onChange={(priority) => actions.change({ priority })}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="ml-1 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <Grow
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") setTitle(task.title);
          }}
          aria-label="Task"
          className={cn(
            "w-full resize-none bg-transparent font-medium text-base leading-snug outline-none",
            task.done && "text-muted-foreground line-through",
          )}
        />
        <Grow
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Add a description"
          aria-label="Description"
          className="min-h-12 w-full resize-none bg-transparent text-muted-foreground text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
        <div className="space-y-0.5">
          {task.subtasks.map((s, i) => (
            <div
              key={`${i}-${s.title}`}
              className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60"
            >
              <Check
                small
                done={s.done}
                priority={s.priority}
                onToggle={() => actions.toggleSub(i)}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm",
                  s.done && "text-muted-foreground line-through",
                )}
              >
                <TitleText title={s.title} />
              </span>
              <button
                type="button"
                onClick={() =>
                  actions.change({
                    subtasks: task.subtasks.filter((_, j) => j !== i),
                  })
                }
                aria-label="Remove step"
                className="text-muted-foreground/0 hover:text-foreground group-hover:text-muted-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = newSub.trim();
              if (!text) return;
              actions.change({
                subtasks: [
                  ...task.subtasks,
                  {
                    done: false,
                    title: text,
                    priority: 0,
                    subtasks: [],
                    notes: [],
                  },
                ],
              });
              setNewSub("");
            }}
            className="flex items-center gap-2 px-1 py-1"
          >
            <PlusIcon className="size-3.5 text-muted-foreground" />
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="Add subtask"
              aria-label="Add subtask"
              className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </form>
        </div>
      </div>
      <div className="flex items-center gap-2 border-border border-t px-3 py-2 text-xs">
        {footer}
        {actions.sections && actions.move && actions.sections.length > 1 && (
          <select
            value={actions.section}
            onChange={(e) => actions.move?.(Number(e.target.value))}
            aria-label="Section"
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
          >
            {actions.sections.map((s) => (
              <option key={s.index} value={s.index}>
                {sectionName(s.title)}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={actions.remove}
          title="Delete task"
          aria-label="Delete task"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The quick-add box: a task typed as said ("Draft the intro friday !high");
 * what it understood shows underneath before adding.
 */
export function QuickAdd({
  onAdd,
  placeholder = "Add a task, like “Draft the intro friday !high”",
  defaults,
  autoFocus,
  className,
}: {
  onAdd: (task: QuickTask) => void | Promise<void>;
  placeholder?: string;
  /** A due date for tasks that name none (Today's list: today). */
  defaults?: { due?: string };
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseQuickAdd(text) : null;
  const due = parsed?.due ?? defaults?.due;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!parsed?.title) return;
        await onAdd({ ...parsed, due });
        setText("");
      }}
      className={cn(
        "rounded-lg border border-transparent bg-muted/60 transition-colors focus-within:border-ring focus-within:bg-background",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2.5">
        <PlusIcon className="size-4 shrink-0 text-primary" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the list opens to add.
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Add a task"
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {parsed && (
        <div className="flex items-center gap-2 px-2.5 pb-1.5 text-[11px] text-muted-foreground">
          {
            <>
              {due && <DueBadge due={due} icon />}
              {parsed.priority > 0 && (
                <span className="flex items-center gap-1">
                  <FlagIcon
                    className="size-3"
                    style={{ color: PRIORITY_COLOR[parsed.priority] }}
                    fill={PRIORITY_COLOR[parsed.priority]}
                  />
                  {PRIORITY_LABEL[parsed.priority]}
                </span>
              )}
              <span className="ml-auto">Enter to add</span>
            </>
          }
        </div>
      )}
    </form>
  );
}
