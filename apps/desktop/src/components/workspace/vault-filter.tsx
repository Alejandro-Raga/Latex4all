import { useMemo } from "react";
import { SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_FILTER,
  type NoteFilter,
  type NoteSort,
} from "@/lib/vault/note-query";
import type { VaultIndex } from "@/lib/vault/vault-index";
import { cn } from "@/lib/utils";

/** What the filter row holds; typed conditions add to it. */
export interface FilterRow {
  yearFrom: string;
  yearTo: string;
  kind: string;
  topic: string;
  sort: NoteSort;
}

export const EMPTY_ROW: FilterRow = {
  yearFrom: "",
  yearTo: "",
  kind: "",
  topic: "",
  sort: "relevance",
};

const year = (text: string) => {
  const y = Number.parseInt(text, 10);
  return Number.isFinite(y) && y > 0 ? y : null;
};

export function rowFilter(row: FilterRow): NoteFilter {
  return {
    ...EMPTY_FILTER,
    yearFrom: year(row.yearFrom),
    yearTo: year(row.yearTo),
    kinds: row.kind ? [row.kind.toLowerCase()] : [],
    topics: row.topic ? [row.topic.toLowerCase()] : [],
  };
}

/** Anything picked besides the default order. */
export const rowActive = (row: FilterRow) =>
  Boolean(row.yearFrom || row.yearTo || row.kind || row.topic) ||
  row.sort !== "relevance";

const SORTS: [NoteSort, string][] = [
  ["relevance", "Best match"],
  ["year-desc", "Newest first"],
  ["year-asc", "Oldest first"],
  ["title", "Title"],
  ["author", "First author"],
];

/** Opens the filter row; dotted while a filter is on. */
export function FilterToggle({
  open,
  active,
  onToggle,
}: {
  open: boolean;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        open && "bg-muted text-foreground",
      )}
      title="Filter and sort"
      aria-label="Filter and sort"
      aria-expanded={open}
    >
      <SlidersHorizontalIcon className="size-3.5" />
      {active && (
        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

/**
 * Year range, type, topic and order, as in Zotero's search. Field
 * conditions can also be typed in the search: `author:nelson`,
 * `year:1990-2005`, `topic:"open science"`, `type:paper`, `tag:x`.
 */
export function FilterRowControls({
  index,
  row,
  onChange,
  kinds = true,
}: {
  index: VaultIndex;
  row: FilterRow;
  onChange: (row: FilterRow) => void;
  /** Offer the type filter (not where every note is the same type). */
  kinds?: boolean;
}) {
  const kindOptions = useMemo(
    () => [...new Set(index.list.map((n) => n.kind))].sort(),
    [index],
  );
  const topicOptions = useMemo(
    () =>
      index.list
        .filter((n) => n.kind === "topic")
        .map((n) => n.title)
        .sort((a, b) => a.localeCompare(b)),
    [index],
  );
  const set = (patch: Partial<FilterRow>) => onChange({ ...row, ...patch });
  const yearInput = (key: "yearFrom" | "yearTo", label: string) => (
    <Input
      value={row[key]}
      onChange={(e) =>
        set({ [key]: e.target.value.replace(/\D/g, "").slice(0, 4) })
      }
      placeholder={label}
      aria-label={label === "From" ? "From year" : "To year"}
      inputMode="numeric"
      className="h-7 w-[4.25rem] px-2 text-xs"
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2 text-xs">
      <span className="text-muted-foreground">Year</span>
      {yearInput("yearFrom", "From")}
      <span className="text-muted-foreground">–</span>
      {yearInput("yearTo", "To")}
      {kinds && kindOptions.length > 1 && (
        <Select
          value={row.kind || "all"}
          onValueChange={(v) => set({ kind: v === "all" ? "" : v })}
        >
          <SelectTrigger
            className="h-7 w-auto gap-1 px-2 text-xs"
            aria-label="Type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {kindOptions.map((k) => (
              <SelectItem key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {topicOptions.length > 0 && (
        <Select
          value={row.topic || "all"}
          onValueChange={(v) => set({ topic: v === "all" ? "" : v })}
        >
          <SelectTrigger
            className="h-7 w-auto max-w-40 gap-1 px-2 text-xs"
            aria-label="Topic"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any topic</SelectItem>
            {topicOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={row.sort}
        onValueChange={(v) => set({ sort: v as NoteSort })}
      >
        <SelectTrigger
          className="h-7 w-auto gap-1 px-2 text-xs"
          aria-label="Sort"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {rowActive(row) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_ROW)}
          className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3" />
          Clear
        </button>
      )}
    </div>
  );
}
