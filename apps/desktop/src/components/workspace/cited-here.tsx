import { useMemo } from "react";
import { QuoteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { bibEntries } from "@/lib/citations";
import { openAtLine } from "@/lib/open-at-line";
import { noteForCitekey } from "@/lib/vault/cite-link";
import { type CitePlace, citeLocations } from "@/lib/vault/project-note";
import { type LibraryItem, useZoteroLibrary } from "@/lib/zotero-library";
import { useDocumentStore } from "@/stores/document-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

/** Zotero item keys by the citation keys this project's .bib files use. */
export function useItemKeyByCitekey(): Map<string, string> {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const synced = useZoteroStore((s) => s.syncedCollections);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const info of Object.values(
      (projectRoot && synced[projectRoot]) || {},
    )) {
      for (const [item, citekey] of Object.entries(info.keyMap)) {
        map.set(citekey, item);
      }
    }
    return map;
  }, [projectRoot, synced]);
}

/**
 * Where the open project cites each key, in order of first citation. Empty
 * while `enabled` is off, so a closed filter costs nothing as you type.
 */
function useCitePlaces(enabled: boolean) {
  const files = useDocumentStore((s) => (enabled ? s.files : null));
  return useMemo(() => {
    if (!files) return { places: new Map<string, CitePlace[]>(), titles: {} };
    const places = citeLocations(
      files
        .filter((f) => f.type === "tex")
        .map((f) => ({ path: f.relativePath, content: f.content ?? "" })),
    );
    const titles: Record<string, string> = {};
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith(".bib")) continue;
      for (const e of bibEntries(f.content ?? "", f.relativePath)) {
        if (e.title) titles[e.key] = e.title;
      }
    }
    return { places, titles };
  }, [files]);
}

const addPlaces = <K,>(map: Map<K, CitePlace[]>, key: K, add: CitePlace[]) =>
  map.set(key, [...(map.get(key) ?? []), ...add]);

/** Vault notes the open project cites, with where. */
export function useCitedNotes(enabled: boolean) {
  const { places } = useCitePlaces(enabled);
  const index = useVaultStore((s) => s.index);
  const itemKeys = useItemKeyByCitekey();
  return useMemo(() => {
    const byNote = new Map<string, CitePlace[]>();
    let missing = 0;
    if (!index) return { byNote, missing };
    for (const [key, at] of places) {
      const note = noteForCitekey(index, key, itemKeys);
      if (note) addPlaces(byNote, note.name, at);
      else missing++;
    }
    return { byNote, missing };
  }, [index, places, itemKeys]);
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

/** Zotero items the open project cites, with where. */
export function useCitedItems(enabled: boolean) {
  const { places, titles } = useCitePlaces(enabled);
  const mirror = useZoteroLibrary((s) => s.mirror);
  const itemKeys = useItemKeyByCitekey();
  return useMemo(() => {
    const items: { item: LibraryItem; places: CitePlace[] }[] = [];
    let missing = 0;
    if (!mirror) return { items, missing };
    // By the synced .bib's own record, else by the entry's title.
    const byTitle = new Map<string, LibraryItem>();
    for (const item of Object.values(mirror.items)) {
      byTitle.set(fold(item.title), item);
    }
    const found = new Map<string, CitePlace[]>();
    for (const [key, at] of places) {
      const itemKey = itemKeys.get(key);
      const item =
        (itemKey && mirror.items[itemKey]) ||
        (titles[key] ? byTitle.get(fold(titles[key])) : undefined);
      if (item) addPlaces(found, item.key, at);
      else missing++;
    }
    for (const [key, at] of found) {
      items.push({ item: mirror.items[key], places: at });
    }
    return { items, missing };
  }, [mirror, places, titles, itemKeys]);
}

/** The "only what this project cites" toggle. */
export function CitedToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? "Show everything" : "Only what this project cites"}
      aria-label="Only what this project cites"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        on && "bg-primary/15 text-primary hover:bg-primary/20",
      )}
    >
      <QuoteIcon className="size-3.5" />
    </button>
  );
}

/** Where something is cited, as file:line chips that open the editor there. */
export function CitedAt({ places }: { places: CitePlace[] }) {
  const shown = places.slice(0, 4);
  const single = new Set(places.map((p) => p.file)).size === 1;
  return (
    <span className="flex flex-wrap gap-1 pt-0.5">
      {shown.map((p) => (
        <button
          key={`${p.file}:${p.line}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openAtLine(p.file, p.line);
          }}
          title={`Go to ${p.file}, line ${p.line}`}
          className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
        >
          {single ? `line ${p.line}` : `${p.file.split("/").pop()}:${p.line}`}
        </button>
      ))}
      {places.length > shown.length && (
        <span className="px-0.5 text-[10px] text-muted-foreground">
          +{places.length - shown.length}
        </span>
      )}
    </span>
  );
}
