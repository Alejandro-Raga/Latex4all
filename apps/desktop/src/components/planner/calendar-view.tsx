/**
 * The Planner's calendar: everything dated in every plan (tasks, milestones,
 * deadlines), a month or a week at a time. Things drag from day to day; a
 * day picked shows all it holds and takes new tasks.
 */
import { useMemo, useState } from "react";
import {
  CalendarArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DiamondIcon,
  FlagIcon,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { useDraggable } from "@dnd-kit/core";
import {
  type CalendarEntry,
  calendarEntries,
  monthDays,
  shiftMonth,
  toIcs,
  weekDays,
} from "@/lib/plan/calendar";
import { daysUntil } from "@/lib/plan/dates";
import {
  addTask,
  parsePlan,
  type TaskRef,
  today,
  toggleTask,
  updateTask,
} from "@/lib/plan/plan-file";
import { INBOX, type PlanList, usePlanTexts } from "@/lib/plan/plan-store";
import { cn } from "@/lib/utils";
import { editPlan } from "./plan-actions";
import { type DragTask, useDropArea } from "./planner-dnd";
import { typeColor } from "./project-icon";
import { Check, QuickAdd, TitleText } from "./task-parts";

type Span = "month" | "week";

const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 10, 16 + i).toLocaleDateString(undefined, {
    weekday: "short",
  }),
);

const listOf = (lists: PlanList[], key: string) =>
  lists.find((l) => l.key === key);

/** A dated thing on the calendar: a task, a milestone, a deadline. */
function Chip({
  entry,
  lists,
  wide,
}: {
  entry: CalendarEntry;
  lists: PlanList[];
  /** In the day's list: all of it, not a chip. */
  wide?: boolean;
}) {
  const list = listOf(lists, entry.listKey);
  const movable = entry.kind !== "deadline" && !!entry.ref && !!list;
  const drag: DragTask | undefined =
    movable && list && entry.ref
      ? { list, ref: entry.ref, label: entry.title }
      : undefined;
  const draggable = useDraggable({
    id: `cal:${entry.listKey}:${entry.kind}:${entry.ref?.section}:${entry.ref?.item}:${entry.date}`,
    data: drag,
    disabled: !drag,
  });
  const color =
    entry.listKey === INBOX ? "var(--muted-foreground)" : typeColor(list?.type);
  const toggle = () => {
    if (!list || !entry.ref) return;
    const ref = entry.ref;
    void editPlan(list, (p) => toggleTask(p, ref));
  };
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...draggable.attributes}
      title={`${entry.title.replace(/\s#\S+/g, "")} · ${entry.listName}`}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md",
        wide
          ? "px-2 py-1.5 hover:bg-muted/70"
          : "px-1 py-0.5 text-[11px] hover:bg-muted",
        entry.done && "opacity-50",
        draggable.isDragging && "opacity-30",
        drag && "cursor-grab",
      )}
    >
      {entry.kind === "deadline" ? (
        <FlagIcon className="size-3 shrink-0 text-destructive" />
      ) : entry.kind === "milestone" ? (
        <DiamondIcon
          className="size-3 shrink-0"
          style={{ color: "var(--chart-4)" }}
          fill={entry.done ? "var(--chart-4)" : "none"}
        />
      ) : wide ? (
        <Check done={entry.done} priority={0} onToggle={toggle} small />
      ) : (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          wide && "text-sm",
          entry.done && "line-through",
          entry.kind === "deadline" && "font-medium",
        )}
      >
        <TitleText title={entry.title} />
      </span>
      {wide && (
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">
          {entry.listName}
        </span>
      )}
    </div>
  );
}

/** A day: drop a task or milestone on it to move it there. */
function Day({
  day,
  entries,
  lists,
  inMonth,
  selected,
  tall,
  onSelect,
}: {
  day: string;
  entries: CalendarEntry[];
  lists: PlanList[];
  inMonth: boolean;
  selected: boolean;
  tall?: boolean;
  onSelect: () => void;
}) {
  const drop = useDropArea(`day:${day}`, {
    accepts: "tasks",
    onDrop: (d) => {
      const ref: TaskRef = d.ref;
      void editPlan(d.list, (p) => updateTask(p, ref, { due: day }));
    },
  });
  const isToday = daysUntil(day) === 0;
  const shown = tall ? entries : entries.slice(0, 3);
  return (
    <div
      ref={drop.ref}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "flex min-h-0 min-w-0 cursor-default flex-col gap-0.5 border-border border-r border-b p-1 transition-colors",
        !inMonth && "bg-muted/30 text-muted-foreground",
        selected && "bg-accent/60",
        drop.over && "bg-primary/10",
      )}
    >
      <span
        className={cn(
          "mb-0.5 flex size-6 shrink-0 items-center justify-center self-end rounded-full text-xs tabular-nums",
          isToday && "bg-primary font-semibold text-primary-foreground",
        )}
      >
        {Number(day.slice(8))}
      </span>
      {shown.map((e) => (
        <Chip
          key={`${e.listKey}-${e.kind}-${e.title}-${e.ref?.item ?? ""}`}
          entry={e}
          lists={lists}
        />
      ))}
      {entries.length > shown.length && (
        <span className="px-1 text-[10px] text-muted-foreground">
          +{entries.length - shown.length} more
        </span>
      )}
    </div>
  );
}

