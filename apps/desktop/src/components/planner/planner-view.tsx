import { type ReactNode, useMemo, useState, useEffect } from "react";
import {
  LayoutDashboardIcon,
  FlagIcon,
  Grid2x2Icon,
  ArrowUpDownIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  InboxIcon,
  KanbanIcon,
  LayersIcon,
  ListIcon,
  ListTodoIcon,
  MilestoneIcon,
  SearchIcon,
  SunIcon,
  SquarePenIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daysUntil } from "@/lib/plan/dates";
import {
  parsePlan,
  projectDue,
  setProjectDue,
  childRef,
  taskAt,
  projectPriority,
  setProjectPriority,
  type Priority,
  projectDone,
  setProjectDone,
} from "@/lib/plan/plan-file";
import {
  INBOX,
  backToPlanner,
  READING_LIST,
  isProjectKey,
  useOwnLists,
  type PlanKey,
  type PlanList,
  usePlanLists,
  usePlanText,
  usePlanTexts,
  useReloadPlans,
} from "@/lib/plan/plan-store";
import { datedSubtasks, readingItems, workTasks } from "@/lib/plan/reading";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useBack } from "@/stores/back-store";
import { goToProject, useNav } from "@/stores/nav-store";
import { useSettingsStore } from "@/stores/settings-store";
import { completeDrag, dueOn, moveToPlan } from "./plan-actions";
import { type DragTask, PlannerDnd, useDropArea } from "./planner-dnd";
import {
  actionsFor,
  contextOf,
  PlanView,
  type PlanViewMode,
  ReadingView,
  SMART_LABEL,
  type Selected,
  type SmartFilter,
  SmartView,
} from "./plan-views";
import { CalendarView } from "./calendar-view";
import { MatrixView, quadrantOf } from "./matrix-view";
import { OverviewView } from "./overview-view";
import { outOfMatrix } from "@/lib/plan/matrix-opt";
import { ProjectPriorityMenu } from "./project-priority-menu";
import { useMoveInboxReading } from "./reading-move";
import { TimelineView } from "./timeline-view";
import { ProjectIcon, typeColor, listColor } from "./project-icon";
import {
  DueBadge,
  DueButton,
  TaskDetails,
  PriorityMenu,
  PRIORITY_LABEL,
  PRIORITY_COLOR,
} from "./task-parts";
import { editPlan } from "./plan-actions";

type Selection = { smart: SmartFilter } | { plan: PlanKey };
type Tab = "tasks" | "reading" | "timeline";
type ProjectSort = "recent" | "type" | "priority" | "due" | "count" | "name";

const SORT_LABEL: Record<ProjectSort, string> = {
  recent: "Recently opened",
  type: "Type",
  priority: "Priority",
  due: "Due soonest",
  count: "Most tasks",
  name: "Name",
};

interface ProjectGroup {
  key: string;
  /** null: no heading (sorted by name, one plain list). */
  title: string | null;
  items: PlanList[];
}

const DAY = 86_400_000;

/** The project list split into groups that follow the chosen order. */
/** Finished projects apart, at the end; the rest grouped by the order. */
function groupProjects(
  projects: PlanList[],
  sort: ProjectSort,
  stats: Parameters<typeof groupOpen>[2],
): ProjectGroup[] {
  const done = projects.filter((p) => stats[p.key]?.done);
  const open = projects.filter((p) => !stats[p.key]?.done);
  return [
    ...groupOpen(open, sort, stats),
    ...(done.length
      ? [{ key: "completed", title: "Completed", items: done }]
      : []),
  ];
}

