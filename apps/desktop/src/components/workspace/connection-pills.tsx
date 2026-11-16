import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  findNote,
  KIND_GROUPS,
  type VaultIndex,
  type VaultNote,
} from "@/lib/vault/vault-index";
import { groupColor } from "@/lib/vault/group-colors";
import { useKindChoices } from "@/stores/vault-store";

/** Past this many, the list gets a search box. */
const SEARCH_FROM = 12;

/** The notes linked with this one, either way, by type. */
export function connectionsByType(
  index: VaultIndex,
  note: VaultNote,
): Map<string, VaultNote[]> {
  const seen = new Set<string>();
  const out = new Map<string, VaultNote[]>();
  for (const name of [...note.outgoing, ...note.incoming]) {
    const other = findNote(index, name);
    if (!other || other.path === note.path || seen.has(other.path)) continue;
    seen.add(other.path);
    out.set(other.kind, [...(out.get(other.kind) ?? []), other]);
  }
  for (const list of out.values()) {
    list.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  }
  return out;
}

/**
 * What a note is connected to, as one small pill per type ("Papers 124").
 * A pill opens the list of those notes, searchable when it's long, so a
 * project linked to hundreds of notes still takes one line.
 */
export function ConnectionPills({
  index,
  note,
  onOpen,
}: {
  index: VaultIndex;
  note: VaultNote;
  onOpen: (name: string) => void;
}) {
  const choices = useKindChoices();
  const groups = useMemo(() => {
    const byType = connectionsByType(index, note);
    return choices
      .map(({ kind, label }) => {
        const plural =
          kind === "note"
            ? "Notes"
            : ((KIND_GROUPS as Record<string, string>)[kind] ?? label);
        return { kind, plural, notes: byType.get(kind) ?? [] };
      })
      .filter((g) => g.notes.length > 0);
  }, [index, note, choices]);
  if (groups.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1 pt-0.5">
      {groups.map((g) => (
        <Pill
          key={g.kind}
          label={g.plural}
          color={groupColor(g.plural, g.kind)}
          notes={g.notes}
          onOpen={onOpen}
        />
      ))}
    </span>
  );
}

function Pill({
  label,
  color,
  notes,
  onOpen,
}: {
  label: string;
  color: string;
  notes: VaultNote[];
  onOpen: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? notes.filter((n) => words.every((w) => n.title.toLowerCase().includes(w)))
    : notes;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          // The row opens its note on a click; the pill only its list.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1 rounded px-1.5 py-px text-[10px] leading-4 transition-opacity hover:opacity-80"
          style={{
            color,
            backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}
          title={`${notes.length} ${label.toLowerCase()} connected`}
        >
          {label}
          <span className="tabular-nums opacity-80">{notes.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 pt-1 pb-1.5 font-medium text-muted-foreground text-xs">
          {label} · {notes.length}
        </div>
        {notes.length > SEARCH_FROM && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="mb-1 h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
          />
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.map((n) => (
            <button
              key={n.path}
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen(n.name);
              }}
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-muted"
              title={n.title}
            >
              <span
                className="mt-1 size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="line-clamp-2 min-w-0 flex-1">{n.title}</span>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              None match.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
