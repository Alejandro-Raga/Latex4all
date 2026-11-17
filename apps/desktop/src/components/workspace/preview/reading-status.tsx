/**
 * In the reader's header, for a paper on a reading list: its status, to
 * change it there (a paper only looked at isn't being read).
 */
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parsePlan } from "@/lib/plan/plan-file";
import { usePlanStore } from "@/lib/plan/plan-store";
import {
  readingItems,
  type ReadingStatus,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
} from "@/lib/plan/reading";
import { noteStatus } from "@/lib/plan/reading-sync";

/** Its status on the first reading list it's on, if any (as loaded). */
function useStatus(itemKey: string): ReadingStatus | null {
  const entries = usePlanStore((s) => s.entries);
  return useMemo(() => {
    for (const entry of Object.values(entries)) {
      if (!entry.text?.includes(itemKey)) continue;
      const item = readingItems(parsePlan(entry.text)).find(
        (r) => r.itemKey === itemKey,
      );
      if (item) return item.status;
    }
    return null;
  }, [entries, itemKey]);
}

export function ReadingStatusButton({ itemKey }: { itemKey: string }) {
  const status = useStatus(itemKey);
  if (!status) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Status on your reading list"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted"
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: STATUS_COLOR[status] }}
          />
          {STATUS_LABEL[status]}
          <ChevronDownIcon className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {STATUSES.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={() => void noteStatus(itemKey, s)}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: STATUS_COLOR[s] }}
            />
            <span className="flex-1">{STATUS_LABEL[s]}</span>
            {s === status && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
