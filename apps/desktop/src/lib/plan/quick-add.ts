/**
 * Quick add: a task typed the way it's said, its date and priority picked
 * out of the words.
 *
 *   "Revise the intro tomorrow !high #paper2"
 *     → title "Revise the intro #paper2", due tomorrow, high priority
 *
 * Dates: today, tomorrow, a weekday ("friday", "next friday"), "next week",
 * "in 3 days" / "in 2 weeks", "nov 20" / "20 november", 2026-11-20; with
 * "on", "by" or "due" before them or not. Spanish too: hoy, mañana, viernes.
 * Priority: !high !medium !low !urgent, or !!! !! !.
 */
import { type Priority, type Repeat, today } from "./plan-file";

export interface QuickTask {
  title: string;
  due?: string;
  priority: Priority;
  repeat?: Repeat;
}

/** "every week", "daily", "cada semana"…: how it repeats. */
const REPEATS: [RegExp, Repeat][] = [
  [/\s(?:every day|daily|cada d[ií]a|diario|diariamente)(?=\s)/i, "every day"],
  [
    /\s(?:every week|weekly|cada semana|semanal|semanalmente)(?=\s)/i,
    "every week",
  ],
  [
    /\s(?:every month|monthly|cada mes|mensual|mensualmente)(?=\s)/i,
    "every month",
  ],
  [
    /\s(?:every year|yearly|annually|cada a[ñn]o|anual|anualmente)(?=\s)/i,
    "every year",
  ],
];

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  domingo: 0,
  monday: 1,
  mon: 1,
  lunes: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  martes: 2,
  wednesday: 3,
  wed: 3,
  miercoles: 3,
  miércoles: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  jueves: 4,
  friday: 5,
  fri: 5,
  viernes: 5,
  saturday: 6,
  sat: 6,
  sabado: 6,
  sábado: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  ene: 0,
  enero: 0,
  feb: 1,
  february: 1,
  febrero: 1,
  mar: 2,
  march: 2,
  marzo: 2,
  apr: 3,
  april: 3,
  abr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  jun: 5,
  june: 5,
  junio: 5,
  jul: 6,
  july: 6,
  julio: 6,
  aug: 7,
  august: 7,
  ago: 7,
  agosto: 7,
  sep: 8,
  sept: 8,
  september: 8,
  septiembre: 8,
  oct: 9,
  october: 9,
  octubre: 9,
  nov: 10,
  november: 10,
  noviembre: 10,
  dec: 11,
  december: 11,
  dic: 11,
  diciembre: 11,
};

const PRIORITIES: Record<string, Priority> = {
  "!urgent": 4,
  "!highest": 4,
  "!high": 3,
  "!h": 3,
  "!!!": 3,
  "!medium": 2,
  "!med": 2,
  "!m": 2,
  "!!": 2,
  "!low": 1,
  "!l": 1,
  "!": 1,
};

const day = (d: Date, n: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

/** The next such month and day, this year or next. */
function monthDay(now: Date, month: number, date: number): Date | null {
  if (date < 1 || date > 31) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let d = new Date(now.getFullYear(), month, date);
  if (d.getMonth() !== month) return null;
  if (d < start) d = new Date(now.getFullYear() + 1, month, date);
  return d;
}

const LEAD = "(?:(?:on|by|due|el|para)\\s+)?";

/** Date phrases, tried in order; each gives the date it names. */
const PHRASES: [RegExp, (m: RegExpExecArray, now: Date) => Date | null][] = [
  [/(\d{4})-(\d{2})-(\d{2})/, (m) => new Date(+m[1], +m[2] - 1, +m[3])],
  [/(?:today|tod|hoy)/, (_, now) => now],
  [/(?:tomorrow|tmr|tmrw|mañana|manana)/, (_, now) => day(now, 1)],
  [/next\s+week|la\s+semana\s+que\s+viene/, (_, now) => day(now, 7)],
  [
    /in\s+(\d+)\s+(days?|weeks?|días?|dias?|semanas?)/,
    (m, now) => day(now, +m[1] * (/^(week|semana)/.test(m[2]) ? 7 : 1)),
  ],
  [
    /(?:en\s+)?(\d+)\s+(días|dias|semanas)/,
    (m, now) => day(now, +m[1] * (m[2].startsWith("semana") ? 7 : 1)),
  ],
  [
    /(next\s+)?([a-záé]+)/,
    (m, now) => {
      const wd = WEEKDAYS[m[2]];
      if (wd === undefined) return null;
      const ahead = (wd - now.getDay() + 7) % 7;
      return day(now, (m[1] ? 7 : 0) + ahead);
    },
  ],
  [
    /([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?/,
    (m, now) =>
      MONTHS[m[1]] === undefined ? null : monthDay(now, MONTHS[m[1]], +m[2]),
  ],
  [
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:de\s+)?([a-z]+)/,
    // "3 may" reads as a verb as often as a date: May goes first ("may 3").
    (m, now) =>
      MONTHS[m[2]] === undefined || m[2] === "may"
        ? null
        : monthDay(now, MONTHS[m[2]], +m[1]),
  ],
];

export function parseQuickAdd(text: string, now = new Date()): QuickTask {
  let rest = ` ${text.trim()} `;
  let priority: Priority = 0;
  rest = rest.replace(/\s(!+[a-z]*)(?=\s)/gi, (all, mark: string) => {
    const p = PRIORITIES[mark.toLowerCase()];
    if (p === undefined) return all;
    priority = Math.max(priority, p) as Priority;
    return " ";
  });

  let repeat: Repeat | undefined;
  for (const [re, r] of REPEATS) {
    if (re.test(rest)) {
      repeat = r;
      rest = rest.replace(re, " ");
      break;
    }
  }

  let due: string | undefined;
  const lower = rest.toLowerCase();
  search: for (const [pattern, toDate] of PHRASES) {
    const re = new RegExp(`\\s${LEAD}${pattern.source}(?=\\s)`, "gi");
    for (const m of lower.matchAll(re)) {
      // The phrase's own groups, the lead-in skipped.
      const inner = new RegExp(`^${pattern.source}$`, "i").exec(
        m[0].trim().replace(new RegExp(`^${LEAD}`, "i"), ""),
      );
      const date = inner ? toDate(inner, now) : null;
      if (!date) continue;
      due = today(date);
      const at = m.index ?? 0;
      rest = rest.slice(0, at) + rest.slice(at + m[0].length);
      break search;
    }
  }
  // Repeating with no date: from today.
  if (repeat && !due) due = today(now);
  return {
    title: rest.replace(/\s+/g, " ").trim(),
    due,
    priority,
    ...(repeat ? { repeat } : {}),
  };
}
