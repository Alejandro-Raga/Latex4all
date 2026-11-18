/**
 * The marks along a timeline at its current zoom: from years and quarters
 * when zoomed right out, to months, weeks and single days zoomed in. Two
 * rows: the larger unit above (a year, a month), the smaller below.
 */
export type Unit = "year" | "quarter" | "month" | "week" | "day";

export interface Tick {
  /** YYYY-MM-DD: where it starts. */
  date: string;
  label: string;
  /** A Saturday or Sunday (days only). */
  weekend?: boolean;
}

export interface Scale {
  unit: Unit;
  /** The larger unit, above. */
  major: Tick[];
  /** The smaller unit, below; gridlines go at these. */
  minor: Tick[];
}

const MS_DAY = 86_400_000;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (s: string) => new Date(`${s}T00:00`);

/** Which unit, from how many pixels a day gets. */
export function unitFor(pxPerDay: number): Unit {
  if (pxPerDay >= 22) return "day";
  if (pxPerDay >= 5) return "week";
  if (pxPerDay >= 1.2) return "month";
  if (pxPerDay >= 0.35) return "quarter";
  return "year";
}

/** The pixels a day needs to show each unit (the next zoom level up). */
export const PX_PER_DAY_FOR_DAYS = 22;

function* every(
  start: Date,
  end: Date,
  first: (d: Date) => Date,
  next: (d: Date) => Date,
) {
  for (let d = first(start); d <= end; d = next(d)) yield d;
}

const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const nextMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1);
const yearStart = (d: Date) => new Date(d.getFullYear(), 0, 1);
const nextYear = (d: Date) => new Date(d.getFullYear() + 1, 0, 1);

/** The scale for a span shown `width` pixels wide. */
export function scaleFor(start: string, end: string, width: number): Scale {
  const from = at(start);
  const to = at(end);
  const days = Math.max(1, (to.getTime() - from.getTime()) / MS_DAY);
  const unit = unitFor(width / days);
  const monthLabel = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      month: unit === "day" ? "long" : "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  const years = [...every(from, to, yearStart, nextYear)].map((d) => ({
    date: iso(d),
    label: String(d.getFullYear()),
  }));
  const months = (withYear: boolean) =>
    [...every(from, to, monthStart, nextMonth)].map((d) => ({
      date: iso(d),
      label: monthLabel(d, withYear || d.getMonth() === 0),
    }));

  if (unit === "year") return { unit, major: [], minor: years };
  if (unit === "quarter") {
    const quarters = [
      ...every(
        from,
        to,
        (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1),
        (d) => new Date(d.getFullYear(), d.getMonth() + 3, 1),
      ),
    ].map((d) => ({ date: iso(d), label: `Q${d.getMonth() / 3 + 1}` }));
    return { unit, major: years, minor: quarters };
  }
  if (unit === "month") {
    return {
      unit,
      major: years,
      minor: months(false).map((m) => ({
        ...m,
        label: at(m.date).toLocaleDateString(undefined, { month: "short" }),
      })),
    };
  }
  if (unit === "week") {
    const mondays = [
      ...every(
        from,
        to,
        (d) => {
          const m = new Date(d);
          m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
          return m;
        },
        (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
      ),
    ].map((d) => ({
      date: iso(d),
      label: d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      }),
    }));
    return { unit, major: months(true), minor: mondays };
  }
  const dayTicks = [
    ...every(
      from,
      to,
      (d) => new Date(d),
      (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    ),
  ].map((d) => ({
    date: iso(d),
    label: String(d.getDate()),
    weekend: d.getDay() === 0 || d.getDay() === 6,
  }));
  return { unit, major: months(true), minor: dayTicks };
}
