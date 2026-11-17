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
import { type ReadingItem, readingItems } from "@/lib/plan/reading";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useSettingsStore } from "@/stores/settings-store";
import { contextOf } from "./plan-views";
import {
  AddPaper,
  open,
  ReadingRow,
  setStatus,
  StatusMarker,
  ZoteroPicker,
} from "./reading-views";
import { type TaskContext } from "./task-parts";

interface Row {
  list: PlanList;
  item: ReadingItem;
  context: TaskContext;
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
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-5">
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
function NowReading({ row }: { row: Row }) {
  const { item, list, context } = row;
  const at = item.bookmark ?? item.page;
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/70">
      <StatusMarker
        item={item}
        onChange={(s) => void setStatus(list, item.ref, s)}
      />
      <span className="min-w-0 flex-1 truncate text-sm" title={item.title}>
        {item.title}
      </span>
      {at && (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {item.bookmark ? "Bookmark " : ""}p. {at}
          {item.pages ? ` of ${item.pages}` : ""}
        </span>
      )}
      <span className="flex max-w-32 shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        {context.icon}
        <span className="truncate">{context.name}</span>
      </span>
      <button
        type="button"
        onClick={() => open(item)}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-primary text-xs hover:bg-primary/10"
      >
        Resume
        <ArrowRightIcon className="size-3.5" />
      </button>
    </div>
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
    const context =
      list.key === READING_LIST.key
        ? { name: "General", icon: null }
        : contextOf(list);
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
    (r) =>
      (r.item.status === "to-read" || r.item.status === "reread") &&
      !dueToday.includes(r),
  );
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
      {reading.length > 0 && (
        <Section title="Now reading" count={reading.length}>
          {reading.map((r) => (
            <NowReading key={r.id} row={r} />
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
      <Section title="Up next" count={upNext.length}>
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
      {recent.length > 0 && (
        <Section title="Finished lately" count={recent.length}>
          {recent.map((r) => (
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
    </div>
  );
}
