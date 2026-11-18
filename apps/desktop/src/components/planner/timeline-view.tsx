/**
 * A project's timeline, from today (or its first date) to its deadline:
 *
 * - Periods (a milestone with a start date: "Revisions, Dec 5 – Jan 20") as
 *   bars above the line, in rows of their own where they overlap, each with
 *   its name and dates. One following a section of the plan fills as it's
 *   done, and turns red when its end is close and much is left.
 * - Milestones (one day each) on the line, each with its own icon and color;
 *   the deadline's flag at the end. Their names in rows that never overlap.
 * - The plan's dated tasks and sections as small marks under it, dated
 *   where there's room.
 *
 * Anything on it can be dragged along to change its dates. It zooms (the
 * buttons, or ⌘ and the scroll wheel) and scrolls sideways when zoomed in.
 * Below: the milestones as a list. ProjectsTimeline puts every project on
 * one shared span of dates, a row each, zoomed together.
 */
import {
  BookOpenIcon,
  CircleIcon,
  DiamondIcon,
  FlagIcon,
  GraduationCapIcon,
  ListChecksIcon,
  type LucideIcon,
  MinusIcon,
  PlaneIcon,
  PlusIcon,
  PresentationIcon,
  SendIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { daysUntil } from "@/lib/plan/dates";
import { shownTitle } from "@/lib/plan/matrix-opt";
import {
  addMilestone,
  atRisk,
  isMilestonesSection,
  lanes,
  linkedSection,
  MILESTONE_COLORS,
  MILESTONE_ICONS,
  type Milestone,
  type MilestoneColor,
  type MilestoneIcon,
  milestones,
  sectionProgress,
  styleOf,
  withLink,
  withStyle,
} from "@/lib/plan/milestones";
import {
  allTasks,
  deleteTask,
  newPlanText,
  type Plan,
  parsePlan,
  projectDue,
  sectionDue,
  sectionName,
  setProjectDue,
  today,
  toggleTask,
  updateTask,
} from "@/lib/plan/plan-file";
import {
  isProjectKey,
  type PlanList,
  usePlanText,
  usePlanTexts,
} from "@/lib/plan/plan-store";
import { parseQuickAdd } from "@/lib/plan/quick-add";
import { PX_PER_DAY_FOR_DAYS, scaleFor } from "@/lib/plan/time-scale";
import { cn } from "@/lib/utils";
import { editPlan, removeFromPlan } from "./plan-actions";
import { Empty } from "./plan-views";
import { DueBadge, DueButton } from "./task-parts";

const MS_DAY = 86_400_000;
const time = (iso: string) => new Date(`${iso}T00:00`).getTime();
const short = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
const addDays = (iso: string, days: number) =>
  today(new Date(time(iso) + days * MS_DAY));

const ICONS: Record<MilestoneIcon, LucideIcon> = {
  diamond: DiamondIcon,
  flag: FlagIcon,
  star: StarIcon,
  send: SendIcon,
  presentation: PresentationIcon,
  plane: PlaneIcon,
  book: BookOpenIcon,
  graduation: GraduationCapIcon,
  circle: CircleIcon,
};
const ICON_LABEL: Record<MilestoneIcon, string> = {
  diamond: "Milestone",
  flag: "Flag",
  star: "Star",
  send: "Submission",
  presentation: "Talk",
  plane: "Trip",
  book: "Reading",
  graduation: "Defense",
  circle: "Dot",
};
const COLOR: Record<MilestoneColor, string> = {
  accent: "var(--primary)",
  orange: "var(--chart-4)",
  blue: "var(--chart-1)",
  green: "var(--chart-2)",
  purple: "var(--chart-5)",
  red: "var(--destructive)",
  grey: "var(--muted-foreground)",
};
const DEFAULT_COLOR = "var(--chart-4)";
const colorOf = (m: Milestone) =>
  COLOR[styleOf(m.task).color ?? "orange"] ?? DEFAULT_COLOR;
const iconOf = (m: Milestone) => ICONS[styleOf(m.task).icon ?? "diamond"];

interface Span {
  start: string;
  end: string;
}

/** Every date on a plan's line: its milestones, periods and deadline. */
function datesOf(plan: Plan): string[] {
  const due = projectDue(plan);
  return [
    ...milestones(plan).flatMap((m) =>
      [m.task.due, m.task.start].filter((d): d is string => !!d),
    ),
    ...(due ? [due] : []),
  ];
}

/** From the earliest to the latest (and today), a month's room at least,
 *  and a week's margin either side so nothing sits on the edge. */
function spanOf(dates: string[]): Span {
  const all = [today(), ...dates];
  let start = all.reduce((a, b) => (a < b ? a : b));
  let end = all.reduce((a, b) => (a > b ? a : b));
  if (time(end) - time(start) < 30 * MS_DAY) end = addDays(start, 30);
  const margin = Math.max(
    3,
    Math.round((time(end) - time(start)) / MS_DAY / 40),
  );
  start = addDays(start, -margin);
  end = addDays(end, margin);
  return { start, end };
}

/** Where today falls along a span, 0 to 1. */
const todayAt = (span: Span) =>
  (time(today()) - time(span.start)) /
  Math.max(1, time(span.end) - time(span.start));

/** A milestone's progress, when it follows a section. */
function progressOf(plan: Plan, m: Milestone) {
  const name = linkedSection(m.task);
  return name ? sectionProgress(plan, name) : null;
}

/**
 * A task's title as words only: a paper on a reading list is written
 * `[Title](zotero://…) #reading/to-read [page:: 3/20]`, which shows as its
 * title.
 */
function plainTitle(title: string): string {
  return shownTitle(title)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*\[[\w-]+::[^\]]*\]/g, "")
    .replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "")
    .trim();
}

