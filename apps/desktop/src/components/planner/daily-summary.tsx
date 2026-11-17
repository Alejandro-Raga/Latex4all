import { useEffect } from "react";
import { toast } from "sonner";
import { calendarEntries } from "@/lib/plan/calendar";
import { daysUntil } from "@/lib/plan/dates";
import { parsePlan, today } from "@/lib/plan/plan-file";
import {
  INBOX,
  listKey,
  useOwnLists,
  planTextNow,
  projectKey,
  usePlanStore,
  usePlannerRequest,
} from "@/lib/plan/plan-store";
import { useDocumentStore } from "@/stores/document-store";
import { useNav } from "@/stores/nav-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

const SEEN = "planner-summary-day";

/** What the day holds, in a line: "2 tasks due today, 1 overdue · …". */
export async function daySummary(): Promise<string | null> {
  const lists = [
    { key: INBOX, name: "Inbox", project: false },
    ...useOwnLists.getState().lists.map((l) => ({
      key: listKey(l.file),
      name: l.file,
      project: false,
    })),
    ...useProjectStore.getState().recentProjects.map((p) => ({
      key: projectKey(p.path),
      name: p.name,
      project: true,
    })),
  ];
  const plans = [];
  for (const l of lists) {
    if (planTextNow(l.key) === undefined) {
      await usePlanStore
        .getState()
        .load(l.key)
        .catch(() => {});
    }
    const text = planTextNow(l.key);
    if (text) plans.push({ ...l, plan: parsePlan(text) });
  }
  const open = calendarEntries(plans).filter((e) => !e.done);
  const tasks = open.filter((e) => e.kind === "task");
  const overdue = tasks.filter((e) => daysUntil(e.date) < 0).length;
  const dueToday = tasks.filter((e) => daysUntil(e.date) === 0).length;
  const papers = open.filter(
    (e) => e.kind === "reading" && daysUntil(e.date) <= 0,
  ).length;
  const dates = open
    .filter(
      (e) =>
        (e.kind === "milestone" || e.kind === "deadline") &&
        daysUntil(e.date) >= 0 &&
        daysUntil(e.date) <= 1,
    )
    .map((e) =>
      e.kind === "deadline"
        ? `${e.listName} is due ${daysUntil(e.date) === 0 ? "today" : "tomorrow"}`
        : `${e.title} (${e.listName}) ${daysUntil(e.date) === 0 ? "today" : "tomorrow"}`,
    );
  const parts = [
    dueToday
      ? `${dueToday} ${dueToday === 1 ? "task" : "tasks"} due today`
      : "",
    overdue ? `${overdue} overdue` : "",
    papers
      ? `${papers} ${papers === 1 ? "paper" : "papers"} to finish reading`
      : "",
    ...dates,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The first time the app opens each day: what's due, overdue, and the
 * milestones and deadlines today or tomorrow, with a way into the Planner.
 */
export function DailySummary() {
  const on = useSettingsStore((s) => s.dailySummary);
  useEffect(() => {
    if (!on) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN);
    } catch {
      // Shown, then.
    }
    if (seen === today()) return;
    const timer = setTimeout(async () => {
      const text = await daySummary().catch(() => null);
      try {
        localStorage.setItem(SEEN, today());
      } catch {
        // Once more next time, then.
      }
      if (!text) return;
      toast(text, {
        duration: 15_000,
        action: {
          label: "Open Planner",
          onClick: () => {
            // The Planner itself, the project (if one is open) kept open.
            if (useDocumentStore.getState().projectRoot) {
              useNav.getState().goHome("planner");
            } else {
              usePlannerRequest.getState().ask();
            }
          },
        },
      });
    }, 4000);
    return () => clearTimeout(timer);
  }, [on]);
  return null;
}
