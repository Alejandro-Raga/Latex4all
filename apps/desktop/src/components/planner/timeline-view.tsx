/**
 * A project's timeline: its milestones on the way to its deadline, on a line
 * that runs from today (or the first date) to the deadline, with today marked.
 * A milestone with a start date is a phase, drawn as a bar; one following a
 * section of the plan fills with how much of it is done, and turns red when
 * its date is close and much is left. Milestones, phases and the deadline can
 * be dragged along the line to change their dates; the plan's dated sections
 * and tasks show as small marks under it. Below: the milestones as a list.
 *
 * ProjectsTimeline puts every project's line on one shared span of dates.
 */
import {
  DiamondIcon,
  FlagIcon,
  ListChecksIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";
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
import { daysUntil } from "@/lib/plan/dates";
import { shownTitle } from "@/lib/plan/matrix-opt";
import {
  addMilestone,
  atRisk,
  isMilestonesSection,
  linkedSection,
  type Milestone,
  milestones,
  sectionProgress,
  withLink,
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
import { cn } from "@/lib/utils";
import { editPlan } from "./plan-actions";
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

interface Span {
  start: string;
  end: string;
}

/** Every date on a plan's line: today, its milestones, phases and deadline. */
function datesOf(plan: Plan): string[] {
  const due = projectDue(plan);
  return [
    ...milestones(plan).flatMap((m) =>
      [m.task.due, m.task.start].filter((d): d is string => !!d),
    ),
    ...(due ? [due] : []),
  ];
}

/** From the earliest to the latest, a month's room at least. */
function spanOf(dates: string[]): Span {
  const all = [today(), ...dates];
  const start = all.reduce((a, b) => (a < b ? a : b));
  let end = all.reduce((a, b) => (a > b ? a : b));
  if (time(end) - time(start) < 30 * MS_DAY) end = addDays(start, 30);
  return { start, end };
}

/** A milestone's progress, when it follows a section. */
function progressOf(plan: Plan, m: Milestone) {
  const name = linkedSection(m.task);
  return name ? sectionProgress(plan, name) : null;
}

interface Drag {
  key: string;
  /** What moves: its date, or a phase's start and end together. */
  what: "due" | "start" | "both";
  x0: number;
  /** Days moved so far. */
  days: number;
}

/** The line: phases, milestones and the deadline placed by date. */
function Track({
  list,
  plan,
  span,
  compact = false,
}: {
  list: PlanList;
  plan: Plan;
  span: Span;
  /** One row among many (every project's timeline): no labels, no marks. */
  compact?: boolean;
}) {
  const items = milestones(plan);
  const due = projectDue(plan);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const length = time(span.end) - time(span.start);
  const at = (iso: string) => ((time(iso) - time(span.start)) / length) * 100;
  const clampPct = (pct: number) => Math.min(98, Math.max(2, pct));
  const leftPct = (iso: string) => `${clampPct(at(iso))}%`;
  const now = today();
  const shift = (key: string, what: Drag["what"], iso: string) =>
    drag && drag.key === key && (drag.what === what || drag.what === "both")
      ? addDays(iso, drag.days)
      : iso;

  // Dragging: the pointer's distance along the line, in days.
  const begin =
    (key: string, what: Drag["what"]) => (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ key, what, x0: e.clientX, days: 0 });
    };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!drag || !ref.current) return;
    const width = ref.current.getBoundingClientRect().width || 1;
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

  const markers = [
    ...items
      .filter((m) => m.task.due)
      .map((m) => ({
        key: `m${m.ref.section}-${m.ref.item}`,
        kind: "milestone" as const,
        m,
        title: shownTitle(m.task.title),
        date: shift(
          `m${m.ref.section}-${m.ref.item}`,
          "due",
          m.task.due as string,
        ),
        done: m.task.done,
        risk: atRisk(progressOf(plan, m), m.task.due, daysUntil),
      })),
    ...(due
      ? [
          {
            key: "deadline",
            kind: "deadline" as const,
            m: null,
            title: "Deadline",
            date: shift("deadline", "due", due),
            done: false,
            risk: false,
          },
        ]
      : []),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((mk) => ({ ...mk, row: 0 }));
  // One close to the one before puts its label on the other side.
  markers.forEach((mk, i) => {
    const prev = markers[i - 1];
    if (prev && at(mk.date) - at(prev.date) < 14) mk.row = prev.row ? 0 : 1;
  });

  const phases = items.filter((m) => m.task.start && m.task.due);
  // Marks under the line: dated sections, and open tasks with a date.
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
                  title: `${sectionName(s.title as string)}`,
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
            title: shownTitle(t.task.title),
            section: false,
          })),
      ].filter((mk) => mk.date >= span.start && mk.date <= span.end);

  const save = (m: Milestone, change: { due?: string; start?: string }) =>
    void editPlan(list, (p) => updateTask(p, m.ref, change));

  return (
    <div
      ref={ref}
      className={cn(
        "relative mx-2 select-none",
        compact ? "h-10" : "mt-6 mb-10 h-20",
      )}
    >
      {/* The line, done up to today. */}
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-primary/40"
        style={{ width: `${Math.max(0, Math.min(100, at(now)))}%` }}
      />
      {/* Phases: bars from start to end, filled as their section is done. */}
      {phases.map((m) => {
        const key = `m${m.ref.section}-${m.ref.item}`;
        const from = shift(key, "start", m.task.start as string);
        const to = shift(key, "due", m.task.due as string);
        const left = clampPct(at(from));
        const width = Math.max(1, clampPct(at(to)) - left);
        const progress = progressOf(plan, m);
        const risk = atRisk(progress, m.task.due, daysUntil);
        const share = progress?.total ? progress.done / progress.total : 0;
        return (
          <div
            key={`bar-${key}`}
            role="slider"
            aria-label={`${shownTitle(m.task.title)}: move the phase`}
            aria-valuetext={`${short(from)} to ${short(to)}`}
            aria-valuenow={at(from)}
            tabIndex={-1}
            onPointerDown={begin(key, "both")}
            onPointerMove={move}
            onPointerUp={end((days) =>
              save(m, {
                start: addDays(m.task.start as string, days),
                due: addDays(m.task.due as string, days),
              }),
            )}
            title={`${shownTitle(m.task.title)} · ${short(from)} – ${short(to)}${progress ? ` · ${progress.done} of ${progress.total} done` : ""}`}
            className="absolute top-1/2 h-2.5 -translate-y-1/2 cursor-grab overflow-hidden rounded-full active:cursor-grabbing"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: risk
                ? "color-mix(in oklab, var(--destructive) 30%, transparent)"
                : "color-mix(in oklab, var(--chart-4) 30%, transparent)",
            }}
          >
            <div
              className="h-full"
              style={{
                width: `${share * 100}%`,
                backgroundColor: risk ? "var(--destructive)" : "var(--chart-4)",
              }}
            />
            {/* The start's edge: drag to move the start alone. */}
            <span
              onPointerDown={begin(key, "start")}
              onPointerMove={move}
              onPointerUp={end((days) =>
                save(m, { start: addDays(m.task.start as string, days) }),
              )}
              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
            />
          </div>
        );
      })}
      {/* Today. */}
      <div
        className="pointer-events-none absolute top-1 bottom-1 w-px bg-primary"
        style={{ left: leftPct(now) }}
      >
        {!compact && (
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1 text-[10px] text-primary-foreground">
            Today
          </span>
        )}
      </div>
      {marks.map((mk, i) => (
        <span
          key={i}
          title={`${mk.title} · ${short(mk.date)}`}
          className={cn(
            "absolute top-1/2 mt-2.5 -translate-x-1/2",
            mk.section
              ? "size-1.5 rounded-[2px] bg-muted-foreground/70"
              : "h-1.5 w-px bg-muted-foreground/60",
          )}
          style={{ left: leftPct(mk.date) }}
        />
      ))}
      {markers.map((mk) => (
        <div
          key={mk.key}
          role="slider"
          aria-label={`${mk.title}: drag to change its date`}
          aria-valuetext={short(mk.date)}
          aria-valuenow={at(mk.date)}
          tabIndex={-1}
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none active:cursor-grabbing",
            drag?.key === mk.key && "z-10",
          )}
          style={{ left: leftPct(mk.date) }}
          title={`${mk.title} · ${short(mk.date)} (drag to move)`}
          onPointerDown={begin(mk.key, "due")}
          onPointerMove={move}
          onPointerUp={end((days) => {
            if (mk.kind === "deadline") {
              const d = projectDue(plan);
              if (d)
                void editPlan(list, (p) => setProjectDue(p, addDays(d, days)));
            } else if (mk.m) {
              save(mk.m, { due: addDays(mk.m.task.due as string, days) });
            }
          })}
        >
          {mk.kind === "deadline" ? (
            <FlagIcon
              className="size-4 text-destructive"
              fill="var(--destructive)"
            />
          ) : (
            <DiamondIcon
              className="size-4"
              style={{
                color: mk.risk ? "var(--destructive)" : "var(--chart-4)",
              }}
              fill={
                mk.done
                  ? mk.risk
                    ? "var(--destructive)"
                    : "var(--chart-4)"
                  : "var(--background)"
              }
            />
          )}
          {(!compact || drag?.key === mk.key) && (
            <span
              className={cn(
                "pointer-events-none absolute left-1/2 max-w-32 -translate-x-1/2 truncate whitespace-nowrap text-center text-[11px]",
                mk.row === 0 || compact ? "top-5" : "bottom-5",
                mk.kind === "deadline" && "font-medium text-destructive",
                mk.risk && "text-destructive",
                mk.done && "text-muted-foreground line-through",
              )}
            >
              {!compact && mk.title}
              <span className="block font-normal text-[10px] text-muted-foreground">
                {short(mk.date)}
              </span>
            </span>
          )}
        </div>
      ))}
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
          <button
            type="button"
            onClick={() => void editPlan(list, (p) => toggleTask(p, ref))}
            aria-label={m.task.done ? "Mark as not reached" : "Mark as reached"}
            className="shrink-0 transition-transform hover:scale-110"
          >
            <DiamondIcon
              className="size-[18px]"
              style={{ color: "var(--chart-4)" }}
              fill={m.task.done ? "var(--chart-4)" : "none"}
            />
          </button>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              m.task.done && "text-muted-foreground line-through",
            )}
          >
            {shownTitle(m.task.title)}
          </span>
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
          onClick={() => void editPlan(list, (p) => deleteTask(p, ref))}
        >
          <Trash2Icon className="size-3.5" />
          Delete milestone
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TimelineView({ list }: { list: PlanList }) {
  const text = usePlanText(list.key);
  const [draft, setDraft] = useState("");
  if (text === undefined) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  const plan = parsePlan(text ?? newPlanText(list.name));
  const items = milestones(plan);
  const due = projectDue(plan);
  const next = items.find((m) => !m.task.done && m.task.due);
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
          <Track list={list} plan={plan} span={spanOf(datesOf(plan))} />
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
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <FlagIcon className="size-[18px] text-destructive" />
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

/** Every project's line on one span of dates, a row each. */
export function ProjectsTimeline({
  lists,
  onOpen,
}: {
  lists: PlanList[];
  onOpen: (list: PlanList) => void;
}) {
  const projects = lists.filter((l) => isProjectKey(l.key));
  const texts = usePlanTexts(projects.map((l) => l.key));
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
  // The months along the top.
  const months: string[] = [];
  for (
    let d = new Date(`${span.start.slice(0, 7)}-01T00:00`);
    today(d) <= span.end;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  ) {
    if (today(d) >= span.start) months.push(today(d));
  }
  const at = (iso: string) =>
    ((time(iso) - time(span.start)) / (time(span.end) - time(span.start))) *
    100;
  return (
    <div className="px-6 py-5">
      <div className="grid grid-cols-[10rem_1fr] items-center gap-x-3">
        <span />
        <div className="relative mx-2 h-5 text-[10px] text-muted-foreground">
          {months.map((m) => (
            <span
              key={m}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${Math.min(97, Math.max(3, at(m)))}%` }}
            >
              {new Date(`${m}T00:00`).toLocaleDateString(undefined, {
                month: "short",
              })}
              {/* The year where it starts, and on the first month shown. */}
              {(m.endsWith("-01-01") || m === months[0]) && ` ${m.slice(0, 4)}`}
            </span>
          ))}
        </div>
        {rows.map(({ list, plan }) => (
          <div key={list.key} className="contents">
            <button
              type="button"
              onClick={() => onOpen(list)}
              title={`Open ${list.name}'s timeline`}
              className="truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
            >
              {list.name}
            </button>
            <Track list={list} plan={plan} span={span} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
