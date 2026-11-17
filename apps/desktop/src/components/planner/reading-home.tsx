/**
 * Reading, as a habit: what you're reading (to pick up where you stopped),
 * what's due today, one queue of what's next across every list, what you
 * finished lately, and, if you ask for it, a weekly goal with pages read
 * and a streak.
 */
import { ArrowRightIcon, FlameIcon } from "lucide-react";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { daysUntil } from "@/lib/plan/dates";
import { parsePlan, type Plan, today } from "@/lib/plan/plan-file";
import {
  type PlanList,
  READING_LIST,
  usePlanTexts,
} from "@/lib/plan/plan-store";
import {
  type ReadingItem,
  type ReadingStatus,
  readingItems,
} from "@/lib/plan/reading";
import { cn } from "@/lib/utils";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useSettingsStore } from "@/stores/settings-store";
import { contextOf } from "./plan-views";
import {
  type DragTask,
  DropMarker,
  useDropArea,
  useTaskDnd,
  useTaskDrag,
} from "./planner-dnd";
import {
  AddPaper,
  Byline,
  open,
  ReadingRow,
  setStatus,
  ReadingMenu,
  StatusMarker,
  ZoteroPicker,
} from "./reading-views";
import { type TaskContext } from "./task-parts";

interface Row {
  list: PlanList;
  item: ReadingItem;
  /** The project or list it's for; none for general reading. */
  context?: TaskContext;
  id: string;
}

const idOf = (list: PlanList, item: ReadingItem) =>
  `${list.key}|${item.itemKey ?? item.title}`;

/** The order of Up next, across every list: yours, by dragging. */
const useQueue = create<{ order: string[]; set: (o: string[]) => void }>()(
  persist((set) => ({ order: [], set: (order) => set({ order }) }), {
    name: "reading-queue",
  }),
);

/** Monday of this week, YYYY-MM-DD. */
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return today(d);
}

function Section({
  title,
  count,
  status,
  onDrop,
  children,
}: {
  title: string;
  count?: number;
  /** Papers dropped here take this status. */
  status?: ReadingStatus;
  onDrop?: (d: DragTask) => void;
  children: React.ReactNode;
}) {
  const drop = useDropArea(`home:${status ?? title}`, {
    accepts: "reading",
    onDrop: (d) => onDrop?.(d),
  });
  return (
    <section
      ref={onDrop ? drop.ref : undefined}
      className={cn(
        "mt-5 rounded-lg transition-colors",
        onDrop && drop.over && "bg-accent/60 ring-1 ring-primary/40",
      )}
    >
      <h2 className="flex items-center gap-2 border-border border-b px-1 pb-1.5 font-semibold text-[15px]">
        {title}
        {count !== undefined && (
          <span className="font-normal text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
        )}
      </h2>
      <div className="pt-1">{children}</div>
    </section>
  );
}

/** A paper being read: where you are, and a way back to it. */
function NowReading({
  row,
  onDropHere,
}: {
  row: Row;
  onDropHere: (d: DragTask) => void;
}) {
  const { item, list, context } = row;
  const at = item.bookmark ?? item.page;
  const dnd = useTaskDnd(
    `now:${row.id}`,
    { list, ref: item.ref, reading: true, label: item.title },
    { accepts: "reading", onDrop: (d) => onDropHere(d) },
  );
  return (
    <ReadingMenu list={list} item={item}>
      <div
        ref={dnd.ref}
        {...(dnd.handlers as React.HTMLAttributes<HTMLDivElement>)}
        className={cn(
          "group relative flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/70",
          dnd.dragging && "opacity-30",
        )}
      >
        <DropMarker zone={dnd.over} />
        <StatusMarker
          item={item}
          onChange={(s) => void setStatus(list, item.ref, s)}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-snug" title={item.title}>
            {item.title}
          </span>
          <Byline itemKey={item.itemKey} />
        </span>
        {at && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {item.bookmark ? "Bookmark " : ""}p. {at}
            {item.pages ? ` of ${item.pages}` : ""}
          </span>
        )}
        {context && (
          <span className="flex max-w-32 shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            {context.icon}
            <span className="truncate">{context.name}</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => open(item)}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-primary text-xs hover:bg-primary/10"
        >
          Resume
          <ArrowRightIcon className="size-3.5" />
        </button>
      </div>
    </ReadingMenu>
  );
}