function groupOpen(
  projects: PlanList[],
  sort: ProjectSort,
  stats: Record<
    PlanKey,
    {
      open: number;
      due: number;
      next?: string;
      priority?: Priority;
      done?: boolean;
    }
  >,
  now = Date.now(),
): ProjectGroup[] {
  const by = (pick: (p: PlanList) => [string, string]) => {
    const groups = new Map<string, ProjectGroup>();
    for (const p of projects) {
      const [key, title] = pick(p);
      const g = groups.get(key) ?? { key, title, items: [] };
      g.items.push(p);
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  if (sort === "name") return [{ key: "all", title: null, items: projects }];
  if (sort === "recent") {
    const start = new Date(now).setHours(0, 0, 0, 0);
    return by((p) => {
      const at = p.lastOpened ?? 0;
      if (at >= start) return ["today", "Opened today"];
      if (at >= start - 6 * DAY) return ["week", "This week"];
      if (at >= start - 30 * DAY) return ["month", "This month"];
      return ["earlier", "Earlier"];
    });
  }
  if (sort === "type") {
    const groups = by((p) =>
      p.type ? [`type:${p.type.toLowerCase()}`, p.type] : ["none", "No type"],
    );
    return groups.sort(
      (a, b) =>
        Number(a.key === "none") - Number(b.key === "none") ||
        (a.title ?? "").localeCompare(b.title ?? ""),
    );
  }
  if (sort === "priority") {
    return by((p) => {
      const pr = stats[p.key]?.priority ?? 0;
      return [`p${pr}`, pr ? `${PRIORITY_LABEL[pr]} priority` : "No priority"];
    }).sort((a, b) => b.key.localeCompare(a.key));
  }
  if (sort === "due") {
    const order = ["overdue", "today", "week", "later", "none"];
    return by((p) => {
      const next = stats[p.key]?.next;
      if (!next) return ["none", "No dates"];
      const days = daysUntil(next);
      if (days < 0) return ["overdue", "Overdue"];
      if (days === 0) return ["today", "Due today"];
      if (days <= 6) return ["week", "Due this week"];
      return ["later", "Later"];
    }).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  const order = ["busy", "some", "empty"];
  return by((p) => {
    const open = stats[p.key]?.open ?? 0;
    if (open >= 10) return ["busy", "Busy"];
    if (open > 0) return ["some", "A few tasks"];
    return ["empty", "Empty"];
  }).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** A group of projects in the sidebar, folding away. */
function ProjectGroupBlock({
  group,
  folded,
  onFold,
  children,
}: {
  group: ProjectGroup;
  folded: boolean;
  onFold: () => void;
  children: ReactNode;
}) {
  if (group.title === null) return <>{children}</>;
  return (
    <div>
      <button
        type="button"
        onClick={onFold}
        aria-expanded={!folded}
        className="flex w-full items-center gap-1 px-2 pt-2 pb-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn("size-3 transition-transform", !folded && "rotate-90")}
        />
        <span className="flex-1 truncate">{group.title}</span>
        <span className="tabular-nums opacity-70">{group.items.length}</span>
      </button>
      {!folded && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

/** Each smart list's color, and its icon. */
/** Each list its own color, from the theme. */
const SMART: Record<SmartFilter, { color: string; icon: ReactNode }> = {
  today: { color: "var(--primary)", icon: <TodayIcon /> },
  tomorrow: { color: "var(--chart-4)", icon: <SunIcon className="size-4" /> },
  week: {
    color: "var(--chart-3)",
    icon: <CalendarRangeIcon className="size-4" />,
  },
  calendar: {
    color: "var(--chart-1)",
    icon: <CalendarDaysIcon className="size-4" />,
  },
  matrix: {
    color: "var(--destructive)",
    icon: <Grid2x2Icon className="size-4" />,
  },
  overview: {
    color: "var(--chart-2)",
    icon: <LayoutDashboardIcon className="size-4" />,
  },
  reading: {
    color: "color-mix(in oklab, var(--chart-4) 50%, var(--chart-5))",
    icon: <BookOpenIcon className="size-4" />,
  },
  all: {
    color: "var(--muted-foreground)",
    icon: <LayersIcon className="size-4" />,
  },
  completed: {
    color: "var(--chart-2)",
    icon: <CheckCircle2Icon className="size-4" />,
  },
};
const INBOX_COLOR = "color-mix(in oklab, var(--chart-3) 55%, var(--chart-1))";

/** Today's icon: a calendar page showing today's date. */
function TodayIcon() {
  return (
    <span className="relative flex size-4 items-center justify-center">
      <span className="absolute inset-0 rounded-[4px] border-[1.5px] border-current" />
      <span className="absolute inset-x-0 top-0 h-1 rounded-t-[4px] bg-current" />
      <span className="mt-1 font-bold text-[8px] leading-none">
        {new Date().getDate()}
      </span>
    </span>
  );
}

const VIEW_KEY = "planner-view";

function load<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(`${VIEW_KEY}-${key}`) ?? "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(`${VIEW_KEY}-${key}`, JSON.stringify(value));
  } catch {
    // For this session only.
  }
}

function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  return [
    value,
    (v: T) => {
      setValue(v);
      remember(key, v);
    },
  ];
}

/**
 * The Planner, laid out as TickTick is: lists on the left, the chosen one
 * in the middle, the picked task's details on the right. Tasks drag between
 * sections, onto another project or the Inbox, or onto Today / Tomorrow.
 */
export function PlannerView() {
  const lists = usePlanLists();
  // General reading counts and shows with the rest, though it isn't a list.
  const withReading = useMemo(() => [...lists, READING_LIST], [lists]);
  const keys = useMemo(() => withReading.map((l) => l.key), [withReading]);
  useMoveInboxReading();
  useReloadPlans(keys);
  const texts = usePlanTexts(keys);
  const [selected, select] = useStored<Selection>("selected", {
    smart: "today",
  });
  // Asked for a list (a project's, from its editor or card): that one.
  const navAsked = useNav((st) => st.asked);
  useEffect(() => {
    const focus = useNav.getState().focus;
    if (navAsked && focus && useNav.getState().section === "planner") {
      select({ plan: focus });
    }
  }, [navAsked]);
  // List or board, chosen apart for tasks and for reading.
  const [taskMode, setTaskMode] = useStored<PlanViewMode>("mode-tasks", "list");
  const [readMode, setReadMode] = useStored<PlanViewMode>(
    "mode-reading",
    "list",
  );
  const [tab, setTab] = useStored<Tab>("tab", "tasks");
  // The Inbox has no reading of its own any more.
  useEffect(() => {
    if (tab === "reading" && "plan" in selected && selected.plan === INBOX) {
      setTab("tasks");
    }
  }, [tab, selected, setTab]);
  const mode = tab === "reading" ? readMode : taskMode;
  const setMode = tab === "reading" ? setReadMode : setTaskMode;
  const [sort, setSort] = useStored<ProjectSort>("sort", "recent");
  // Groups of projects folded away, per order ("recent:earlier").
  const [folded, setFolded] = useStored<string[]>("folded", []);
  const [projectQuery, setProjectQuery] = useState("");
  const _dailySummary = useSettingsStore((st) => st.dailySummary);
  const _setDailySummary = useSettingsStore((st) => st.setDailySummary);
  const [picked, setPicked] = useState<Selected | null>(null);

  // Per plan: open tasks, due today or before, the soonest date.
  const stats = useMemo(() => {
    const plans: Record<
      PlanKey,
      {
        open: number;
        due: number;
        next?: string;
        deadline?: string;
        priority: Priority;
        done: boolean;
      }
    > = {};
    const smart: Record<SmartFilter, number> = {
      today: 0,
      tomorrow: 0,
      week: 0,
      calendar: 0,
      matrix: 0,
      overview: 0,
      reading: 0,
      all: 0,
      completed: 0,
    };
    for (const key of keys) {
      const text = texts[key];
      const plan = text ? parsePlan(text) : null;
      const open = plan ? workTasks(plan).filter((t) => !t.task.done) : [];
      // Dates: the tasks' and their subtasks' own.
      const dated = [
        ...open,
        ...(plan ? datedSubtasks(plan).filter((t) => !t.task.done) : []),
      ]
        .filter((t) => t.task.due)
        .map((t) => t.task.due as string);
      const due = dated.filter((d) => daysUntil(d) <= 0).length;
      // The project's own deadline counts among its dates.
      const deadline = plan ? projectDue(plan) : undefined;
      const next = [...dated, ...(deadline ? [deadline] : [])].sort()[0];
      plans[key] = {
        open: open.length,
        due,
        next,
        deadline,
        priority: plan ? projectPriority(plan) : 0,
        done: plan ? projectDone(plan) : false,
      };
      // Papers to read by a date count with the tasks.
      const toRead = plan
        ? readingItems(plan)
            .filter((r) => r.status !== "read" && r.task.due)
            .map((r) => r.task.due as string)
        : [];
      smart.tomorrow += toRead.filter((d) => daysUntil(d) === 1).length;
      smart.week += toRead.filter((d) => daysUntil(d) <= 6).length;
      smart.today += toRead.filter((d) => daysUntil(d) <= 0).length;
      smart.today += due;
      smart.matrix += open.filter(
        (t) => !outOfMatrix(t.task) && quadrantOf(t.task) === "do",
      ).length;
      smart.tomorrow += dated.filter((d) => daysUntil(d) === 1).length;
      smart.week += dated.filter((d) => daysUntil(d) <= 6).length;
      smart.all += open.length;
      smart.reading += plan
        ? readingItems(plan).filter(
            (r) => r.status === "to-read" || r.status === "reading",
          ).length
        : 0;
    }
    return { plans, smart };
  }, [keys, texts]);

  const inbox = lists.find((l) => l.key === INBOX);
  const ownLists = lists.filter((l) => l.personal);
  const projects = useMemo(() => {
    const p = lists.filter((l) => isProjectKey(l.key));
    return p.sort((a, b) => {
      if (sort === "priority") {
        const d =
          (stats.plans[b.key]?.priority ?? 0) -
          (stats.plans[a.key]?.priority ?? 0);
        if (d) return d;
        return (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
      }
      if (sort === "name" || sort === "type")
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      if (sort === "count") {
        return (
          (stats.plans[b.key]?.open ?? 0) - (stats.plans[a.key]?.open ?? 0)
        );
      }
      if (sort === "due") {
        return (stats.plans[a.key]?.next ?? "9999").localeCompare(
          stats.plans[b.key]?.next ?? "9999",
        );
      }
      return (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
    });
  }, [lists, sort, stats]);

  const current: PlanList | undefined =
    "plan" in selected ? lists.find((l) => l.key === selected.plan) : undefined;
  // The calendar and boards take the whole width.
  const fullBleed =
    ("smart" in selected &&
      (selected.smart === "calendar" ||
        selected.smart === "matrix" ||
        selected.smart === "overview")) ||
    (!!current && mode === "board" && tab !== "timeline");
  const choose = (s: Selection) => {
    select(s);
    setPicked(null);
  };

  const header = (() => {
    if ("smart" in selected) {
      const { color, icon } = SMART[selected.smart];
      const count = stats.smart[selected.smart];
      return {
        title: SMART_LABEL[selected.smart],
        color,
        icon,
        sub:
          selected.smart === "today"
            ? new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : selected.smart === "calendar"
              ? "Every project's dates in one place"
              : selected.smart === "matrix"
                ? "High-priority tasks are important; tasks due in less than five days are urgent"
                : selected.smart === "overview"
                  ? "Every list and project, section by section"
                  : selected.smart === "completed"
                    ? "What you've finished, most recent first"
                    : `${count} ${selected.smart === "reading" ? "to read" : count === 1 ? "task" : "tasks"}`,
      };
    }
    if (!current) return { title: "", color: "#64748b", icon: null, sub: "" };
    const s = stats.plans[current.key];
    return {
      title: current.key === INBOX ? "Inbox" : current.name,
      color:
        current.key === INBOX
          ? INBOX_COLOR
          : current.personal
            ? listColor(current)
            : typeColor(current.type),
      icon:
        current.key === INBOX ? (
          <InboxIcon className="size-4" />
        ) : (
          <ProjectIcon list={current} className="size-4" />
        ),
      sub: [
        current.type,
        `${s?.open ?? 0} open`,
        s?.due ? `${s.due} due` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  })();

  return (
    <PlannerDnd>
      <div className="flex h-full min-h-0 bg-background">
        <aside className="flex w-60 shrink-0 flex-col border-border border-r bg-sidebar pt-[var(--titlebar-height)]">
          <nav className="flex flex-col gap-0.5 p-2 pt-3" aria-label="Lists">
            {/* Every day: what's due, and what you're reading. */}
            {(["today", "tomorrow", "week", "reading"] as SmartFilter[]).map(
              (f) => (
                <SmartItem
                  key={f}
                  filter={f}
                  count={stats.smart[f]}
                  active={"smart" in selected && selected.smart === f}
                  onClick={() => choose({ smart: f })}
                  onDrop={
                    f === "today"
                      ? (d) => dueOn(d, 0)
                      : f === "tomorrow"
                        ? (d) => dueOn(d, 1)
                        : undefined
                  }
                />
              ),
            )}
            <SideHeading>Lists</SideHeading>
            {inbox && (
              <SideItem
                icon={<InboxIcon className="size-4" />}
                color={INBOX_COLOR}
                label="Inbox"
                count={stats.plans[INBOX]?.open}
                active={"plan" in selected && selected.plan === INBOX}
                onClick={() => choose({ plan: INBOX })}
                dropId="side:inbox"
                onDrop={(d) => moveToPlan(d, inbox)}
              />
            )}
            {ownLists.map((l) => (
              <SideItem
                key={l.key}
                icon={<ProjectIcon list={l} className="size-4" />}
                label={l.name}
                count={stats.plans[l.key]?.open}
                alert={(stats.plans[l.key]?.due ?? 0) > 0}
                active={"plan" in selected && selected.plan === l.key}
                onClick={() => choose({ plan: l.key })}
                dropId={`side:${l.key}`}
                onDrop={(d) => moveToPlan(d, l)}
                menu={<OwnListMenu list={l} />}
              />
            ))}
            <NewList onMade={(key) => choose({ plan: key })} />
            <SideHeading>Views</SideHeading>
            {(
              [
                "calendar",
                "matrix",
                "overview",
                "all",
                "completed",
              ] as SmartFilter[]
            ).map((f) => (
              <SmartItem
                key={f}
                filter={f}
                count={
                  f === "completed" || f === "overview" || f === "calendar"
                    ? undefined
                    : stats.smart[f]
                }
                active={"smart" in selected && selected.smart === f}
                onClick={() => choose({ smart: f })}
                onDrop={f === "completed" ? completeDrag : undefined}
              />
            ))}
          </nav>
          <div className="flex items-center px-4 pt-3 pb-1">
            <span className="flex-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
              Projects
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={`Sort: ${SORT_LABEL[sort]}`}
                  aria-label="Sort projects"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                >
                  <ArrowUpDownIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Sort projects by
                </DropdownMenuLabel>
                {(Object.keys(SORT_LABEL) as ProjectSort[]).map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => setSort(s)}>
                    {sort === s ? (
                      <CheckIcon className="size-3.5" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    {SORT_LABEL[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {projects.length > 5 && (
            <div className="px-2 pb-1.5">
              <div className="flex h-7 items-center gap-1.5 rounded-md bg-sidebar-accent/60 px-2 focus-within:ring-1 focus-within:ring-ring">
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setProjectQuery("")}
                  placeholder="Find a project"
                  aria-label="Find a project"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          )}
          <nav
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
            aria-label="Projects"
          >
            {projectQuery.trim() &&
              !projects.some((p) =>
                `${p.name} ${p.type ?? ""}`
                  .toLowerCase()
                  .includes(projectQuery.trim().toLowerCase().split(/\s+/)[0]),
              ) && (
                <p className="px-2 text-muted-foreground text-xs">
                  No project matches.
                </p>
              )}
            {projects.length === 0 && (
              <p className="px-2 text-muted-foreground text-xs">
                Your projects show here once you've opened them.
              </p>
            )}
            {(projectQuery.trim()
              ? [
                  {
                    key: "found",
                    title: null,
                    items: projects.filter((p) => {
                      const words = projectQuery
                        .toLowerCase()
                        .split(/\s+/)
                        .filter(Boolean);
                      const text = `${p.name} ${p.type ?? ""}`.toLowerCase();
                      return words.every((w) => text.includes(w));
                    }),
                  } as ProjectGroup,
                ]
              : groupProjects(projects, sort, stats.plans)
            ).map((g) => (
              <ProjectGroupBlock
                key={`${sort}:${g.key}`}
                group={g}
                folded={folded.includes(`${sort}:${g.key}`)}
                onFold={() => {
                  const id = `${sort}:${g.key}`;
                  setFolded(
                    folded.includes(id)
                      ? folded.filter((f) => f !== id)
                      : [...folded, id],
                  );
                }}
              >
                {g.items.map((p) => (
                  <SideItem
                    key={p.key}
                    icon={<ProjectIcon list={p} className="size-4" />}
                    label={p.name}
                    count={stats.plans[p.key]?.open}
                    deadline={stats.plans[p.key]?.deadline}
                    priority={
                      stats.plans[p.key]?.done
                        ? undefined
                        : stats.plans[p.key]?.priority
                    }
                    alert={(stats.plans[p.key]?.due ?? 0) > 0}
                    active={"plan" in selected && selected.plan === p.key}
                    onClick={() => choose({ plan: p.key })}
                    dropId={`side:${p.key}`}
                    onDrop={(d) => moveToPlan(d, p)}
                    menu={
                      p.root ? (
                        <>
                          <ContextMenuItem
                            onClick={() => void openInEditor(p.root as string)}
                          >
                            <SquarePenIcon className="size-3.5" />
                            Open project
                          </ContextMenuItem>
                          <ProjectPriorityMenu root={p.root} name={p.name} />
                        </>
                      ) : undefined
                    }
                  />
                ))}
              </ProjectGroupBlock>
            ))}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-border/70 border-b px-6 pt-[calc(var(--titlebar-height)+12px)] pb-3">
            {header.icon && (
              <span
                className="flex size-9 items-center justify-center rounded-xl"
                style={{
                  color: header.color,
                  backgroundColor: `color-mix(in srgb, ${header.color} 14%, transparent)`,
                }}
              >
                {header.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold text-lg leading-tight">
                {header.title}
              </h1>
              {header.sub && (
                <p className="truncate text-muted-foreground text-xs">
                  {header.sub}
                </p>
              )}
            </div>
            {current && isProjectKey(current.key) && (
              <PriorityMenu
                priority={stats.plans[current.key]?.priority ?? 0}
                onChange={(p) =>
                  void editPlan(current, (plan) => setProjectPriority(plan, p))
                }
                done={stats.plans[current.key]?.done}
                onDone={(d) =>
                  void editPlan(current, (plan) => setProjectDone(plan, d))
                }
              />
            )}
            {current && isProjectKey(current.key) && (
              <DueButton
                label="Deadline"
                due={stats.plans[current.key]?.deadline}
                onChange={(due) =>
                  void editPlan(current, (p) => setProjectDue(p, due))
                }
              />
            )}
            {current && (
              <>
                <Segmented
                  label="Show"
                  value={tab}
                  onChange={(t) => {
                    setTab(t);
                    setPicked(null);
                  }}
                  options={[
                    [
                      "tasks",
                      <ListTodoIcon key="t" className="size-3.5" />,
                      "Tasks",
                    ],
                    // The Inbox is for tasks; general reading has its place.
                    ...(current.key === INBOX
                      ? []
                      : ([
                          [
                            "reading",
                            <BookOpenIcon key="r" className="size-3.5" />,
                            "Reading",
                          ],
                        ] as [Tab, ReactNode, string][])),
                    ...(!isProjectKey(current.key)
                      ? []
                      : ([
                          [
                            "timeline",
                            <MilestoneIcon key="m" className="size-3.5" />,
                            "Timeline",
                          ],
                        ] as [Tab, ReactNode, string][])),
                  ]}
                />
                {tab !== "timeline" && (
                  <Segmented
                    label="View"
                    value={mode}
                    onChange={setMode}
                    options={[
                      [
                        "list",
                        <ListIcon key="l" className="size-3.5" />,
                        "List",
                      ],
                      [
                        "board",
                        <KanbanIcon key="b" className="size-3.5" />,
                        "Board",
                      ],
                    ]}
                  />
                )}
              </>
            )}
          </header>
          <div className="flex min-h-0 flex-1">
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1",
                fullBleed ? "overflow-hidden" : "overflow-y-auto",
              )}
            >
              <div className={cn(fullBleed ? "h-full" : "mx-auto max-w-3xl")}>
                {"smart" in selected && selected.smart === "calendar" ? (
                  <CalendarView lists={withReading} />
                ) : "smart" in selected && selected.smart === "overview" ? (
                  <OverviewView
                    lists={lists}
                    onOpen={(l) => choose({ plan: l.key })}
                  />
                ) : "smart" in selected && selected.smart === "matrix" ? (
                  <MatrixView
                    lists={lists}
                    selected={picked}
                    onSelect={setPicked}
                  />
                ) : "smart" in selected ? (
                  <SmartView
                    filter={selected.smart}
                    lists={withReading}
                    onOpenPlan={(l) => choose({ plan: l.key })}
                    selected={picked}
                    onSelect={setPicked}
                  />
                ) : !current ? (
                  <p className="p-6 text-muted-foreground text-sm">
                    That list isn't here any more.
                  </p>
                ) : tab === "timeline" && isProjectKey(current.key) ? (
                  <TimelineView key={current.key} list={current} />
                ) : tab === "reading" ? (
                  <ReadingView key={current.key} list={current} mode={mode} />
                ) : (
                  <PlanView
                    key={current.key}
                    list={current}
                    mode={mode}
                    selected={picked}
                    onSelect={setPicked}
                  />
                )}
              </div>
            </div>
            {picked && (
              <aside className="w-[360px] shrink-0 border-border border-l">
                <DetailPane
                  selected={picked}
                  onClose={() => setPicked(null)}
                  onOpen={setPicked}
                />
              </aside>
            )}
          </div>
        </main>
      </div>
    </PlannerDnd>
  );
}

/** The picked task's details, beside the list; closes if it's gone. */
function DetailPane({
  selected,
  onClose,
  onOpen,
}: {
  selected: Selected;
  onClose: () => void;
  /** Opens another task here: a subtask, or the task it's under. */
  onOpen: (s: Selected) => void;
}) {
  const text = usePlanText(selected.list.key);
  const plan = text ? parsePlan(text) : null;
  const task = plan ? taskAt(plan, selected.ref) : undefined;
  if (!plan || !task) {
    return (
      <p className="p-6 text-muted-foreground text-sm">
        Pick a task to see its details.
      </p>
    );
  }
  const ctx = contextOf(selected.list);
  return (
    <TaskDetails
      key={`${selected.list.key}-${selected.ref.section}-${selected.ref.item}-${(selected.ref.path ?? []).join(".")}`}
      task={task}
      onOpenSub={(i) => onOpen({ ...selected, ref: childRef(selected.ref, i) })}
      parent={
        selected.ref.path?.length
          ? (() => {
              const up = {
                ...selected.ref,
                path: selected.ref.path.slice(0, -1),
              };
              const t = taskAt(plan, up);
              return t
                ? {
                    title: t.title,
                    open: () => onOpen({ ...selected, ref: up }),
                  }
                : undefined;
            })()
          : undefined
      }
      actions={{
        ...actionsFor(selected.list, selected.ref, plan),
        remove: () => {
          actionsFor(selected.list, selected.ref, plan).remove();
          onClose();
        },
      }}
      onClose={onClose}
      footer={
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {ctx.icon}
          <span className="truncate">{ctx.name}</span>
        </span>
      }
    />
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, ReactNode, string][];
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg bg-muted p-0.5"
      role="radiogroup"
      aria-label={label}
    >
      {options.map(([v, icon, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
            value === v
              ? "bg-background font-medium text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {icon}
          {text}
        </button>
      ))}
    </div>
  );
}

function SmartItem({
  filter,
  count,
  active,
  onClick,
  onDrop,
}: {
  filter: SmartFilter;
  count?: number;
  active: boolean;
  onClick: () => void;
  onDrop?: (d: DragTask) => void;
}) {
  return (
    <SideItem
      icon={SMART[filter].icon}
      color={SMART[filter].color}
      label={SMART_LABEL[filter]}
      count={count}
      active={active}
      onClick={onClick}
      dropId={onDrop ? `side:${filter}` : undefined}
      onDrop={onDrop}
    />
  );
}

function SideItem({
  icon,
  color,
  label,
  count,
  deadline,
  alert,
  active,
  onClick,
  dropId,
  onDrop,
  menu,
  priority,
}: {
  /** A project's priority: a small flag, when it has one. */
  priority?: Priority;
  /** Its right-click menu. */
  menu?: ReactNode;
  icon: ReactNode;
  /** The icon's color (projects color theirs by type). */
  color?: string;
  label: string;
  count?: number;
  /** The project's own deadline. */
  deadline?: string;
  /** Something in it is due today or overdue. */
  alert?: boolean;
  active: boolean;
  onClick: () => void;
  dropId?: string;
  onDrop?: (d: DragTask) => void;
}) {
  const drop = useDropArea(dropId ?? `side:none:${label}`, {
    accepts: "any",
    onDrop: (d) => onDrop?.(d),
  });
  const over = !!onDrop && drop.over;
  const row = (
    <button
      ref={onDrop ? drop.ref : undefined}
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors",
        active || over
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
        active && "font-medium",
      )}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        style={color ? { color } : undefined}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!priority && (
        <FlagIcon
          className="size-3 shrink-0"
          style={{ color: PRIORITY_COLOR[priority] }}
          fill={PRIORITY_COLOR[priority]}
          aria-label={`${PRIORITY_LABEL[priority]} priority`}
        />
      )}
      {deadline && <DueBadge due={deadline} />}
      {alert && (
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
      )}
      {!!count && (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
  if (!menu) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

/** Opens a project in the writing view. */
async function openInEditor(root: string) {
  await goToProject(root);
  useBack.getState().set("Back to Planner", backToPlanner);
}

const LIST_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

/** A list of one's own, right-clicked: its color, or out of the Planner. */
function OwnListMenu({ list }: { list: PlanList }) {
  const file = list.key.slice("list:".length);
  return (
    <>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {LIST_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label="Color"
            onClick={() => useOwnLists.getState().setColor(file, c)}
            className={cn(
              "size-4 rounded-full ring-offset-1 ring-offset-popover hover:ring-2 hover:ring-ring",
              listColor(list) === c && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <ContextMenuItem
        variant="destructive"
        onClick={() => useOwnLists.getState().remove(file)}
      >
        <Trash2Icon className="size-3.5" />
        Remove from Planner
      </ContextMenuItem>
    </>
  );
}

/** "New list": a name, then the list, empty and picked. */
function NewList({ onMade }: { onMade: (key: string) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  if (!naming) {
    return (
      <button
        type="button"
        onClick={() => setNaming(true)}
        className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-muted-foreground text-sm hover:bg-sidebar-accent/50 hover:text-foreground"
      >
        <PlusIcon className="size-4" />
        New list
      </button>
    );
  }
  const done = () => {
    const key = name.trim() ? useOwnLists.getState().add(name) : null;
    setNaming(false);
    setName("");
    if (key) onMade(key);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        done();
      }}
      className="flex h-8 items-center gap-2.5 rounded-md bg-sidebar-accent/60 px-2"
    >
      <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        // biome-ignore lint/a11y/noAutofocus: just asked for
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setName("");
            setNaming(false);
          }
        }}
        placeholder="Teaching, Admin…"
        aria-label="List name"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}

/** A small heading in the Planner's sidebar. */
function SideHeading({ children }: { children: ReactNode }) {
  return (
    <span className="px-2 pt-3 pb-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
      {children}
    </span>
  );
}
