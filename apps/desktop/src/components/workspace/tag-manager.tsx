import { useEffect, useMemo, useState } from "react";
import { Loader2Icon, SearchIcon, TagsIcon } from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type ImportChoice,
  type ImportPreview,
  listZoteroTags,
  previewImport,
  runImport,
  tagStatus,
  type ZoteroTag,
} from "@/lib/vault/tag-import";
import {
  BIG_TAG,
  noteNameFor,
  parseTag,
  type TagType,
  tagTypes,
} from "@/lib/vault/zotero-tag-notes";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useNoteTypes, useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

export const useTagManager = create<{
  open: boolean;
  show: () => void;
  close: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

const NEW_TYPE = "\0new";
const COLORS = ["#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

interface Pick {
  kind: string;
  name: string;
}

/**
 * Zotero's tags, and the vault notes they go with: pick tags to import as
 * notes of a type (a new type too), see what each is paired with, and choose
 * whether paired notes follow Zotero and notes become Zotero tags.
 */
export function TagManagerDialog() {
  const open = useTagManager((s) => s.open);
  const close = useTagManager((s) => s.close);
  const connected = useZoteroStore((s) => Boolean(s.apiKey));
  const index = useVaultStore((s) => s.index);
  const custom = useNoteTypes();
  const types = useMemo(() => tagTypes(custom), [custom]);
  const live = useSettingsStore((s) => s.zoteroTagNotesLive);
  const setLive = useSettingsStore((s) => s.setZoteroTagNotesLive);
  const registry = useSettingsStore((s) => s.zoteroTagRegistry);
  const auto = useSettingsStore((s) => s.zoteroAutoVault);
  const setAuto = useSettingsStore((s) => s.setZoteroAutoVault);
  const vaultTag = useVaultStore((s) => s.paperTag || "obsidian");
  const setRegistry = useSettingsStore((s) => s.setZoteroTagRegistry);

  const [tags, setTags] = useState<ZoteroTag[] | null>(null);
  const [automatic, setAutomatic] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [picked, setPicked] = useState<Map<string, Pick>>(new Map());
  const [newType, setNewType] = useState<{ tag: string; label: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<ImportPreview[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listZoteroTags()
      .then(({ tags, automatic }) => {
        setTags(tags);
        setAutomatic(automatic);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  };
  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    setPreview(null);
    useVaultStore.getState().ensureVault();
    if (connected) load();
  }, [open, connected]);

  const rows = useMemo(() => {
    if (!tags || !index) return [];
    const q = query.trim().toLowerCase();
    return tags
      .filter((t) => !q || t.tag.toLowerCase().includes(q))
      .map((t) => ({ ...t, status: tagStatus(t.tag, index) }))
      .filter((r) => !onlyFree || r.status.state === "free");
  }, [tags, index, types, query, onlyFree]);

  const typeOf = (kind: string): TagType | undefined =>
    types.find((t) => t.kind === kind);

  const toggle = (tag: string) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(tag)) n.delete(tag);
      else {
        const typed = parseTag(tag, types);
        n.set(tag, {
          kind: typed?.type.kind ?? "topic",
          name: noteNameFor(tag, types),
        });
      }
      return n;
    });
  const setPick = (tag: string, change: Partial<Pick>) =>
    setPicked((m) => {
      const cur = m.get(tag);
      if (!cur) return m;
      return new Map(m).set(tag, { ...cur, ...change });
    });

  const makeType = (tag: string, label: string) => {
    const clean = label.trim();
    if (!clean) return;
    const { addNoteType, updateNoteType } = useVaultStore.getState();
    const id = addNoteType(clean, COLORS[custom.length % COLORS.length]);
    const word = clean.toLowerCase();
    updateNoteType(id, {
      zoteroTag: word,
      folder: clean.endsWith("s") ? clean : `${clean}s`,
    });
    setPick(tag, { kind: id });
    setNewType(null);
  };

  const choices: ImportChoice[] = [...picked]
    .map(([tag, p]) => ({ tag, type: typeOf(p.kind), name: p.name.trim() }))
    .filter((c): c is ImportChoice => Boolean(c.type && c.name));

  const doPreview = async () => {
    setBusy("Reading the tags from Zotero…");
    try {
      setPreview(await previewImport(choices));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const doImport = async () => {
    if (!preview) return;
    setBusy(`Writing 0 of ${preview.length}…`);
    try {
      const made = await runImport(preview, (done) =>
        setBusy(`Writing ${done} of ${preview.length}…`),
      );
      toast.success(
        made.length === 1
          ? `“${made[0]}” is in your vault`
          : `${made.length} notes in your vault`,
      );
      setPreview(null);
      setPicked(new Map());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TagsIcon className="size-4" />
            Tag manager
          </DialogTitle>
          <DialogDescription>
            Turn Zotero tags into vault notes: pick the tags, the type of note,
            and its name. Only the vault is written; your Zotero tags stay as
            they are.
          </DialogDescription>
        </DialogHeader>

        {!connected ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            Connect Zotero in Settings → Zotero first.
          </p>
        ) : error ? (
          <p className="py-6 text-center text-destructive text-sm">{error}</p>
        ) : !tags || !index ? (
          <p className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            Reading your tags…
          </p>
        ) : preview ? (
          <>
            <ul className="-mx-2 min-h-0 flex-1 space-y-1 overflow-y-auto text-sm">
              {preview.map(({ choice, existing, members }) => {
                const big = members.papers.length >= BIG_TAG;
                return (
                  <li key={choice.tag} className="rounded-md px-2 py-1.5">
                    <div>
                      <span className="text-muted-foreground">
                        {choice.type.label}
                      </span>{" "}
                      <span className="font-medium">{choice.name}</span>
                      <span className="text-muted-foreground">
                        {existing
                          ? " — pairs your note of that name"
                          : " — a new note"}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "text-xs",
                        big
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      Lists {members.papers.length} paper
                      {members.papers.length === 1 ? "" : "s"}
                      {" · "}copies {members.passages.length} highlight
                      {members.passages.length === 1 ? "" : "s"}
                      {big &&
                        " — a long list; papers without a note are listed, not given notes"}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex-1 text-muted-foreground text-xs">
                {busy}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreview(null)}
                disabled={Boolean(busy)}
              >
                Back
              </Button>
              <Button size="sm" onClick={doImport} disabled={Boolean(busy)}>
                Import {preview.length}
              </Button>
            </div>
          </>
        ) : (
          <>
            {automatic > 0 && (
              <p className="text-muted-foreground text-xs">
                {automatic} automatic tag{automatic === 1 ? " is" : "s are"}{" "}
                hidden: Zotero adds them from publishers' data and importers,
                not you.
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tags…"
                  className="h-7 pl-7 text-xs"
                />
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={onlyFree}
                  onChange={(e) => setOnlyFree(e.target.checked)}
                />
                Not in the vault yet
              </label>
            </div>
            <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
              {rows.map((r) => {
                const pick = picked.get(r.tag);
                const free = r.status.state === "free";
                return (
                  <li
                    key={r.tag}
                    className="rounded-md px-2 py-1.5 hover:bg-muted/60"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-3.5 shrink-0 accent-primary"
                        checked={Boolean(pick)}
                        disabled={!free}
                        onChange={() => toggle(r.tag)}
                        aria-label={`Import ${r.tag}`}
                      />
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-xs"
                        title={r.tag}
                      >
                        {r.tag}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                        {r.count}
                      </span>
                      <span className="w-48 shrink-0 truncate text-right text-xs">
                        {r.status.state === "linked" ? (
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => {
                              const name =
                                r.status.state === "linked"
                                  ? r.status.note.name
                                  : "";
                              close();
                              useVaultStore.getState().open(name);
                            }}
                          >
                            → {r.status.note.name}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {pick && (
                      <div className="mt-1 flex items-center gap-2 pl-6">
                        {newType?.tag === r.tag ? (
                          <form
                            className="flex items-center gap-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              makeType(r.tag, newType.label);
                            }}
                          >
                            <Input
                              autoFocus
                              value={newType.label}
                              onChange={(e) =>
                                setNewType({
                                  tag: r.tag,
                                  label: e.target.value,
                                })
                              }
                              placeholder="Type name, e.g. Method"
                              className="h-7 w-40 text-xs"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              className="h-7 text-xs"
                            >
                              Add type
                            </Button>
                          </form>
                        ) : (
                          <select
                            value={pick.kind}
                            onChange={(e) =>
                              e.target.value === NEW_TYPE
                                ? setNewType({ tag: r.tag, label: "" })
                                : setPick(r.tag, { kind: e.target.value })
                            }
                            className="h-7 rounded-md border bg-background px-1.5 text-xs"
                            aria-label="Type of note"
                          >
                            {types.map((t) => (
                              <option key={t.kind} value={t.kind}>
                                {t.label}
                              </option>
                            ))}
                            <option value={NEW_TYPE}>New type…</option>
                          </select>
                        )}
                        <span
                          className="min-w-0 flex-1 truncate text-xs"
                          title="The note's name: the tag's name, without characters a file name can't hold"
                        >
                          → {pick.name}
                        </span>
                        {r.count >= BIG_TAG && (
                          <span className="shrink-0 text-amber-700 text-xs dark:text-amber-400">
                            {r.count} items
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li className="py-6 text-center text-muted-foreground text-xs">
                  No tags to show.
                </li>
              )}
            </ul>
            <div className="shrink-0 space-y-1.5 border-t pt-2 text-xs">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-primary"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                <span>
                  <span className="font-medium">
                    Zotero → vault, automatically
                  </span>
                  <span className="block text-muted-foreground">
                    Papers tagged “{vaultTag}” get a note that follows their
                    highlights; tags written “type: name” (such as “idea: …”)
                    get their note. Runs while Latex4All is open. Off if another
                    tool syncs Zotero into this vault.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                />
                Update paired notes as you tag in Zotero
                <span className="text-muted-foreground">
                  (only the vault is written)
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={registry}
                  onChange={(e) => setRegistry(e.target.checked)}
                />
                Notes of these types become tags in Zotero
                <span className="text-muted-foreground">
                  (adds one note to your Zotero library)
                </span>
              </label>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex-1 text-muted-foreground text-xs">
                {busy ??
                  (choices.length
                    ? `${choices.length} chosen`
                    : "Tick the tags to bring into the vault")}
              </span>
              <Button
                size="sm"
                disabled={choices.length === 0 || Boolean(busy)}
                onClick={doPreview}
              >
                Preview
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
