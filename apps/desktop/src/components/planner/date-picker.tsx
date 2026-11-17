/**
 * Picking a day: a few quick choices, then a month to click a day in, in
 * the app's own look (not the system's date field).
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { monthDays, shiftMonth } from "@/lib/plan/calendar";
import { dayFromToday } from "@/lib/plan/dates";
import { today } from "@/lib/plan/plan-file";
import { cn } from "@/lib/utils";

const QUICK = [
  ["Today", 0],
  ["Tomorrow", 1],
  ["Next week", 7],
  ["In a month", 30],
] as const;

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function DatePicker({
  value,
  onPick,
}: {
  value?: string;
  onPick: (day: string | undefined) => void;
}) {
  const now = today();
  const [shown, setShown] = useState(() => shiftMonth(value ?? now, 0));
  const [year, month] = shown.split("-").map(Number);
  const days = monthDays(year, month - 1);
  const title = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return (
    <div className="w-60">
      <div className="grid grid-cols-2 gap-1">
        {QUICK.map(([label, n]) => (
          <button
            key={label}
            type="button"
            onClick={() => onPick(dayFromToday(n))}
            className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 border-border border-t pt-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="font-medium text-xs">{title}</span>
          <span className="flex">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setShown(shiftMonth(shown, -1))}
              className="flex size-6 items-center justify-center rounded-md hover:bg-muted"
            >
              <ChevronLeftIcon className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setShown(shiftMonth(shown, 1))}
              className="flex size-6 items-center justify-center rounded-md hover:bg-muted"
            >
              <ChevronRightIcon className="size-3.5" />
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
          {WEEKDAYS.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two Ts and two Ss
            <span key={i} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {days.map((d) => {
            const inMonth = Number(d.slice(5, 7)) === month;
            const picked = d === value;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onPick(d)}
                aria-label={new Date(`${d}T00:00`).toLocaleDateString(
                  undefined,
                  {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  },
                )}
                aria-pressed={picked}
                className={cn(
                  "mx-auto flex size-7 items-center justify-center rounded-full text-xs tabular-nums",
                  !inMonth && "text-muted-foreground/50",
                  picked
                    ? "bg-primary text-primary-foreground"
                    : d === now
                      ? "font-semibold text-primary hover:bg-muted"
                      : "hover:bg-muted",
                )}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onPick(undefined)}
          className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
        >
          No date
        </button>
      )}
    </div>
  );
}
