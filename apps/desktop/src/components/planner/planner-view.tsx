import { type ReactNode, useMemo, useState } from "react";
import {
  ArrowUpDownIcon,
  BookOpenIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  InboxIcon,
  KanbanIcon,
  LayersIcon,
  ListIcon,
  ListTodoIcon,
  SunIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daysUntil } from "@/lib/plan/dates";
import { parsePlan, taskAt } from "@/lib/plan/plan-file";
import {
  INBOX,
  type PlanKey,
  type PlanList,
  usePlanLists,
  usePlanText,
  usePlanTexts,
  useReloadPlans,
} from "@/lib/plan/plan-store";
import { readingItems, workTasks } from "@/lib/plan/reading";
import { cn } from "@/lib/utils";
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
import { ProjectIcon, typeColor } from "./project-icon";
import { TaskDetails } from "./task-parts";

type Selection = { smart: SmartFilter } | { plan: PlanKey };
type Tab = "tasks" | "reading";
type ProjectSort = "recent" | "type" | "due" | "count" | "name";

const SORT_LABEL: Record<ProjectSort, string> = {
  recent: "Recently opened",
  type: "Type",
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
function groupProjects(
  projects: PlanList[],
  sort: ProjectSort,
  stats: Record<PlanKey, { open: number; due: number; next?: string }>,
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
  const keys = useMemo(() => lists.map((l) => l.key), [lists]);
  useReloadPlans(keys);
  const texts = usePlanTexts(keys);
  const [selected, select] = useStored<Selection>("selected", {
    smart: "today",
  });
  // List or board, chosen apart for tasks and for reading.
  const [taskMode, setTaskMode] = useStored<PlanViewMode>("mode-tasks", "list");
  const [readMode, setReadMode] = useStored<PlanViewMode>(
    "mode-reading",
    "list",
  );
  const [tab, setTab] = useStored<Tab>("tab", "tasks");
  const mode = tab === "reading" ? readMode : taskMode;
  const setMode = tab === "reading" ? setReadMode : setTaskMode;
  const [sort, setSort] = useStored<ProjectSort>("sort", "recent");
  // Groups of projects folded away, per order ("recent:earlier").
  const [folded, setFolded] = useStored<string[]>("folded", []);
  const [picked, setPicked] = useState<Selected | null>(null);

  // Per plan: open tasks, due today or before, the soonest date.
  const stats = useMemo(() => {
    const plans: Record<PlanKey, { open: number; due: number; next?: string }> =
      {};
    const smart: Record<SmartFilter, number> = {
      today: 0,
      tomorrow: 0,
      week: 0,
      reading: 0,
      all: 0,
      completed: 0,
    };
    for (const key of keys) {
      const text = texts[key];
      const plan = text ? parsePlan(text) : null;
      const open = plan ? workTasks(plan).filter((t) => !t.task.done) : [];
      const dated = open
        .filter((t) => t.task.due)
        .map((t) => t.task.due as string);
      const due = dated.filter((d) => daysUntil(d) <= 0).length;
      plans[key] = { open: open.length, due, next: dated.sort()[0] };
      smart.today += due;
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
  const projects = useMemo(() => {
    const p = lists.filter((l) => l.key !== INBOX);
    return p.sort((a, b) => {
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
            : selected.smart === "completed"
              ? "What you've finished, most recent first"
              : `${count} ${selected.smart === "reading" ? "to read" : count === 1 ? "task" : "tasks"}`,
      };
    }
    if (!current) return { title: "", color: "#64748b", icon: null, sub: "" };
    const s = stats.plans[current.key];
    return {
      title: current.key === INBOX ? "Inbox" : current.name,
      color: current.key === INBOX ? INBOX_COLOR : typeColor(current.type),
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
            {(["today", "tomorrow", "week"] as SmartFilter[]).map((f) => (
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
            ))}
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
            <span className="my-1.5 h-px bg-border" />
            {(["reading", "all", "completed"] as SmartFilter[]).map((f) => (
              <SmartItem
                key={f}
                filter={f}
                count={f === "completed" ? undefined : stats.smart[f]}
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
          <nav
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
            aria-label="Projects"
          >
            {projects.length === 0 && (
              <p className="px-2 text-muted-foreground text-xs">
                Your projects show here once you've opened them.
              </p>
            )}
            {groupProjects(projects, sort, stats.plans).map((g) => (
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
                    alert={(stats.plans[p.key]?.due ?? 0) > 0}
                    active={"plan" in selected && selected.plan === p.key}
                    onClick={() => choose({ plan: p.key })}
                    dropId={`side:${p.key}`}
                    onDrop={(d) => moveToPlan(d, p)}
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
                    [
                      "reading",
                      <BookOpenIcon key="r" className="size-3.5" />,
                      "Reading",
                    ],
                  ]}
                />
                <Segmented
                  label="View"
                  value={mode}
                  onChange={setMode}
                  options={[
                    ["list", <ListIcon key="l" className="size-3.5" />, "List"],
                    [
                      "board",
                      <KanbanIcon key="b" className="size-3.5" />,
                      "Board",
                    ],
                  ]}
                />
              </>
            )}
          </header>
          <div className="flex min-h-0 flex-1">
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1",
                current && mode === "board"
                  ? "overflow-hidden"
                  : "overflow-y-auto",
              )}
            >
              <div
                className={cn(
                  !(current && mode === "board") && "mx-auto max-w-3xl",
                )}
              >
                {"smart" in selected ? (
                  <SmartView
                    filter={selected.smart}
                    lists={lists}
                    selected={picked}
                    onSelect={setPicked}
                  />
                ) : !current ? (
                  <p className="p-6 text-muted-foreground text-sm">
                    That list isn't here any more.
                  </p>
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
                <DetailPane selected={picked} onClose={() => setPicked(null)} />
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
}: {
  selected: Selected;
  onClose: () => void;
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
      key={`${selected.list.key}-${selected.ref.section}-${selected.ref.item}`}
      task={task}
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
  alert,
  active,
  onClick,
  dropId,
  onDrop,
}: {
  icon: ReactNode;
  /** The icon's color (projects color theirs by type). */
  color?: string;
  label: string;
  count?: number;
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
  return (
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
}
