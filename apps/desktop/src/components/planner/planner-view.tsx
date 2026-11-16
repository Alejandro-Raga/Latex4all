import { useMemo, useState } from "react";
import {
  CalendarDaysIcon,
  CalendarIcon,
  InboxIcon,
  KanbanIcon,
  ListIcon,
  ListTodoIcon,
  type LucideIcon,
  NotebookPenIcon,
} from "lucide-react";
import { daysUntil } from "@/lib/plan/dates";
import { allTasks, parsePlan } from "@/lib/plan/plan-file";
import {
  INBOX,
  type PlanKey,
  type PlanList,
  usePlanLists,
  usePlanTexts,
  useReloadPlans,
} from "@/lib/plan/plan-store";
import { cn } from "@/lib/utils";
import {
  PlanView,
  type PlanViewMode,
  SMART_LABEL,
  type SmartFilter,
  SmartView,
} from "./plan-views";

type Selection = { smart: SmartFilter } | { plan: PlanKey };

const SMART_ICON: Record<SmartFilter, LucideIcon> = {
  today: CalendarIcon,
  week: CalendarDaysIcon,
  all: ListTodoIcon,
};

const VIEW_KEY = "planner-view";

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The Planner: every project's tasks and the Inbox, with Today and the next
 * seven days gathered from all of them, as a list or a board.
 */
export function PlannerView() {
  const lists = usePlanLists();
  const keys = useMemo(() => lists.map((l) => l.key), [lists]);
  useReloadPlans(keys);
  const texts = usePlanTexts(keys);
  const [selected, setSelectedState] = useState<Selection>(() =>
    load<Selection>(`${VIEW_KEY}-selected`, { smart: "today" }),
  );
  const [mode, setModeState] = useState<PlanViewMode>(() =>
    load<PlanViewMode>(`${VIEW_KEY}-mode`, "list"),
  );
  const remember = (key: string, value: unknown) => {
    try {
      localStorage.setItem(`${VIEW_KEY}-${key}`, JSON.stringify(value));
    } catch {
      // For this session only.
    }
  };
  const select = (s: Selection) => {
    setSelectedState(s);
    remember("selected", s);
  };
  const setMode = (m: PlanViewMode) => {
    setModeState(m);
    remember("mode", m);
  };

  // Open tasks per plan, and how many are due today or before.
  const counts = useMemo(() => {
    const out: Record<PlanKey, { open: number; due: number }> = {};
    let today = 0;
    let week = 0;
    let all = 0;
    for (const key of keys) {
      const text = texts[key];
      const tasks = text
        ? allTasks(parsePlan(text)).filter((t) => !t.task.done)
        : [];
      const due = tasks.filter((t) => t.task.due && daysUntil(t.task.due) <= 0);
      out[key] = { open: tasks.length, due: due.length };
      today += due.length;
      week += tasks.filter(
        (t) => t.task.due && daysUntil(t.task.due) <= 6,
      ).length;
      all += tasks.length;
    }
    return {
      plans: out,
      smart: { today, week, all } as Record<SmartFilter, number>,
    };
  }, [keys, texts]);

  const current: PlanList | undefined =
    "plan" in selected ? lists.find((l) => l.key === selected.plan) : undefined;
  const title =
    "smart" in selected ? SMART_LABEL[selected.smart] : current?.name;
  const projects = lists.filter((l) => l.key !== INBOX);

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-border border-r bg-sidebar pt-[var(--titlebar-height)]">
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Lists">
          {(Object.keys(SMART_LABEL) as SmartFilter[]).map((f) => (
            <SideItem
              key={f}
              icon={SMART_ICON[f]}
              label={SMART_LABEL[f]}
              count={counts.smart[f]}
              active={"smart" in selected && selected.smart === f}
              onClick={() => select({ smart: f })}
            />
          ))}
          <SideItem
            icon={InboxIcon}
            label="Inbox"
            count={counts.plans[INBOX]?.open}
            active={"plan" in selected && selected.plan === INBOX}
            onClick={() => select({ plan: INBOX })}
          />
        </nav>
        <p className="px-4 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Projects
        </p>
        <nav
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
          aria-label="Projects"
        >
          {projects.length === 0 && (
            <p className="px-2 text-muted-foreground text-xs">
              Your projects show here once you've opened them.
            </p>
          )}
          {projects.map((p) => (
            <SideItem
              key={p.key}
              icon={NotebookPenIcon}
              label={p.name}
              count={counts.plans[p.key]?.open}
              alert={(counts.plans[p.key]?.due ?? 0) > 0}
              active={"plan" in selected && selected.plan === p.key}
              onClick={() => select({ plan: p.key })}
            />
          ))}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[calc(48px+var(--titlebar-height))] shrink-0 items-center gap-3 border-border/70 border-b px-5 pt-[var(--titlebar-height)]">
          <h1 className="truncate font-semibold text-lg leading-none">
            {title}
          </h1>
          {current && (
            <div
              className="ml-auto inline-flex rounded-md border border-border p-0.5"
              role="radiogroup"
              aria-label="View"
            >
              {(
                [
                  ["list", ListIcon, "List"],
                  ["board", KanbanIcon, "Board"],
                ] as const
              ).map(([m, Icon, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded px-2 text-xs",
                    mode === m
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>
        <div
          className={cn(
            "min-h-0 flex-1",
            current && mode === "board" ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          <div
            className={cn(
              !(current && mode === "board") && "mx-auto max-w-3xl",
            )}
          >
            {"smart" in selected ? (
              <SmartView filter={selected.smart} lists={lists} />
            ) : current ? (
              <PlanView key={current.key} list={current} mode={mode} />
            ) : (
              <p className="p-6 text-muted-foreground text-sm">
                That list isn't here any more.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SideItem({
  icon: Icon,
  label,
  count,
  alert,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  /** Something in it is due today or overdue. */
  alert?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {alert && <span className="size-1.5 shrink-0 rounded-full bg-red-500" />}
      {!!count && (
        <span className="shrink-0 text-xs tabular-nums opacity-70">
          {count}
        </span>
      )}
    </button>
  );
}
