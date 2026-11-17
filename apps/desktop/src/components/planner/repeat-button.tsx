/**
 * How a task repeats: a few common ones, or one of your own (every few
 * days, weeks…, on some days of the week, until a day or for some weeks).
 */
import { CheckIcon, RepeatIcon } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { addDays } from "@/lib/plan/calendar";
import { today } from "@/lib/plan/plan-file";
import {
  describeRule,
  parseRule,
  type Rule,
  ruleText,
  type Unit,
} from "@/lib/plan/repeat";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";

const PRESETS: [string, string][] = [
  ["Every day", "every day"],
  ["Weekdays", "every week on Monday, Tuesday, Wednesday, Thursday, Friday"],
  ["Every week", "every week"],
  ["Every 2 weeks", "every 2 weeks"],
  ["Every month", "every month"],
  ["Every year", "every year"],
];

// Monday first, as the calendar shows them.
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const LETTER = ["S", "M", "T", "W", "T", "F", "S"];

type End = "never" | "date" | "weeks";

function Custom({
  start,
  due,
  onSave,
}: {
  start?: Rule;
  due?: string;
  onSave: (rule: string) => void;
}) {
  const [every, setEvery] = useState(start?.every ?? 1);
  const [unit, setUnit] = useState<Unit>(start?.unit ?? "week");
  const [days, setDays] = useState<number[]>(start?.days ?? []);
  const [end, setEnd] = useState<End>(start?.until ? "date" : "never");
  const [until, setUntil] = useState<string | undefined>(start?.until);
  const [weeks, setWeeks] = useState(4);
  const from = due ?? today();
  const save = () => {
    const rule: Rule = { every: Math.max(1, every), unit };
    if (unit === "week" && days.length)
      rule.days = [...days].sort((a, b) => a - b);
    if (end === "date" && until) rule.until = until;
    if (end === "weeks") rule.until = addDays(from, weeks * 7 - 1);
    onSave(ruleText(rule));
  };
  return (
    <div className="w-64 space-y-3 p-1 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Every</span>
        <input
          type="number"
          min={1}
          max={99}
          value={every}
          onChange={(e) => setEvery(Number(e.target.value) || 1)}
          aria-label="How often"
          className="h-7 w-12 rounded-md border border-input bg-background px-1.5 text-center"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as Unit)}
          aria-label="Unit"
          className="h-7 flex-1 rounded-md border border-input bg-background px-1.5"
        >
          <option value="day">{every === 1 ? "day" : "days"}</option>
          <option value="week">{every === 1 ? "week" : "weeks"}</option>
          <option value="month">{every === 1 ? "month" : "months"}</option>
          <option value="year">{every === 1 ? "year" : "years"}</option>
        </select>
      </div>
      {unit === "week" && (
        <div className="flex justify-between" role="group" aria-label="On">
          {WEEK.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
              aria-label={
                [
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ][d]
              }
              onClick={() =>
                setDays((ds) =>
                  ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d],
                )
              }
              className={cn(
                "flex size-7 items-center justify-center rounded-full",
                days.includes(d)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70",
              )}
            >
              {LETTER[d]}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <span className="text-muted-foreground">Ends</span>
        <div
          className="flex rounded-md border p-0.5"
          role="radiogroup"
          aria-label="Ends"
        >
          {(
            [
              ["never", "Never"],
              ["weeks", "After"],
              ["date", "On a day"],
            ] as [End, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={end === v}
              onClick={() => setEnd(v)}
              className={cn(
                "flex-1 rounded px-1.5 py-1",
                end === v ? "bg-muted font-medium" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {end === "weeks" && (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={104}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value) || 1)}
              aria-label="Weeks"
              className="h-7 w-12 rounded-md border border-input bg-background px-1.5 text-center"
            />
            <span className="text-muted-foreground">
              {weeks === 1 ? "week" : "weeks"}
            </span>
          </div>
        )}
        {end === "date" && <DatePicker value={until} onPick={setUntil} />}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={end === "date" && !until}
        className="h-7 w-full rounded-md bg-primary font-medium text-primary-foreground disabled:opacity-50"
      >
        Save
      </button>
    </div>
  );
}

export function RepeatButton({
  repeat,
  due,
  onChange,
}: {
  repeat?: string;
  due?: string;
  onChange: (repeat: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const rule = repeat ? parseRule(repeat) : null;
  const pick = (r: string | undefined) => {
    onChange(r);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCustom(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Repeat"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted"
        >
          <RepeatIcon
            className={cn("size-3.5", !rule && "text-muted-foreground")}
          />
          <span
            className={cn(
              "max-w-40 truncate",
              !rule && "text-muted-foreground",
            )}
          >
            {rule ? describeRule(rule) : "Repeat"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        {custom ? (
          <Custom start={rule ?? undefined} due={due} onSave={(r) => pick(r)} />
        ) : (
          <div className="w-48">
            {PRESETS.map(([label, value]) => (
              <button
                key={value}
                type="button"
                onClick={() => pick(value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="flex-1">{label}</span>
                {repeat === value && <CheckIcon className="size-3.5" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span className="flex-1">Custom…</span>
              {rule && !PRESETS.some(([, v]) => v === repeat) && (
                <CheckIcon className="size-3.5" />
              )}
            </button>
            {repeat && (
              <>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => pick(undefined)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
                >
                  No repeat
                </button>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