/** About how wide a label is, in pixels (11px text). */
const textWidth = (text: string, px = 6.2) => text.length * px + 10;

/**
 * Labels in rows so none overlaps the next: each in the first row where
 * it fits, up to `rows`; the rest left out (their name shows on hover).
 */
function placeLabels<T extends { x: number; w: number }>(
  items: T[],
  rows: number,
): (T & { row: number })[] {
  const ends: number[] = [];
  const out: (T & { row: number })[] = [];
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    const from = item.x - item.w / 2;
    let row = ends.findIndex((end) => end + 6 < from);
    if (row < 0 && ends.length < rows) row = ends.length;
    if (row < 0) continue;
    ends[row] = item.x + item.w / 2;
    out.push({ ...item, row });
  }
  return out;
}

interface Drag {
  key: string;
  what: "due" | "start" | "both";
  x0: number;
  days: number;
}

/** Zoom: 1 fits the span to the width; more spreads it, scrolled sideways. */
function useZoom() {
  const [zoom, setZoomState] = useState(1);
  // As far as days can be shown (set once the width is known).
  const max = useRef(16);
  // The scroller's way to put a date in the middle (set by Zoomable).
  const centre = useRef<((fraction: number) => void) | null>(null);
  const clamp = (z: number) => Math.min(max.current, Math.max(1, z));
  const setZoom = (next: (z: number) => number) =>
    setZoomState((z) => clamp(next(z)));
  return {
    zoom,
    max,
    centre,
    zoomIn: () => setZoom((z) => z * 1.6),
    zoomOut: () => setZoom((z) => z / 1.6),
    fit: () => setZoom(() => 1),
    onWheel: (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setZoom((z) => z * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    },
  };
}

function ZoomButtons({
  z,
  todayAt,
}: {
  z: ReturnType<typeof useZoom>;
  /** Where today is along the span (0 to 1), to scroll to it. */
  todayAt?: number;
}) {
  const button =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";
  return (
    <div className="flex items-center gap-0.5">
      {todayAt !== undefined && (
        <button
          type="button"
          onClick={() => z.centre.current?.(todayAt)}
          disabled={z.zoom === 1}
          className="mr-1 h-6 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          title="Scroll to today"
          aria-label="Go to today"
        >
          Today
        </button>
      )}
      <button
        type="button"
        onClick={z.zoomOut}
        disabled={z.zoom <= 1}
        className={button}
        title="Zoom out (⌘ and scroll)"
        aria-label="Zoom out"
      >
        <MinusIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={z.fit}
        disabled={z.zoom === 1}
        className="h-6 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        title="Fit the whole span"
      >
        Fit
      </button>
      <button
        type="button"
        onClick={z.zoomIn}
        disabled={z.zoom >= z.max.current}
        className={button}
        title="Zoom in, down to days (⌘ and scroll)"
        aria-label="Zoom in"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** The width a scroller gives its content, kept up to date. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth || 800);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Room for the projects' names beside every project's line. */
const NAMES = 160;
const BAR = 18;
const BAR_GAP = 4;

/** The line: periods above, milestones on it, marks under it. */
function Track({
  list,
  plan,
  span,
  width,
  compact = false,
}: {
  list: PlanList;
  plan: Plan;
  span: Span;
  /** Its width in pixels (the scroller's, times the zoom). */
  width: number;
  /** One row among many (every project's timeline): slimmer, fewer words. */
  compact?: boolean;
}) {
  const items = milestones(plan);
  const due = projectDue(plan);
  const [drag, setDrag] = useState<Drag | null>(null);
  const length = time(span.end) - time(span.start);
  const xOf = (iso: string) =>
    ((time(iso) - time(span.start)) / length) * width;
  const now = today();
  const grid = scaleFor(span.start, span.end, width);
  const shifted = (key: string, what: "due" | "start", iso: string) =>
    drag && drag.key === key && (drag.what === what || drag.what === "both")
      ? addDays(iso, drag.days)
      : iso;

  const begin =
    (key: string, what: Drag["what"]) => (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ key, what, x0: e.clientX, days: 0 });
    };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const days = Math.round(
      ((e.clientX - drag.x0) / width) * (length / MS_DAY),
    );
    if (days !== drag.days) setDrag({ ...drag, days });
  };
  const end = (commit: (days: number) => void) => () => {
    const d = drag;
    setDrag(null);
    if (d && d.days !== 0) commit(d.days);
  };
  const save = (m: Milestone, change: { due?: string; start?: string }) =>
    void editPlan(list, (p) => updateTask(p, m.ref, change));
  const keyOf = (m: Milestone) => `m${m.ref.section}-${m.ref.item}`;

  // Periods: in rows of their own where they overlap.
  const periods = items.filter((m) => m.task.start && m.task.due);
  const rowOf = lanes(
    periods.map((m) => ({
      start: time(m.task.start as string),
      end: time(m.task.due as string),
    })),
  );
  const periodRows = periods.length ? Math.max(...rowOf) + 1 : 0;
  const barH = compact ? 8 : BAR;
  const barsH = periodRows * (barH + BAR_GAP);
  const top = compact ? 4 : 18; // room for the months / Today
  const lineY = top + barsH + (compact ? 8 : 14);

  // Milestones (one day each) and the deadline, on the line.
  const points = [
    ...items
      .filter((m) => m.task.due && !m.task.start)
      .map((m) => {
        const date = shifted(keyOf(m), "due", m.task.due as string);
        const title = shownTitle(m.task.title);
        return {
          key: keyOf(m),
          m,
          title,
          date,
          x: xOf(date),
          w: textWidth(`${title} · ${short(date)}`),
        };
      }),
    ...(due
      ? [
          {
            key: "deadline",
            m: null,
            title: "Deadline",
            date: shifted("deadline", "due", due),
            x: xOf(shifted("deadline", "due", due)),
            w: textWidth(`Deadline · ${short(due)}`),
          },
        ]
      : []),
  ];
  const labelRows = compact ? 0 : 3;
  // Inside the line's width, so none is cut off at either end.
  const inside = <T extends { x: number; w: number }>(item: T) => ({
    ...item,
    lx: Math.min(Math.max(item.x, item.w / 2), width - item.w / 2),
  });
  const placed = placeLabels(
    points.map((p) => {
      const at = inside(p);
      return { ...at, x: at.lx, at: p.x };
    }),
    labelRows,
  );
  const usedRows = placed.length
    ? Math.max(...placed.map((p) => p.row)) + 1
    : 0;
  const labelsY = lineY + 14;
  const labelsH = usedRows * 16;

  // Marks: dated tasks and sections, named where there's room.
  const marks = compact
    ? []
    : [
        ...plan.sections.flatMap((s) => {
          const d =
            s.title && !isMilestonesSection(s.title) && sectionDue(s.title);
          return d
            ? [
                {
                  date: d,
                  title: sectionName(s.title as string),
                  section: true,
                },
              ]
            : [];
        }),
        ...allTasks(plan)
          .filter(
            (t) =>
              !t.task.done && t.task.due && !isMilestonesSection(t.section),
          )
          .map((t) => ({
            date: t.task.due as string,
            title: plainTitle(t.task.title),
            section: false,
          })),
      ]
        .filter((mk) => mk.date >= span.start && mk.date <= span.end)
        .map((mk) => ({
          ...mk,
          x: xOf(mk.date),
          w: textWidth(`${mk.title} · ${short(mk.date)}`, 5.6),
        }));
  const marksY = labelsY + labelsH + (marks.length ? 6 : 0);
  const markLabels = placeLabels(
    marks.map((mk) => ({ ...mk, x: inside(mk).lx })),
    3,
  );
  const marksH = marks.length
    ? 10 +
      (markLabels.length
        ? (Math.max(...markLabels.map((m) => m.row)) + 1) * 14
        : 0)
    : 0;
  const height = compact ? lineY + 10 : marksY + marksH + 6;

  return (
    <div className="relative select-none" style={{ width, height }}>
      {/* The scale's lines, faint, behind it all; weekends shaded when
          zoomed in to days. */}
      {!compact &&
        grid.minor.map((t) => (
          <div
            key={t.date}
            className={cn(
              "pointer-events-none absolute top-0 bottom-0 border-border/40 border-l",
              t.weekend && "bg-muted/50",
            )}
            style={{
              left: xOf(t.date),
              width: t.weekend ? width / (length / MS_DAY) : undefined,
            }}
          />
        ))}
      {!compact &&
        grid.major.map((t) => (
          <div
            key={`major-${t.date}`}
            className="pointer-events-none absolute top-0 bottom-0 border-border/70 border-l"
            style={{ left: xOf(t.date) }}
          />
        ))}
      {/* Today. */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
        style={{ left: xOf(now) }}
      >
        {!compact && (
          <span className="absolute top-0 left-1 whitespace-nowrap rounded bg-primary px-1 text-[10px] text-primary-foreground">
            Today
          </span>
        )}
      </div>
      {/* Periods. */}
      {periods.map((m, i) => {
        const key = keyOf(m);
        const from = shifted(key, "start", m.task.start as string);
        const to = shifted(key, "due", m.task.due as string);
        const left = xOf(from);
        const w = Math.max(6, xOf(to) - left);
        const progress = progressOf(plan, m);
        const risk = atRisk(progress, m.task.due, daysUntil);
        const share = progress?.total ? progress.done / progress.total : 0;
        const color = risk ? "var(--destructive)" : colorOf(m);
        const title = shownTitle(m.task.title);
        const label = `${title} · ${short(from)} – ${short(to)}${progress ? ` · ${progress.done} of ${progress.total}` : ""}`;
        return (
          <div
            key={`bar-${key}`}
            role="slider"
            aria-label={`${title}: drag to move the period`}
            aria-valuetext={`${short(from)} to ${short(to)}`}
            aria-valuenow={left}
            tabIndex={-1}
            onPointerDown={begin(key, "both")}
            onPointerMove={move}
            onPointerUp={end((days) =>
              save(m, {
                start: addDays(m.task.start as string, days),
                due: addDays(m.task.due as string, days),
              }),
            )}
            title={label}
            className="absolute cursor-grab overflow-hidden rounded-md active:cursor-grabbing"
            style={{
              left,
              width: w,
              top: top + rowOf[i] * (barH + BAR_GAP),
              height: barH,
              backgroundColor: `color-mix(in oklab, ${color} 22%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 45%, transparent)`,
            }}
          >
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${share * 100}%`,
                backgroundColor: `color-mix(in oklab, ${color} 45%, transparent)`,
              }}
            />
            {!compact && (
              <span className="relative block truncate px-1.5 text-[11px] leading-[18px]">
                <span className="font-medium">{title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {short(from)} – {short(to)}
                  {progress ? ` · ${progress.done}/${progress.total}` : ""}
                </span>
              </span>
            )}
            {/* Its ends: drag one to move only that date. */}
            <span
              onPointerDown={begin(key, "start")}
              onPointerMove={move}
              onPointerUp={end((days) =>
                save(m, { start: addDays(m.task.start as string, days) }),
              )}
              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
            />
            <span
              onPointerDown={begin(key, "due")}
              onPointerMove={move}
              onPointerUp={end((days) =>
                save(m, { due: addDays(m.task.due as string, days) }),
              )}
              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
            />
          </div>
        );
      })}
      {/* The line. */}
      <div
        className="absolute inset-x-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/25"
        style={{ top: lineY }}
      />
      {/* Milestones and the deadline. */}
      {points.map((p) => {
        const Icon = p.m ? iconOf(p.m) : FlagIcon;
        const color = p.m ? colorOf(p.m) : "var(--destructive)";
        const done = p.m?.task.done;
        return (
          <div
            key={p.key}
            role="slider"
            aria-label={`${p.title}: drag to change its date`}
            aria-valuetext={short(p.date)}
            aria-valuenow={p.x}
            tabIndex={-1}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full bg-background p-0.5 active:cursor-grabbing",
              drag?.key === p.key && "z-10",
            )}
            style={{ left: p.x, top: lineY }}
            title={`${p.title} · ${short(p.date)} (drag to move)`}
            onPointerDown={begin(p.key, "due")}
            onPointerMove={move}
            onPointerUp={end((days) => {
              if (!p.m) {
                const d = projectDue(plan);
                if (d)
                  void editPlan(list, (pl) =>
                    setProjectDue(pl, addDays(d, days)),
                  );
              } else {
                save(p.m, { due: addDays(p.m.task.due as string, days) });
              }
            })}
          >
            <Icon
              className={compact ? "size-3.5" : "size-4"}
              style={{ color }}
              fill={done || !p.m ? color : "transparent"}
            />
          </div>
        );
      })}
      {/* Their names, in rows that don't overlap. */}
      {placed.map((p) => {
        const done = p.m?.task.done;
        return (
          <div
            key={`label-${p.key}`}
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 truncate whitespace-nowrap text-center text-[11px]",
              !p.m && "font-medium text-destructive",
              done && "text-muted-foreground line-through",
            )}
            style={{ left: p.x, top: labelsY + p.row * 16, maxWidth: p.w }}
          >
            {p.title}
            <span className="font-normal text-muted-foreground">
              {" "}
              · {short(p.date)}
            </span>
          </div>
        );
      })}
      {/* Dated tasks and sections. */}
      {marks.map((mk, i) => (
        <span
          // Marks have nothing steadier to go by than their place.
          key={`${mk.date}-${i}`}
          title={`${mk.title} · ${short(mk.date)}`}
          className={cn(
            "absolute -translate-x-1/2",
            mk.section
              ? "size-1.5 rounded-[2px] bg-muted-foreground/70"
              : "h-2 w-px bg-muted-foreground/60",
          )}
          style={{ left: mk.x, top: marksY }}
        />
      ))}
      {markLabels.map((mk, i) => (
        <span
          key={`ml-${mk.date}-${i}`}
          className="pointer-events-none absolute -translate-x-1/2 truncate whitespace-nowrap text-[10px] text-muted-foreground"
          style={{ left: mk.x, top: marksY + 10 + mk.row * 14, maxWidth: mk.w }}
        >
          {mk.title} · {short(mk.date)}
        </span>
      ))}
    </div>
  );
}

/** The dates along the top: the larger unit above, the smaller below. */
function TimeAxis({ span, width }: { span: Span; width: number }) {
  const length = time(span.end) - time(span.start);
  const scale = scaleFor(span.start, span.end, width);
  const xOf = (iso: string) =>
    Math.max(0, ((time(iso) - time(span.start)) / length) * width);
  const dayWidth = width / (length / MS_DAY);
  return (
    <div className="select-none text-[10px]" style={{ width }}>
      {scale.major.length > 0 && (
        <div className="relative h-5 border-border/60 border-b">
          {scale.major.map((t) => (
            <span
              key={`M${t.date}`}
              className="absolute top-0 bottom-0 flex items-center whitespace-nowrap border-border/60 border-l pl-1.5 font-medium text-foreground/80"
              style={{ left: xOf(t.date) }}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}
      <div className="relative h-5 text-muted-foreground">
        {scale.minor.map((t) =>
          scale.unit === "day" ? (
            <span
              key={`m${t.date}`}
              className={cn(
                "absolute top-0 bottom-0 flex items-center justify-center tabular-nums",
                t.weekend && "text-muted-foreground/50",
                t.date === today() && "font-semibold text-primary",
              )}
              style={{ left: xOf(t.date), width: dayWidth }}
            >
              {t.label}
            </span>
          ) : (
            <span
              key={`m${t.date}`}
              className="absolute top-0 bottom-0 flex items-center whitespace-nowrap pl-1"
              style={{ left: xOf(t.date) }}
            >
              {t.label}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/** Which section a milestone follows: picked from the plan's own. */
function SectionPicker({
  list,
  plan,
  m,
}: {
  list: PlanList;
  plan: Plan;
  m: Milestone;
}) {
  const linked = linkedSection(m.task);
  const progress = progressOf(plan, m);
  const risk = atRisk(progress, m.task.due, daysUntil);
  const names = plan.sections
    .filter((s) => s.title !== null && !isMilestonesSection(s.title))
    .map((s) => sectionName(s.title as string));
  const link = (name: string | null) =>
    void editPlan(list, (p) =>
      updateTask(p, m.ref, { title: withLink(m.task.title, name) }),
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={linked ? `Follows “${linked}”` : "Follow a section's progress"}
          aria-label={
            linked ? `Follows ${linked}` : "Follow a section's progress"
          }
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] tabular-nums hover:bg-muted",
            linked
              ? risk
                ? "text-destructive"
                : "text-muted-foreground"
              : "text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <ListChecksIcon className="size-3.5" />
          {linked && progress
            ? `${progress.done} of ${progress.total}`
            : linked
              ? "—"
              : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {names.length === 0 && (
          <DropdownMenuItem disabled>No sections in this plan</DropdownMenuItem>
        )}
        {names.map((name) => (
          <DropdownMenuItem key={name} onSelect={() => link(name)}>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {name === linked && <span aria-hidden>✓</span>}
          </DropdownMenuItem>
        ))}
        {linked && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => link(null)}>
              Don't follow a section
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A milestone's icon and color, picked from a small grid. */
function StylePicker({ list, m }: { list: PlanList; m: Milestone }) {
  const style = styleOf(m.task);
  const Icon = iconOf(m);
  const color = colorOf(m);
  const set = (change: {
    icon?: MilestoneIcon | null;
    color?: MilestoneColor | null;
  }) =>
    void editPlan(list, (p) =>
      updateTask(p, m.ref, { title: withStyle(m.task.title, change) }),
    );
  const period = !!m.task.start;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Icon and color"
          aria-label="Icon and color"
          className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
        >
          {period ? (
            <span
              className="h-2.5 w-4 rounded-sm"
              style={{
                backgroundColor: `color-mix(in oklab, ${color} 45%, transparent)`,
              }}
            />
          ) : (
            <Icon
              className="size-[18px]"
              style={{ color }}
              fill={m.task.done ? color : "transparent"}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2 p-2">
        {!period && (
          <div className="grid grid-cols-5 gap-1">
            {MILESTONE_ICONS.map((name) => {
              const I = ICONS[name];
              const on = (style.icon ?? "diamond") === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => set({ icon: name })}
                  title={ICON_LABEL[name]}
                  aria-label={ICON_LABEL[name]}
                  aria-pressed={on}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md hover:bg-muted",
                    on && "bg-muted ring-1 ring-ring",
                  )}
                >
                  <I className="size-4" style={{ color }} />
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {MILESTONE_COLORS.map((name) => {
            const on = (style.color ?? "orange") === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => set({ color: name === "orange" ? null : name })}
                title={name[0].toUpperCase() + name.slice(1)}
                aria-label={`Color ${name}`}
                aria-pressed={on}
                className={cn(
                  "size-5 rounded-full ring-offset-1 ring-offset-popover hover:ring-2 hover:ring-ring",
                  on && "ring-2 ring-ring",
                )}
                style={{ backgroundColor: COLOR[name] }}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MilestoneRow({
  list,
  plan,
  m,
}: {
  list: PlanList;
  plan: Plan;
  m: Milestone;
}) {
  const ref = m.ref;
  const linked = linkedSection(m.task);
  const names = plan.sections
    .filter((s) => s.title !== null && !isMilestonesSection(s.title))
    .map((s) => sectionName(s.title as string));
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/70">
          <StylePicker list={list} m={m} />
          <button
            type="button"
            onClick={() => void editPlan(list, (p) => toggleTask(p, ref))}
            className={cn(
              "min-w-0 flex-1 truncate text-left text-sm",
              m.task.done && "text-muted-foreground line-through",
            )}
            title={m.task.done ? "Mark as not reached" : "Mark as reached"}
            aria-label={`${shownTitle(m.task.title)}, ${m.task.done ? "mark as not reached" : "mark as reached"}`}
          >
            {shownTitle(m.task.title)}
          </button>
          {m.task.due && !m.task.done && daysUntil(m.task.due) > 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              in {daysUntil(m.task.due)} days
            </span>
          )}
          <SectionPicker list={list} plan={plan} m={m} />
          <span
            className={cn(
              "flex items-center",
              !m.task.start &&
                "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
            )}
          >
            <DueButton
              plain
              due={m.task.start}
              label="Start"
              ariaLabel="Start date"
              onChange={(start) =>
                void editPlan(list, (p) => updateTask(p, ref, { start }))
              }
            />
          </span>
          {m.task.start && (
            <span className="text-muted-foreground text-xs" aria-hidden>
              –
            </span>
          )}
          <DueButton
            due={m.task.due}
            onChange={(due) =>
              void editPlan(list, (p) => updateTask(p, ref, { due }))
            }
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem
          onClick={() => void editPlan(list, (p) => toggleTask(p, ref))}
        >
          {m.task.done ? "Mark as not reached" : "Mark as reached"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ListChecksIcon className="size-3.5" />
            Follow a section
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {names.length === 0 && (
              <ContextMenuItem disabled>No sections</ContextMenuItem>
            )}
            {names.map((name) => (
              <ContextMenuItem
                key={name}
                onClick={() =>
                  void editPlan(list, (p) =>
                    updateTask(p, ref, { title: withLink(m.task.title, name) }),
                  )
                }
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {name === linked && <span aria-hidden>✓</span>}
              </ContextMenuItem>
            ))}
            {linked && (
              <ContextMenuItem
                onClick={() =>
                  void editPlan(list, (p) =>
                    updateTask(p, ref, { title: withLink(m.task.title, null) }),
                  )
                }
              >
                Don't follow
              </ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() =>
            void removeFromPlan(
              list,
              (p) => deleteTask(p, ref),
              "Milestone deleted",
            )
          }
        >
          <Trash2Icon className="size-3.5" />
          Delete milestone
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A sideways scroller for the line, zoomed with ⌘ and the wheel. */
function Zoomable({
  z,
  span,
  reserve = 0,
  children,
}: {
  z: ReturnType<typeof useZoom>;
  span: Span;
  /** Pixels kept for something beside the line (the projects' names). */
  reserve?: number;
  children: (width: number) => ReactNode;
}) {
  const { ref, width } = useWidth();
  const base = Math.max(200, width - reserve);
  const inner = Math.max(200, Math.round(base * z.zoom));
  const days = Math.max(1, (time(span.end) - time(span.start)) / MS_DAY);
  // Zoomed in until every day has room for its number, no further.
  z.max.current = Math.max(1, (PX_PER_DAY_FOR_DAYS * 1.4 * days) / base);
  // What's in the middle stays there as it zooms.
  const middle = useRef(0.5);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    middle.current =
      (el.scrollLeft + el.clientWidth / 2 - reserve) / Math.max(1, inner);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = middle.current * inner + reserve - el.clientWidth / 2;
  }, [inner, reserve, ref]);
  z.centre.current = (fraction) => {
    const el = ref.current;
    if (!el) return;
    middle.current = fraction;
    el.scrollTo({
      left: fraction * inner + reserve - el.clientWidth / 2,
      behavior: "smooth",
    });
  };
  return (
    <div
      ref={ref}
      onWheel={z.onWheel}
      onScroll={onScroll}
      className="overflow-x-auto pb-2"
    >
      {children(inner)}
    </div>
  );
}

export function TimelineView({ list }: { list: PlanList }) {
  const text = usePlanText(list.key);
  const [draft, setDraft] = useState("");
  const z = useZoom();
  if (text === undefined) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  const plan = parsePlan(text ?? newPlanText(list.name));
  const items = milestones(plan);
  const due = projectDue(plan);
  const next = items.find((m) => !m.task.done && m.task.due);
  const span = spanOf(datesOf(plan));
  return (
    <div className="px-8 py-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseQuickAdd(draft);
          if (!parsed.title) return;
          void editPlan(list, (p) => addMilestone(p, parsed.title, parsed.due));
          setDraft("");
        }}
        className="flex items-center gap-2 rounded-lg border border-transparent bg-muted/60 px-2.5 focus-within:border-ring focus-within:bg-background"
      >
        <PlusIcon className="size-4 text-primary" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a milestone, like “First draft dec 1”"
          aria-label="Add a milestone"
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </form>
      {items.length === 0 && !due ? (
        <Empty
          icon={<DiamondIcon className="size-6" />}
          title="No milestones yet."
          text="Add the steps on the way, like a first draft or the submission, and set the project's deadline at the top."
        />
      ) : (
        <>
          <div className="mt-4 flex items-center justify-end">
            <ZoomButtons z={z} todayAt={todayAt(span)} />
          </div>
          <Zoomable z={z} span={span}>
            {(width) => (
              <>
                <TimeAxis span={span} width={width} />
                <Track list={list} plan={plan} span={span} width={width} />
              </>
            )}
          </Zoomable>
          {(next || due) && (
            <p className="flex flex-wrap items-center gap-x-1 px-2 pb-2 text-muted-foreground text-xs">
              {next && (
                <>
                  Next:{" "}
                  <span className="text-foreground">
                    {shownTitle(next.task.title)}
                  </span>{" "}
                  <DueBadge due={next.task.due as string} />
                </>
              )}
              {next && due && " · "}
              {due && (
                <>
                  Deadline <DueBadge due={due} />
                </>
              )}
            </p>
          )}
          <div className="border-border border-t pt-2">
            {items.map((m) => (
              <MilestoneRow
                key={`${m.ref.item}-${m.task.title}`}
                list={list}
                plan={plan}
                m={m}
              />
            ))}
            {due && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <span className="flex size-7 items-center justify-center">
                  <FlagIcon className="size-[18px] text-destructive" />
                </span>
                <span className="min-w-0 flex-1 font-medium text-sm">
                  Deadline
                </span>
                <DueButton
                  ariaLabel="Deadline"
                  due={due}
                  onChange={(d) =>
                    void editPlan(list, (p) => setProjectDue(p, d))
                  }
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Every project's line on one span of dates, a row each, zoomed together. */
export function ProjectsTimeline({
  lists,
  onOpen,
}: {
  lists: PlanList[];
  onOpen: (list: PlanList) => void;
}) {
  const projects = lists.filter((l) => isProjectKey(l.key));
  const texts = usePlanTexts(projects.map((l) => l.key));
  const z = useZoom();
  const rows = projects.flatMap((list) => {
    const text = texts[list.key];
    if (!text) return [];
    const plan = parsePlan(text);
    const dates = datesOf(plan);
    return dates.length ? [{ list, plan, dates }] : [];
  });
  if (rows.length === 0) {
    return (
      <Empty
        icon={<DiamondIcon className="size-6" />}
        title="No dates yet."
        text="Give your projects a deadline or milestones (in each project's Timeline) and they line up here."
      />
    );
  }
  const span = spanOf(rows.flatMap((r) => r.dates));
  return (
    <div className="px-6 py-5">
      <div className="mb-2 flex justify-end">
        <ZoomButtons z={z} todayAt={todayAt(span)} />
      </div>
      <Zoomable z={z} span={span} reserve={NAMES}>
        {(width) => (
          <div style={{ width: width + NAMES }}>
            <div className="flex">
              <div
                className="sticky left-0 z-20 shrink-0 bg-background"
                style={{ width: NAMES }}
              />
              <TimeAxis span={span} width={width} />
            </div>
            {rows.map(({ list, plan }) => (
              <div
                key={list.key}
                className="flex min-h-10 items-center border-border/40 border-b"
              >
                {/* Its name, kept in place as the lines scroll. */}
                <button
                  type="button"
                  onClick={() => onOpen(list)}
                  title={`Open ${list.name}'s timeline`}
                  className="sticky left-0 z-20 shrink-0 self-stretch truncate bg-background px-2 text-left text-sm hover:bg-muted"
                  style={{ width: NAMES }}
                >
                  {list.name}
                </button>
                <Track
                  list={list}
                  plan={plan}
                  span={span}
                  width={width}
                  compact
                />
              </div>
            ))}
          </div>
        )}
      </Zoomable>
    </div>
  );
}
