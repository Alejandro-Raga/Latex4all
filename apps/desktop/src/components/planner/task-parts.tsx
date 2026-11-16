import { type ReactNode, useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  FlagIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { openInVault } from "@/components/workspace/highlight-quote";
import { dueLabel, dayFromToday } from "@/lib/plan/dates";
import type { Priority, Task } from "@/lib/plan/plan-file";
import { parseQuickAdd, type QuickTask } from "@/lib/plan/quick-add";
import { cn } from "@/lib/utils";

/** A priority's color: the checkbox's ring and the flag. */
export const PRIORITY_COLOR: Record<Priority, string> = {
  0: "var(--muted-foreground)",
  1: "#3b82f6",
  2: "#eab308",
  3: "#f97316",
  4: "#ef4444",
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Highest",
};

const TONE_CLASS = {
  overdue: "text-red-500",
  today: "text-primary",
  soon: "text-amber-600 dark:text-amber-400",
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
        "flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
        small ? "size-3.5" : "size-4",
      )}
      style={{
        borderColor: color,
        backgroundColor: done
          ? color
          : `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {done && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
    </button>
  );
}

/** A title with its tags as chips and [[links]] that open the note. */
export function TitleText({ title }: { title: string }) {
  const parts: ReactNode[] = [];
  const re =
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(?:^|(?<=\s))#([\p{L}\p{N}_/-]+)/gu;
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
    } else {
      parts.push(
        <span
          key={at}
          className="mx-0.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
        >
          #{m[3]}
        </span>,
      );
    }
    last = at + m[0].length;
  }
  if (last < title.length) parts.push(title.slice(last));
  return <>{parts}</>;
}

export function DueBadge({ due }: { due: string }) {
  const { label, tone } = dueLabel(due);
  return (
    <span className={cn("shrink-0 text-[11px] tabular-nums", TONE_CLASS[tone])}>
      {label}
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

/**
 * One task: its checkbox, title, due date and subtasks done; a click opens
 * its details below it.
 */
export function TaskRow({
  task,
  actions,
  context,
  compact,
}: {
  task: Task;
  actions: TaskActions;
  /** Where it's from, in lists that gather several plans. */
  context?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const subsDone = task.subtasks.filter((s) => s.done).length;
  return (
    <div className={cn("rounded-md", open && "bg-muted/40")}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className={cn(
          "flex cursor-default items-start gap-2 rounded-md px-2 hover:bg-muted/60",
          compact ? "py-1" : "py-1.5",
        )}
      >
        <span className="pt-0.5">
          <Check
            done={task.done}
            priority={task.priority}
            onToggle={actions.toggle}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm leading-snug",
              task.done && "text-muted-foreground line-through",
            )}
          >
            <TitleText title={task.title} />
          </span>
          {(context || task.subtasks.length > 0) && (
            <span className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
              {context && <span className="truncate">{context}</span>}
              {task.subtasks.length > 0 && (
                <span className="tabular-nums">
                  {subsDone}/{task.subtasks.length}
                </span>
              )}
            </span>
          )}
        </span>
        {task.due && !task.done && <DueBadge due={task.due} />}
      </div>
      {open && <TaskDetails task={task} actions={actions} />}
    </div>
  );
}

function TaskDetails({ task, actions }: { task: Task; actions: TaskActions }) {
  const [title, setTitle] = useState(task.title);
  const [newSub, setNewSub] = useState("");
  const saveTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) actions.change({ title: next });
  };
  const notes = task.notes.map((n) => n.trim()).filter(Boolean);
  return (
    <div className="space-y-2 px-2 pt-1 pb-2 pl-8">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setTitle(task.title);
        }}
        aria-label="Task"
        className="h-7 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex h-7 items-center gap-1 rounded-md border border-input bg-background px-1.5 text-xs">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          <input
            type="date"
            value={task.due ?? ""}
            onChange={(e) =>
              actions.change({ due: e.target.value || undefined })
            }
            aria-label="Due date"
            className="bg-transparent outline-none"
          />
        </label>
        {[0, 1, 7].map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => actions.change({ due: dayFromToday(days) })}
            className="h-7 rounded-md border border-input px-2 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
          >
            {days === 0 ? "Today" : days === 1 ? "Tomorrow" : "Next week"}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {([4, 3, 2, 1, 0] as Priority[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => actions.change({ priority: p })}
            title={`${PRIORITY_LABEL[p]} priority`}
            aria-label={`${PRIORITY_LABEL[p]} priority`}
            aria-pressed={task.priority === p}
            className={cn(
              "flex size-7 items-center justify-center rounded-md border",
              task.priority === p
                ? "border-ring bg-muted"
                : "border-transparent hover:bg-muted",
            )}
          >
            <FlagIcon
              className="size-3.5"
              style={{ color: PRIORITY_COLOR[p] }}
              fill={p ? PRIORITY_COLOR[p] : "none"}
            />
          </button>
        ))}
        {actions.sections && actions.move && actions.sections.length > 1 && (
          <select
            value={actions.section}
            onChange={(e) => actions.move?.(Number(e.target.value))}
            aria-label="Section"
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
          >
            {actions.sections.map((s) => (
              <option key={s.index} value={s.index}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={actions.remove}
          title="Delete task"
          aria-label="Delete task"
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
      {task.subtasks.length > 0 && (
        <div className="space-y-1">
          {task.subtasks.map((s, i) => (
            <div key={`${i}-${s.title}`} className="flex items-center gap-2">
              <Check
                small
                done={s.done}
                priority={s.priority}
                onToggle={() => actions.toggleSub(i)}
              />
              <span
                className={cn(
                  "text-xs",
                  s.done && "text-muted-foreground line-through",
                )}
              >
                <TitleText title={s.title} />
              </span>
            </div>
          ))}
        </div>
      )}
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
        className="flex items-center gap-2"
      >
        <PlusIcon className="size-3.5 text-muted-foreground" />
        <input
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          placeholder="Add subtask"
          aria-label="Add subtask"
          className="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </form>
      {notes.length > 0 && (
        <p className="whitespace-pre-line text-muted-foreground text-xs">
          {notes.join("\n")}
        </p>
      )}
    </div>
  );
}

/**
 * The quick-add box: type a task as you'd say it ("Revise intro tomorrow
 * !high #paper2"); what it understood shows underneath before adding.
 */
export function QuickAdd({
  onAdd,
  placeholder = "Add a task: “Read Cohen friday !high”",
  defaults,
  autoFocus,
}: {
  onAdd: (task: QuickTask) => void | Promise<void>;
  placeholder?: string;
  /** A due date for tasks that name none (Today's list: today). */
  defaults?: { due?: string };
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseQuickAdd(text) : null;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!parsed?.title) return;
        await onAdd({ ...parsed, due: parsed.due ?? defaults?.due });
        setText("");
      }}
      className="rounded-md border border-input bg-background focus-within:border-ring"
    >
      <div className="flex items-center gap-2 px-2">
        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the Planner opens to add.
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Add a task"
          className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {parsed && (parsed.due || parsed.priority > 0) && (
        <div className="flex items-center gap-2 border-border border-t px-2 py-1 text-[11px] text-muted-foreground">
          {parsed.due && (
            <span className="flex items-center gap-1">
              <CalendarIcon className="size-3" />
              <DueBadge due={parsed.due} />
            </span>
          )}
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
        </div>
      )}
    </form>
  );
}
