/** How a due date reads in a list: "Today", "Tomorrow", "Fri", "20 Nov". */
import { today } from "./plan-file";

export type DueTone = "overdue" | "today" | "soon" | "later";

const DAY = 86_400_000;

const asDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Days from today to `iso`: negative when past. */
export function daysUntil(iso: string, now = new Date()): number {
  const start = asDate(today(now));
  return Math.round((asDate(iso).getTime() - start.getTime()) / DAY);
}

export function dueLabel(
  iso: string,
  now = new Date(),
): { label: string; tone: DueTone } {
  const days = daysUntil(iso, now);
  const date = asDate(iso);
  const short = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  if (days < 0) {
    return { label: days === -1 ? "Yesterday" : short, tone: "overdue" };
  }
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days < 7) {
    return {
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      tone: "soon",
    };
  }
  return { label: short, tone: "later" };
}

/** The date `days` from today, as YYYY-MM-DD. */
export function dayFromToday(days: number, now = new Date()): string {
  const d = asDate(today(now));
  d.setDate(d.getDate() + days);
  return today(d);
}