const DAY_ORDER: Record<CalendarEntry["kind"], number> = {
  deadline: 0,
  milestone: 1,
  task: 2,
};

export function CalendarView({ lists }: { lists: PlanList[] }) {
  const texts = usePlanTexts(lists.map((l) => l.key));
  const [span, setSpan] = useState<Span>("month");
  const [anchor, setAnchor] = useState(today());
  const [picked, setPicked] = useState(today());
  const entries = useMemo(
    () =>
      calendarEntries(
        lists.flatMap((l) => {
          const text = texts[l.key];
          return text
            ? [
                {
                  key: l.key,
                  name: l.key === INBOX ? "Inbox" : l.name,
                  plan: parsePlan(text),
                  project: l.key !== INBOX,
                },
              ]
            : [];
        }),
      ),
    [lists, texts],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          DAY_ORDER[a.kind] - DAY_ORDER[b.kind] ||
          Number(a.done) - Number(b.done),
      );
    }
    return map;
  }, [entries]);

  const [y, m] = anchor.split("-").map(Number);
  const days = span === "month" ? monthDays(y, m - 1) : weekDays(anchor);
  const title =
    span === "month"
      ? new Date(y, m - 1, 1).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        })
      : `${new Date(`${days[0]}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(`${days[6]}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  const step = (n: number) => {
    if (span === "month") setAnchor(shiftMonth(anchor, n));
    else {
      const d = new Date(`${anchor}T00:00`);
      d.setDate(d.getDate() + 7 * n);
      setAnchor(today(d));
    }
  };
  const inbox = lists.find((l) => l.key === INBOX);
  const dayEntries = byDay.get(picked) ?? [];

  const exportIcs = async () => {
    try {
      const path = await save({
        defaultPath: "Latex4All.ics",
        filters: [{ name: "Calendar", extensions: ["ics"] }],
      });
      if (!path) return;
      await writeTextFile(path, toIcs(entries));
      toast.success("Saved. Open it with your calendar app to add the events.");
    } catch (err) {
      toast.error(
        `Couldn't save it: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-5 py-3">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Earlier"
            className="flex size-7 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Later"
            className="flex size-7 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronRightIcon className="size-4" />
          </button>
          <h2 className="font-semibold text-base">{title}</h2>
          <button
            type="button"
            onClick={() => {
              setAnchor(today());
              setPicked(today());
            }}
            className="ml-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
          >
            Today
          </button>
          <span className="flex-1" />
          <div
            className="inline-flex rounded-lg bg-muted p-0.5"
            role="radiogroup"
            aria-label="Span"
          >
            {(["month", "week"] as Span[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={span === s}
                onClick={() => setSpan(s)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs",
                  span === s
                    ? "bg-background font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "month" ? "Month" : "Week"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void exportIcs()}
            title="Save the deadlines, milestones and dated tasks as a file your calendar app opens (Apple, Google, Outlook)"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted"
          >
            <CalendarArrowUpIcon className="size-4" />
            Export to calendar
          </button>
        </div>
        <div className="grid grid-cols-7 border-border border-y px-px">
          {WEEKDAYS.map((d) => (
            <span
              key={d}
              className="px-2 py-1 text-right text-[11px] text-muted-foreground uppercase"
            >
              {d}
            </span>
          ))}
        </div>
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-7 border-border border-l",
            span === "month" ? "grid-rows-6" : "grid-rows-1",
          )}
        >
          {days.map((day) => (
            <Day
              key={day}
              day={day}
              entries={byDay.get(day) ?? []}
              lists={lists}
              inMonth={span === "week" || Number(day.slice(5, 7)) === m}
              selected={day === picked}
              tall={span === "week"}
              onSelect={() => setPicked(day)}
            />
          ))}
        </div>
      </div>
      <aside className="flex w-72 shrink-0 flex-col border-border border-l">
        <div className="px-4 pt-4 pb-2">
          <p className="font-semibold text-sm">
            {new Date(`${picked}T00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <p className="text-muted-foreground text-xs">
            {dayEntries.length === 0
              ? "Nothing on this day."
              : `${dayEntries.length} ${dayEntries.length === 1 ? "thing" : "things"}`}
          </p>
        </div>
        {inbox && (
          <div className="px-3 pb-2">
            <QuickAdd
              placeholder="Add a task for this day"
              defaults={{ due: picked }}
              onAdd={(task) =>
                editPlan(inbox, (p) => {
                  const first = p.sections.findIndex((s) => s.title !== null);
                  return addTask(
                    p,
                    { ...task, due: task.due ?? picked },
                    first >= 0 ? first : undefined,
                  );
                })
              }
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {dayEntries.map((e) => (
            <Chip
              key={`${e.listKey}-${e.kind}-${e.title}-${e.ref?.item ?? ""}`}
              entry={e}
              lists={lists}
              wide
            />
          ))}
        </div>
      </aside>
    </div>
  );
}