/** This week against the goal, the pages read and the days in a row. */
function Goal({ finished, goal }: { finished: number; goal: number }) {
  const pagesByDay = useBookmarkStore((s) => s.pagesByDay);
  const since = weekStart();
  const pages = Object.entries(pagesByDay)
    .filter(([d]) => d >= since)
    .reduce((n, [, p]) => n + p, 0);
  let streak = 0;
  const day = new Date();
  // Today may not have started yet: the run counts up to yesterday then.
  if (!pagesByDay[today(day)]) day.setDate(day.getDate() - 1);
  while (pagesByDay[today(day)]) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  const share = Math.min(1, finished / goal);
  return (
    <div className="mt-4 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold">This week</span>
        <span className="text-muted-foreground">
          {finished} of {goal} {goal === 1 ? "paper" : "papers"}
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {pages} {pages === 1 ? "page" : "pages"}
        </span>
        {streak > 0 && (
          <span className="flex items-center gap-0.5 text-xs tabular-nums">
            <FlameIcon className="size-3.5 text-orange-500" />
            {streak} {streak === 1 ? "day" : "days"}
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}

export function ReadingHome({ lists }: { lists: PlanList[] }) {
  const all = useMemo(
    () => [READING_LIST, ...lists.filter((l) => l.key !== READING_LIST.key)],
    [lists],
  );
  const texts = usePlanTexts(all.map((l) => l.key));
  const goal = useSettingsStore((s) => s.readingGoal);
  const order = useQueue((s) => s.order);
  const rows: Row[] = all.flatMap((list) => {
    const text = texts[list.key];
    if (!text) return [];
    const plan: Plan = parsePlan(text);
    const context = list.key === READING_LIST.key ? undefined : contextOf(list);
    return readingItems(plan).map((item) => ({
      list,
      item,
      context,
      id: idOf(list, item),
    }));
  });

  const reading = rows.filter((r) => r.item.status === "reading");
  const dueToday = rows.filter(
    (r) =>
      r.item.status !== "read" &&
      r.item.status !== "reading" &&
      r.item.task.due &&
      daysUntil(r.item.task.due) <= 0,
  );
  const queued = rows.filter(
    (r) => r.item.status === "to-read" && !dueToday.includes(r),
  );
  const paused = rows.filter((r) => r.item.status === "paused");
  const again = rows.filter(
    (r) => r.item.status === "reread" && !dueToday.includes(r),
  );
  // While a paper is dragged, every group shows, to drop it in.
  const dragging = useTaskDrag((st) => !!st.drag?.reading);
  const rowOf = (d: DragTask) =>
    rows.find(
      (r) =>
        r.list.key === d.list.key &&
        r.item.ref.section === d.ref.section &&
        r.item.ref.item === d.ref.item,
    );
  const toStatus = (status: ReadingStatus) => (d: DragTask) => {
    const row = rowOf(d);
    if (row && row.item.status !== status) {
      void setStatus(row.list, row.item.ref, status);
    }
  };
  // Your order first; papers not placed yet after them, as their lists have them.
  const rank = (r: Row) => {
    const i = order.indexOf(r.id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const upNext = [...queued].sort((a, b) => rank(a) - rank(b));
  const week = weekStart();
  const finished = rows
    .filter((r) => r.item.status === "read" && r.item.task.doneOn)
    .sort((a, b) =>
      (b.item.task.doneOn ?? "").localeCompare(a.item.task.doneOn ?? ""),
    );
  const finishedThisWeek = finished.filter(
    (r) => (r.item.task.doneOn ?? "") >= week,
  ).length;
  const recent = finished.filter(
    (r) => daysUntil(r.item.task.doneOn as string) >= -14,
  );

  const move = (dragged: string, target: Row, before: boolean) => {
    // From another group: up next, now.
    const fromElsewhere = rows.find(
      (r) =>
        `${r.list.key}|${r.item.ref.section}:${r.item.ref.item}` === dragged,
    );
    if (fromElsewhere && fromElsewhere.item.status !== "to-read") {
      void setStatus(fromElsewhere.list, fromElsewhere.item.ref, "to-read");
    }
    const from = upNext.find(
      (r) =>
        `${r.list.key}|${r.item.ref.section}:${r.item.ref.item}` === dragged,
    );
    if (!from || from === target) return;
    const ids = upNext.map((r) => r.id).filter((id) => id !== from.id);
    const at = ids.indexOf(target.id) + (before ? 0 : 1);
    ids.splice(at, 0, from.id);
    useQueue.getState().set(ids);
  };

  const listed = new Set(
    rows.flatMap((r) => (r.item.itemKey ? [r.item.itemKey] : [])),
  );
  return (
    <div className="px-8 py-5">
      <div className="flex gap-2">
        <AddPaper list={READING_LIST} className="flex-1" />
        <ZoteroPicker list={READING_LIST} listed={listed} />
      </div>
      {goal > 0 && <Goal finished={finishedThisWeek} goal={goal} />}
      {(reading.length > 0 || dragging) && (
        <Section
          title="Now reading"
          count={reading.length}
          status="reading"
          onDrop={toStatus("reading")}
        >
          {reading.map((r) => (
            <NowReading key={r.id} row={r} onDropHere={toStatus("reading")} />
          ))}
        </Section>
      )}
      {(paused.length > 0 || dragging) && (
        <Section
          title="On hold"
          count={paused.length}
          status="paused"
          onDrop={toStatus("paused")}
        >
          {paused.map((r) => (
            <ReadingRow
              key={r.id}
              list={r.list}
              item={r.item}
              context={r.context}
              where="home"
              onDropHere={toStatus("paused")}
            />
          ))}
        </Section>
      )}
      {dueToday.length > 0 && (
        <Section title="Today" count={dueToday.length}>
          {dueToday.map((r) => (
            <ReadingRow
              key={r.id}
              list={r.list}
              item={r.item}
              context={r.context}
              where="home"
            />
          ))}
        </Section>
      )}
      <Section
        title="Up next"
        count={upNext.length}
        status="to-read"
        onDrop={toStatus("to-read")}
      >
        {upNext.length === 0 ? (
          <p className="px-2 py-3 text-muted-foreground text-sm">
            Nothing waiting. Add a paper above, or right-click one in your
            library and choose Add to reading list.
          </p>
        ) : (
          upNext.map((r, i) => (
            <ReadingRow
              key={r.id}
              list={r.list}
              item={r.item}
              rank={i + 1}
              context={r.context}
              where="queue"
              onDropHere={(d, zone) =>
                move(
                  `${d.list.key}|${d.ref.section}:${d.ref.item}`,
                  r,
                  zone !== "after",
                )
              }
            />
          ))
        )}
      </Section>
      {(again.length > 0 || dragging) && (
        <Section
          title="To re-read"
          count={again.length}
          status="reread"
          onDrop={toStatus("reread")}
        >
          {again.map((r) => (
            <ReadingRow
              key={r.id}
              list={r.list}
              item={r.item}
              context={r.context}
              where="home"
              onDropHere={toStatus("reread")}
            />
          ))}
        </Section>
      )}
      {(recent.length > 0 || dragging) && (
        <Section
          title="Finished lately"
          count={recent.length}
          status="read"
          onDrop={toStatus("read")}
        >
          {recent.map((r) => (
            <ReadingRow
              key={r.id}
              list={r.list}
              item={r.item}
              context={r.context}
              where="home"
              onDropHere={toStatus("read")}
            />
          ))}
        </Section>
      )}
    </div>
  );
}
