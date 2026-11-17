/**
 * How a task repeats, written as Obsidian's Tasks writes it after 🔁:
 * "every day", "every 2 weeks", "every week on Monday, Friday",
 * "every day until 2026-12-15". Checking one off brings the next.
 */

export type Unit = "day" | "week" | "month" | "year";

export interface Rule {
  every: number;
  unit: Unit;
  /** For weekly ones: which days, 0 Sunday to 6 Saturday. */
  days?: number[];
  /** The last day it may come back on, YYYY-MM-DD. */
  until?: string;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
};
const dateOf = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** The rule in words after 🔁, or null if it isn't one. */
export function parseRule(text: string): Rule | null {
  const m =
    /^every\s+(?:(\d+)\s+)?(day|week|month|year)s?(?:\s+on\s+([a-z ,]+?))?(?:\s+until\s+(\d{4}-\d{2}-\d{2}))?\s*$/i.exec(
      text.trim(),
    );
  if (!m) return null;
  const rule: Rule = {
    every: Math.max(1, Number(m[1] ?? 1)),
    unit: m[2].toLowerCase() as Unit,
  };
  if (m[3]) {
    const days = m[3]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((w) =>
        DAY_NAMES.findIndex((d) =>
          d.toLowerCase().startsWith(w.toLowerCase().slice(0, 3)),
        ),
      )
      .filter((d) => d >= 0);
    if (days.length) rule.days = [...new Set(days)].sort((a, b) => a - b);
  }
  if (m[4]) rule.until = m[4];
  return rule;
}

/** The rule written out, as it goes in the plan. */
export function ruleText(rule: Rule): string {
  const unit = rule.every === 1 ? rule.unit : `${rule.every} ${rule.unit}s`;
  const parts = [`every ${unit}`];
  if (rule.unit === "week" && rule.days?.length) {
    parts.push(`on ${rule.days.map((d) => DAY_NAMES[d]).join(", ")}`);
  }
  if (rule.until) parts.push(`until ${rule.until}`);
  return parts.join(" ");
}

/** The rule as a person would say it, short: "Every 2 weeks on Mon, Wed". */
export function describeRule(rule: Rule): string {
  const days = rule.days?.length
    ? rule.days.join() === "1,2,3,4,5"
      ? " on weekdays"
      : ` on ${rule.days.map((d) => SHORT[d]).join(", ")}`
    : "";
  const every =
    rule.every === 1
      ? `Every ${rule.unit}`
      : `Every ${rule.every} ${rule.unit}s`;
  const until = rule.until
    ? `, until ${dateOf(rule.until).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
    : "";
  return `${every}${rule.unit === "week" ? days : ""}${until}`;
}

/** The next day after `from`, or null once past its end. */
export function nextOccurrence(from: string, rule: Rule): string | null {
  const start = dateOf(from);
  let next: Date;
  if (rule.unit === "week" && rule.days?.length) {
    // The next of its days this week; else the first of them `every`
    // weeks on.
    const today = start.getDay();
    const later = rule.days.find((d) => d > today);
    next = new Date(start);
    if (later !== undefined) next.setDate(start.getDate() + (later - today));
    else {
      const toMonday = (today + 6) % 7;
      next.setDate(start.getDate() - toMonday + 7 * rule.every);
      const first = rule.days[0];
      next.setDate(next.getDate() + ((first + 6) % 7));
    }
  } else if (rule.unit === "day") {
    next = new Date(start);
    next.setDate(start.getDate() + rule.every);
  } else if (rule.unit === "week") {
    next = new Date(start);
    next.setDate(start.getDate() + 7 * rule.every);
  } else if (rule.unit === "month") {
    const y = start.getFullYear();
    const m = start.getMonth() + rule.every;
    const last = new Date(y, m + 1, 0).getDate();
    next = new Date(y, m, Math.min(start.getDate(), last));
  } else {
    next = new Date(start);
    next.setFullYear(start.getFullYear() + rule.every);
  }
  const out = iso(next);
  return rule.until && out > rule.until ? null : out;
}
