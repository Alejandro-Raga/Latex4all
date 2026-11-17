/**
 * The open project at a glance, under its name: when it's due, the next
 * thing to do, and what you're reading for it. A click opens the Plan.
 */
import { BookOpenIcon, CircleIcon, FlagIcon } from "lucide-react";
import { daysUntil } from "@/lib/plan/dates";
import { parsePlan, projectDue } from "@/lib/plan/plan-file";
import { projectKey, usePlanText } from "@/lib/plan/plan-store";
import { readingItems, workTasks } from "@/lib/plan/reading";
import { cn } from "@/lib/utils";
import { useDockStore } from "@/stores/dock-store";
import { DueBadge, TitleText } from "@/components/planner/task-parts";

function countdown(due: string) {
  const days = daysUntil(due);
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} late`;
  if (days === 0) return "Due today";
  return `Due in ${days} ${days === 1 ? "day" : "days"}`;
}

export function ProjectStrip({ root }: { root: string }) {
  const text = usePlanText(projectKey(root));
  if (!text) return null;
  const plan = parsePlan(text);
  const due = projectDue(plan);
  const next = workTasks(plan)
    .filter((t) => !t.task.done)
    .sort((a, b) =>
      (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999"),
    )[0];
  const reading = readingItems(plan).find((r) => r.status === "reading");
  if (!due && !next && !reading) return null;
  return (
    <button
      type="button"
      onClick={() => useDockStore.getState().setOpen("plan", true)}
      title="Open the Plan"
      className="mx-2 mt-2 flex flex-col gap-1 rounded-lg border border-sidebar-border/70 px-2.5 py-2 text-left text-xs hover:bg-sidebar-accent/60"
    >
      {due && (
        <span
          className={cn(
            "flex items-center gap-1.5 font-medium",
            daysUntil(due) < 0
              ? "text-destructive"
              : daysUntil(due) <= 7
                ? "text-orange-600 dark:text-orange-400"
                : "text-foreground",
          )}
        >
          <FlagIcon className="size-3 shrink-0" />
          {countdown(due)}
        </span>
      )}
      {next && (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <CircleIcon className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">
            <TitleText title={next.task.title} />
          </span>
          {next.task.due && <DueBadge due={next.task.due} />}
        </span>
      )}
      {reading && (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <BookOpenIcon className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{reading.title}</span>
          {(reading.bookmark ?? reading.page) && (
            <span className="shrink-0 tabular-nums">
              p. {reading.bookmark ?? reading.page}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
