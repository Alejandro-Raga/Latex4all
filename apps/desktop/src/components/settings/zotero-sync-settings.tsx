import { useEffect, useMemo, useState } from "react";
import { Loader2Icon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { papersFolderOf } from "@/lib/vault/add-paper";
import { detectedKindFolder } from "@/lib/vault/kind-folders";
import {
  listZoteroTags,
  previewImport,
  runImport,
  tagStatus,
  unpairTag,
  type ZoteroTag,
} from "@/lib/vault/tag-import";
import { syncVaultWithZotero, useVaultSync } from "@/lib/vault/zotero-sync/run";
import {
  noteNameFor,
  pairedTag,
  parseTag,
  tagTypes,
} from "@/lib/vault/zotero-tag-notes";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  chosenKindFolders,
  useNoteTypes,
  useVaultStore,
} from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { SettingRow, Toggle } from "./settings-parts";

/** "a topic", "an idea". */
const article = (label: string) =>
  `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label.toLowerCase()}`;

const COLORS = ["#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

/** A text field saved when you leave it, so it isn't trimmed as you type. */
function FieldInput({
  value,
  onSave,
  placeholder,
  className,
  label,
}: {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      placeholder={placeholder}
      aria-label={label}
      className={cn("h-7 text-xs", className)}
    />
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div className="px-5 pt-5 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
    {children}
  </div>
);

const Tag = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
    {children}
  </code>
);

/** Settings → Zotero sync: how to use it, and its settings. */
export function ZoteroSyncSettings() {
  const connected = useZoteroStore((s) => Boolean(s.apiKey));
  const vaultReady = useVaultStore((s) => Boolean(s.source));
  const paperTag = useVaultStore((s) => s.paperTag || "obsidian");
  const papersFolder = useVaultStore((s) => s.papersFolder);
  const index = useVaultStore((s) => s.index);
  const { setPaperTag, setPapersFolder } = useVaultStore.getState();
  const [pairing, setPairing] = useState(false);
  const ignored = useVaultStore((s) => s.ignoredTags.length);
  const paired = useMemo(
    () => (index?.list ?? []).filter((n) => pairedTag(n)).length,
    [index],
  );

  useEffect(() => {
    void useVaultStore.getState().ensureVault();
  }, []);

  return (
    <div className="pb-4">
      <div className="space-y-2 border-border/60 border-b px-5 py-4 text-sm">
        <p>
          Tag papers and highlights in Zotero, on any device, and Latex4All
          writes the notes in your vault.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            Tag a paper <Tag>{paperTag}</Tag> to give it a note, with its
            highlights and your comments.
          </li>
          <li>
            Tag a paper or highlight <Tag>topic: Name</Tag> or{" "}
            <Tag>idea: Name</Tag> to add it to that topic or idea. The note is
            created the first time.
          </li>
          <li>
            Tag a highlight <Tag>idea</Tag> and write a comment on it: the
            comment becomes a new idea.
          </li>
        </ol>
        {(!connected || !vaultReady) && (
          <p className="text-amber-700 text-xs dark:text-amber-400">
            {!connected
              ? "Connect Zotero first, in the Zotero section."
              : "Choose your vault first, in the Vault section."}
          </p>
        )}
      </div>

      <SyncRow />

      <Heading>Papers</Heading>
      <div className="divide-y divide-border/60">
        <SettingRow
          label="Vault tag"
          detail="Papers with this tag in Zotero get a note"
        >
          <FieldInput
            label="Vault tag"
            value={paperTag}
            placeholder="obsidian"
            onSave={setPaperTag}
            className="w-44"
          />
        </SettingRow>
        <SettingRow label="Folder" detail="Where paper notes are written">
          <FieldInput
            label="Papers folder"
            value={papersFolder}
            placeholder={papersFolderOf(index, "")}
            onSave={setPapersFolder}
            className="w-44"
          />
        </SettingRow>
      </div>

      <Heading>Tags that make notes</Heading>
      <p className="px-5 pb-2 text-muted-foreground text-xs">
        In Zotero, write the word, a colon and the note's name.
      </p>
      <NoteKinds />

      <Heading>Your Zotero tags</Heading>
      <div className="divide-y divide-border/60">
        <SettingRow
          label="Choose which tags make notes"
          detail={
            [
              paired ? `${paired} paired with a note` : "",
              ignored ? `${ignored} stopped` : "",
            ]
              .filter(Boolean)
              .join(", ") ||
            "Stop a tag you no longer want notes from, or pair one you already use with a note"
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled={!connected}
            onClick={() => setPairing(true)}
          >
            Open…
          </Button>
        </SettingRow>
      </div>

      <ul className="mt-4 space-y-1 px-5 text-muted-foreground text-xs">
        <li>Your Zotero library is only read, never changed.</li>
        <li>What you write in a note outside its Zotero part is kept.</li>
        <li>With the vault on more than one computer, one of them syncs.</li>
      </ul>

      <TagsDialog open={pairing} onOpenChange={setPairing} />
    </div>
  );
}

function SyncRow() {
  const on = useSettingsStore((s) => s.zoteroAutoVault);
  const setOn = useSettingsStore((s) => s.setZoteroAutoVault);
  const connected = useZoteroStore((s) => Boolean(s.apiKey));
  const { running, last, error } = useVaultSync();
  const run = (takeOver = false) =>
    syncVaultWithZotero({ takeOver }).catch((err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
    );

  const status = running
    ? "Syncing…"
    : error
      ? error
      : last?.elsewhere
        ? `Another computer (${last.elsewhere}) is syncing this vault`
        : last
          ? `Last synced at ${new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, ${last.written} note${last.written === 1 ? "" : "s"} updated`
          : on
            ? "Every minute while Latex4All is open"
            : "Off";

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="font-medium text-sm">Sync</div>
        <div
          className={cn(
            "truncate text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {last?.elsewhere && !running && (
          <Button variant="ghost" size="sm" onClick={() => run(true)}>
            Sync here
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={running || !connected}
          onClick={() => run()}
          title="Sync now"
        >
          {running ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          Now
        </Button>
        <Toggle
          checked={on}
          onChange={setOn}
          label="Sync Zotero into the vault"
        />
      </div>
    </div>
  );
}

/** Topics, ideas and your own kinds of note: their tag word and folder. */
function NoteKinds() {
  const custom = useNoteTypes();
  useVaultStore((s) => s.kindFolders);
  const { setKindFolder, updateNoteType, addNoteType } =
    useVaultStore.getState();
  const [name, setName] = useState("");

  const add = () => {
    const label = name.trim();
    if (!label) return;
    const word = label.toLowerCase();
    const id = addNoteType(label, COLORS[custom.length % COLORS.length]);
    updateNoteType(id, {
      zoteroTag: word,
      tag: word,
      folder: label.endsWith("s") ? label : `${label}s`,
    });
    setName("");
  };

  const row = (
    key: string,
    label: string,
    word: React.ReactNode,
    folder: React.ReactNode,
  ) => (
    <div key={key} className="flex items-center gap-3 px-5 py-2">
      <span className="w-24 shrink-0 truncate text-sm">{label}</span>
      <span className="flex w-44 shrink-0 items-center gap-1">{word}</span>
      <span className="min-w-0 flex-1">{folder}</span>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 px-5 pb-1 text-[11px] text-muted-foreground">
        <span className="w-24 shrink-0">Note</span>
        <span className="w-44 shrink-0">Zotero tag</span>
        <span className="min-w-0 flex-1">Folder</span>
      </div>
      {(["topic", "idea"] as const).map((kind) =>
        row(
          kind,
          kind === "topic" ? "Topic" : "Idea",
          <Tag>{kind}: Name</Tag>,
          <FieldInput
            label={`${kind} folder`}
            value={chosenKindFolders()[kind] ?? ""}
            placeholder={
              detectedKindFolder(kind) ||
              (kind === "topic" ? "Topics" : "Ideas")
            }
            onSave={(f) => setKindFolder(kind, f)}
            className="w-full"
          />,
        ),
      )}
      {custom.map((t) =>
        row(
          t.id,
          t.label,
          <>
            <FieldInput
              label={`${t.label} tag word`}
              value={t.zoteroTag ?? ""}
              placeholder="word"
              onSave={(w) =>
                updateNoteType(t.id, {
                  zoteroTag: w.replace(/:\s*$/, "").trim() || undefined,
                })
              }
              className="w-24 font-mono"
            />
            <span className="font-mono text-muted-foreground text-xs">
              : Name
            </span>
          </>,
          <FieldInput
            label={`${t.label} folder`}
            value={t.folder ?? ""}
            placeholder={t.label}
            onSave={(f) =>
              updateNoteType(t.id, { folder: f.trim() || undefined })
            }
            className="w-full"
          />,
        ),
      )}
      <form
        className="flex items-center gap-2 px-5 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Another kind of note, e.g. Method"
          aria-label="New kind of note"
          className="h-7 w-64 text-xs"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={!name.trim()}
        >
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </form>
    </div>
  );
}

type TagFilter = "all" | "synced" | "stopped";

/**
 * Your Zotero tags and what the sync does with each: tags written
 * "word: name" make notes, others can be paired with a note, and any of
 * them can be stopped (its notes stay; no more are made or filled from it).
 */
function TagsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const index = useVaultStore((s) => s.index);
  const ignoredTags = useVaultStore((s) => s.ignoredTags);
  const vaultTag = useVaultStore((s) => s.paperTag || "obsidian");
  const custom = useNoteTypes();
  const types = useMemo(() => tagTypes(custom), [custom]);
  const [tags, setTags] = useState<ZoteroTag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TagFilter>("all");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    setError(null);
    listZoteroTags()
      .then((r) => setTags(r.tags))
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, [open]);

  const rows = useMemo(() => {
    if (!tags || !index) return [];
    const q = query.trim().toLowerCase();
    const stopped = new Set(ignoredTags);
    return tags
      .filter((t) => !q || t.tag.toLowerCase().includes(q))
      .map((t) => {
        const status = tagStatus(t.tag, index);
        const own =
          t.tag.toLowerCase() === vaultTag.toLowerCase()
            ? "vault"
            : t.tag.toLowerCase() === "idea"
              ? "idea"
              : null;
        return {
          ...t,
          own,
          linked: status.state === "linked" ? status.note : null,
          typed: parseTag(t.tag, types),
          stopped: stopped.has(t.tag),
        };
      })
      .filter((r) =>
        filter === "stopped"
          ? r.stopped
          : filter === "synced"
            ? !r.stopped && Boolean(r.own || r.linked || r.typed)
            : true,
      );
  }, [tags, index, types, query, filter, ignoredTags, vaultTag]);

  const stop = (tag: string, on: boolean) => {
    useVaultStore.getState().ignoreTag(tag, on);
    if (useSettingsStore.getState().zoteroAutoVault)
      void syncVaultWithZotero().catch(() => null);
  };

  const pair = async () => {
    setBusy(true);
    try {
      const choices = [...picked].flatMap(([tag, kind]) => {
        const type = types.find((t) => t.kind === kind);
        return type ? [{ tag, type, name: noteNameFor(tag, types) }] : [];
      });
      const made = await runImport(await previewImport(choices));
      toast.success(
        made.length === 1
          ? `“${made[0]}” is paired`
          : `${made.length} tags paired`,
      );
      setPicked(new Map());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const action = "h-7 shrink-0 px-2 text-xs";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Your Zotero tags</DialogTitle>
          <DialogDescription>
            Tags like <Tag>topic: Name</Tag> make notes on their own. Tick any
            other tag to pair it with a note. Stop a tag to make no more notes
            from it; the notes you have stay.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-6 text-center text-destructive text-sm">{error}</p>
        ) : !tags || !index ? (
          <p className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            Reading your tags…
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tags"
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <div className="flex shrink-0 rounded-md border p-0.5 text-xs">
                {(["all", "synced", "stopped"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded px-2.5 py-1 capitalize",
                      filter === f
                        ? "bg-muted font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
              {rows.map((r) => {
                const kind = picked.get(r.tag);
                const free = !r.own && !r.stopped && !r.linked && !r.typed;
                return (
                  <li
                    key={r.tag}
                    className="flex h-10 items-center gap-2.5 rounded-md px-2 hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className={cn(
                        "size-3.5 shrink-0 accent-primary",
                        !free && "invisible",
                      )}
                      checked={Boolean(kind)}
                      disabled={!free}
                      onChange={() =>
                        setPicked((m) => {
                          const n = new Map(m);
                          if (n.has(r.tag)) n.delete(r.tag);
                          else n.set(r.tag, "topic");
                          return n;
                        })
                      }
                      aria-label={`Pair ${r.tag}`}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        r.stopped && "text-muted-foreground line-through",
                      )}
                      title={r.tag}
                    >
                      {r.tag}
                    </span>
                    <span className="w-8 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                      {r.count}
                    </span>
                    <span className="flex w-60 shrink-0 items-center justify-end gap-1.5 text-xs">
                      {r.own === "vault" ? (
                        <span className="text-muted-foreground">
                          Puts papers in the vault
                        </span>
                      ) : r.stopped ? (
                        <>
                          <span className="text-muted-foreground">Stopped</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={action}
                            onClick={() => stop(r.tag, false)}
                          >
                            Resume
                          </Button>
                        </>
                      ) : r.linked ? (
                        <>
                          <span className="truncate text-muted-foreground">
                            In “{r.linked.name}”
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={action}
                            onClick={() => {
                              const note = r.linked;
                              if (note)
                                void unpairTag(note).catch((err) =>
                                  toast.error(String(err)),
                                );
                            }}
                          >
                            Unpair
                          </Button>
                        </>
                      ) : r.own === "idea" ? (
                        <>
                          <span className="truncate text-muted-foreground">
                            Makes ideas from comments
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={action}
                            onClick={() => stop(r.tag, true)}
                          >
                            Stop
                          </Button>
                        </>
                      ) : r.typed ? (
                        <>
                          <span className="truncate text-muted-foreground">
                            Makes {article(r.typed.type.label)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={action}
                            onClick={() => stop(r.tag, true)}
                          >
                            Stop
                          </Button>
                        </>
                      ) : kind ? (
                        <select
                          value={kind}
                          onChange={(e) =>
                            setPicked((m) =>
                              new Map(m).set(r.tag, e.target.value),
                            )
                          }
                          className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs"
                          aria-label={`Kind of note for ${r.tag}`}
                        >
                          {types.map((t) => (
                            <option key={t.kind} value={t.kind}>
                              Pair with {article(t.label)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </span>
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li className="py-6 text-center text-muted-foreground text-sm">
                  No tags here.
                </li>
              )}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-muted-foreground text-xs">
                Tags Zotero added on its own aren't listed.
              </span>
              <Button
                size="sm"
                disabled={picked.size === 0 || busy}
                onClick={pair}
              >
                {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                Pair {picked.size > 0 ? picked.size : ""}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
