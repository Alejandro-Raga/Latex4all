/**
 * Everything at a glance: each list and project as a card, its sections
 * with how much is open in them and what's next.
 */
import { daysUntil } from "@/lib/plan/dates";
import {
  parsePlan,
  projectDue,
  projectPriority,
  sectionName,
} from "@/lib/plan/plan-file";
import {
  isProjectKey,
  type PlanList,
  usePlanTexts,
} from "@/lib/plan/plan-store";
import { workTasks } from "@/lib/plan/reading";
import { cn } from "@/lib/utils";
import { ProjectIcon } from "./project-icon";
import { DueBadge, PRIORITY_COLOR, TitleText } from "./task-parts";
import { FlagIcon } from "lucide-react";

const SHOWN = 3;

export function OverviewView({
  lists,
  onOpen,
}: {
  lists: PlanList[];
  onOpen: (list: PlanList) => void;
}) {
  const texts = usePlanTexts(lists.map((l) => l.key));
  const cards = lists.flatMap((list) => {
    const text = texts[list.key];
    if (!text) return [];
    const plan = parsePlan(text);
    const open = workTasks(plan).filter((t) => !t.task.done);
    if (open.length === 0 && isProjectKey(list.key)) return [];
    const bySection = new Map<number, typeof open>();
    for (const t of open) {
      bySection.set(t.ref.section, [
        ...(bySection.get(t.ref.section) ?? []),
        t,
      ]);
    }
    const sections = [...bySection.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, tasks]) => ({
        title: plan.sections[index].title,
        tasks: tasks.sort((a, b) =>
          (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999"),
        ),
      }));
    const due = isProjectKey(list.key) ? projectDue(plan) : undefined;
    const priority = isProjectKey(list.key) ? projectPriority(plan) : 0;
    const late = open.filter(
      (t) => t.task.due && daysUntil(t.task.due) < 0,
    ).length;
    return [{ list, sections, count: open.length, due, priority, late }];
  });
  if (cards.length === 0) {
    return (
      <p className="p-6 text-muted-foreground text-sm">
        Nothing open anywhere.
      </p>
    );
  }
  return (
    <div className="grid gap-3 p-5 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
      {cards.map((c) => (
        <section
          key={c.list.key}
          className="flex min-w-0 flex-col rounded-xl border border-border bg-card"
        >
          <button
            type="button"
            onClick={() => onOpen(c.list)}
            className="flex items-center gap-2 border-border border-b px-3 py-2.5 text-left hover:bg-muted/50"
          >
            <ProjectIcon list={c.list} className="size-4" />
            <span className="min-w-0 flex-1 truncate font-semibold text-sm">
              {c.list.name}
            </span>
            {!!c.priority && (
              <FlagIcon
                className="size-3 shrink-0"
                style={{ color: PRIORITY_COLOR[c.priority] }}
                fill={PRIORITY_COLOR[c.priority]}
              />
            )}
            {c.due && <DueBadge due={c.due} />}
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                c.late ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {c.count}
            </span>
          </button>
          <div className="space-y-2.5 px-3 py-2.5">
            {c.sections.length === 0 && (
              <p className="text-muted-foreground text-xs">Nothing open.</p>
            )}
            {c.sections.map((s) => (
              <div key={s.title ?? ""} className="min-w-0">
                {(c.sections.length > 1 || s.title) && (
                  <p className="mb-0.5 flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                    <span className="truncate">
                      {s.title ? sectionName(s.title) : "No section"}
                    </span>
                    <span className="tabular-nums">{s.tasks.length}</span>
                  </p>
                )}
                {s.tasks.slice(0, SHOWN).map((t) => (
                  <p
                    key={`${t.ref.section}-${t.ref.item}`}
                    className="flex min-w-0 items-center gap-2 py-0.5 text-sm"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span className="min-w-0 flex-1 truncate">
                      <TitleText title={t.task.title} />
                    </span>
                    {t.task.due && <DueBadge due={t.task.due} />}
                  </p>
                ))}
                {s.tasks.length > SHOWN && (
                  <p className="pl-3.5 text-muted-foreground text-xs">
                    {s.tasks.length - SHOWN} more
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
