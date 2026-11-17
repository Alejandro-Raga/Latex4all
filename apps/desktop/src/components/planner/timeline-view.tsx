/**
 * A project's timeline: its milestones on the way to its deadline, on a line
 * that runs from today (or the first milestone) to the deadline, with today
 * marked; and the milestones as a list, to add, check off and change.
 */
import { useState } from "react";
import { DiamondIcon, FlagIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { daysUntil } from "@/lib/plan/dates";
import {
  addMilestone,
  type Milestone,
  milestones,
} from "@/lib/plan/milestones";
import {
  deleteTask,
  newPlanText,
  parsePlan,
  projectDue,
  setProjectDue,
  today,
  toggleTask,
  updateTask,
} from "@/lib/plan/plan-file";
import { type PlanList, usePlanText } from "@/lib/plan/plan-store";
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

/** The line: milestones placed by date between its two ends. */
function Track({ items, due }: { items: Milestone[]; due?: string }) {
  const dated = items.filter((m) => m.task.due) as (Milestone & {
    task: { due: string };
  })[];
  const now = today();
  const dates = [now, ...dated.map((m) => m.task.due), ...(due ? [due] : [])];
  const start = dates.reduce((a, b) => (a < b ? a : b));
  let end = dates.reduce((a, b) => (a > b ? a : b));
  // A month's room at least, so a near deadline isn't squashed.
  if (time(end) - time(start) < 30 * MS_DAY) {
    end = today(new Date(time(start) + 30 * MS_DAY));
  }
  const at = (iso: string) =>
    ((time(iso) - time(start)) / (time(end) - time(start))) * 100;
  const leftPct = (iso: string) => `${Math.min(97, Math.max(3, at(iso)))}%`;
  return (
    <div className="relative mx-2 mt-6 mb-10 h-20">
      {/* The line, done up to today. */}
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-primary/40"
        style={{ width: `${Math.max(0, Math.min(100, at(now)))}%` }}
      />
      {/* Today. */}
      <div
        className="absolute top-1 bottom-1 w-px bg-primary"
        style={{ left: leftPct(now) }}
      >
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1 text-[10px] text-primary-foreground">
          Today
        </span>
      </div>
      {dated.map((m, i) => (
        <div
          key={`${m.ref.item}-${m.task.title}`}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: leftPct(m.task.due) }}
          title={`${m.task.title} · ${short(m.task.due)}`}
        >
          <DiamondIcon
            className="size-4"
            style={{ color: "var(--chart-4)" }}
            fill={m.task.done ? "var(--chart-4)" : "var(--background)"}
          />
          <span
            className={cn(
              "absolute left-1/2 max-w-32 -translate-x-1/2 truncate whitespace-nowrap text-center text-[11px]",
              i % 2 === 0 ? "top-5" : "bottom-5",
              m.task.done && "text-muted-foreground line-through",
            )}
          >
            {m.task.title}
            <span className="block text-[10px] text-muted-foreground">
              {short(m.task.due)}
            </span>
          </span>
        </div>
      ))}
      {due && (
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: leftPct(due) }}
          title={`Deadline · ${short(due)}`}
        >
          <FlagIcon
            className="size-4 text-destructive"
            fill="var(--destructive)"
          />
          <span className="absolute top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-center font-medium text-[11px] text-destructive">
            Deadline
            <span className="block font-normal text-[10px] text-muted-foreground">
              {short(due)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function MilestoneRow({ list, m }: { list: PlanList; m: Milestone }) {
  const ref = m.ref;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/70">
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
            {m.task.title}
          </span>
          {m.task.due && !m.task.done && daysUntil(m.task.due) >= 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {daysUntil(m.task.due) === 0
                ? ""
                : `in ${daysUntil(m.task.due)} days`}
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
      <ContextMenuContent className="w-44">
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
          <Track items={items} due={due} />
          {(next || due) && (
            <p className="px-2 pb-2 text-muted-foreground text-xs">
              {next && (
                <>
                  Next:{" "}
                  <span className="text-foreground">{next.task.title}</span>{" "}
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
                  label="Deadline"
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
