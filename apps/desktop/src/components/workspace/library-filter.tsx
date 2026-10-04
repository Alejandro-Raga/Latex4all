import { useMemo } from "react";
import { XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ZoteroItemSummary } from "@/lib/zotero-api";
import {
  NO_REFERENCE_FILTER,
  type ReferenceFilter,
  referenceFilterActive,
  referenceTypeLabel,
} from "@/lib/zotero-search";

const year = (text: string) => {
  const y = Number.parseInt(text, 10);
  return Number.isFinite(y) && y > 0 ? y : null;
};

/** Year range and item type for the Zotero library, as in the vault. */
export function LibraryFilterRow({
  items,
  filter,
  onChange,
}: {
  items: ZoteroItemSummary[];
  filter: ReferenceFilter;
  onChange: (filter: ReferenceFilter) => void;
}) {
  const types = useMemo(
    () =>
      [...new Set(items.map((i) => i.itemType).filter(Boolean) as string[])]
        .map((t) => [t, referenceTypeLabel(t)] as const)
        .sort((a, b) => a[1].localeCompare(b[1])),
    [items],
  );
  const yearInput = (key: "yearFrom" | "yearTo", label: string) => (
    <Input
      value={filter[key] === null ? "" : String(filter[key])}
      onChange={(e) => {
        const text = e.target.value.replace(/\D/g, "").slice(0, 4);
        onChange({ ...filter, [key]: text.length === 4 ? year(text) : null });
      }}
      placeholder={label}
      aria-label={label === "From" ? "From year" : "To year"}
      inputMode="numeric"
      className="h-7 w-[4.25rem] px-2 text-xs"
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5 text-xs">
      <span className="text-muted-foreground">Year</span>
      {yearInput("yearFrom", "From")}
      <span className="text-muted-foreground">–</span>
      {yearInput("yearTo", "To")}
      {types.length > 1 && (
        <Select
          value={filter.type || "all"}
          onValueChange={(v) =>
            onChange({ ...filter, type: v === "all" ? "" : v })
          }
        >
          <SelectTrigger
            className="h-7 w-auto max-w-40 gap-1 px-2 text-xs"
            aria-label="Item type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map(([t, label]) => (
              <SelectItem key={t} value={t}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {referenceFilterActive(filter) && (
        <button
          type="button"
          onClick={() => onChange(NO_REFERENCE_FILTER)}
          className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3" />
          Clear
        </button>
      )}
    </div>
  );
}
