import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  TagsIcon,
} from "lucide-react";
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
import { papersFolderOf } from "@/lib/vault/add-paper";
import { detectedKindFolder } from "@/lib/vault/kind-folders";
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
  SYNC_STATE_PATH,
  syncVaultWithZotero,
  useVaultSync,
} from "@/lib/vault/zotero-sync/run";
import {
  BIG_TAG,
  noteNameFor,
  parseTag,
  type TagType,
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

export const useTagManager = create<{
  open: boolean;
  show: () => void;
  close: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

const STEPS = ["Papers", "Note types", "Your tags", "Sync"] as const;
const COLORS = ["#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

/**
 * Setting up the Zotero → vault sync, a step at a time: the vault tag and
 * the papers folder; the note types and their Zotero tag words; which of
 * your Zotero tags pair with which notes; and turning the sync on.
 */
export function TagManagerDialog() {
  const open = useTagManager((s) => s.open);
  const close = useTagManager((s) => s.close);
  const connected = useZoteroStore((s) => Boolean(s.apiKey));
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) void useVaultStore.getState().ensureVault();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TagsIcon className="size-4" />
            Tag manager
          </DialogTitle>
          <DialogDescription>
            Sets up the Zotero sync: which papers get notes, which Zotero tags
            make which notes, and when it runs. Only the vault is written.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex shrink-0 gap-1 text-xs">
          {STEPS.map((name, i) => (
            <li key={name} className="flex-1">
              <button
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "w-full rounded-md border px-2 py-1 text-left",
                  i === step
                    ? "border-primary bg-primary/10 font-medium"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {i + 1}. {name}
              </button>
            </li>
          ))}
        </ol>

        {!connected ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            Connect Zotero in Settings → Zotero first.
          </p>
        ) : step === 0 ? (
          <PapersStep />
        ) : step === 1 ? (
          <TypesStep />
        ) : step === 2 ? (
          <TagsStep open={open} />
        ) : (
          <SyncStep />
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t pt-2">
          {step > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button size="sm" onClick={close}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

function PapersStep() {
  const paperTag = useVaultStore((s) => s.paperTag);
  const papersFolder = useVaultStore((s) => s.papersFolder);
  const index = useVaultStore((s) => s.index);
  const { setPaperTag, setPapersFolder } = useVaultStore.getState();
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto text-sm">
      <div className="space-y-1">
        <span className="font-medium">Vault tag in Zotero</span>
        <FieldInput
          label="Vault tag in Zotero"
          value={paperTag}
          placeholder="obsidian"
          onSave={setPaperTag}
          className="w-60"
        />
        <p className="text-muted-foreground text-xs">
          A paper with this tag gets a note, tagged from any Zotero app. A paper
          also gets one when one of its highlights has a note type's tag (next
          step).
        </p>
      </div>
      <div className="space-y-1">
        <span className="font-medium">Papers folder</span>
        <FieldInput
          label="Papers folder"
          value={papersFolder}
          placeholder={papersFolderOf(index, "")}
          onSave={setPapersFolder}
          className="w-60"
        />
        <p className="text-muted-foreground text-xs">
          Where paper notes are written. A note moved elsewhere in the vault is
          still found and updated where it is.
        </p>
      </div>
      <div className="space-y-1 text-xs">
        <span className="font-medium text-sm">What a paper note has</span>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>
            The paper's details, its highlights (with your comments under each),
            ink, images and Zotero notes, between the{" "}
            <code>%% begin zotero %%</code> markers.
          </li>
          <li>
            Links to its topics, ideas and the notes of your types, from the
            tags on its highlights.
          </li>
          <li>
            A “My notes” section and frontmatter fields of your own, which the
            sync leaves as they are.
          </li>
        </ul>
      </div>
    </div>
  );
}

function TypesStep() {
  const custom = useNoteTypes();
  // Read through chosenKindFolders(); subscribed to, to show changes.
  useVaultStore((s) => s.kindFolders);
  const { setKindFolder, updateNoteType, addNoteType } =
    useVaultStore.getState();
  const [label, setLabel] = useState("");
  const [word, setWord] = useState("");

  const add = () => {
    const name = label.trim();
    if (!name) return;
    const tagWord = (word.trim() || name).toLowerCase();
    const id = addNoteType(name, COLORS[custom.length % COLORS.length]);
    updateNoteType(id, {
      zoteroTag: tagWord,
      folder: name.endsWith("s") ? name : `${name}s`,
      tag: tagWord,
    });
    setLabel("");
    setWord("");
  };

  const row = (
    key: string,
    name: string,
    tagCell: React.ReactNode,
    folder: string,
    placeholder: string,
    saveFolder: (f: string) => void,
  ) => (
    <tr key={key} className="border-t">
      <td className="py-1.5 pr-2">{name}</td>
      <td className="py-1.5 pr-2">{tagCell}</td>
      <td className="py-1.5">
        <FieldInput
          label={`${name} folder`}
          value={folder}
          placeholder={placeholder}
          onSave={saveFolder}
        />
      </td>
    </tr>
  );
  const chosen = (kind: string) => chosenKindFolders()[kind] ?? "";

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
      <p className="text-muted-foreground text-xs">
        A highlight or paper tagged <code>word: name</code> in Zotero goes in
        the note <i>name</i> of the type with that word, made if it isn't there.
        The paper's note links to it.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-normal">Type</th>
            <th className="pb-1 font-normal">Zotero tag</th>
            <th className="pb-1 font-normal">Folder</th>
          </tr>
        </thead>
        <tbody>
          {row(
            "topic",
            "Topic",
            <code>topic: name</code>,
            chosen("topic"),
            detectedKindFolder("topic") || "Topics",
            (f) => setKindFolder("topic", f),
          )}
          {row(
            "idea",
            "Idea",
            <code>idea: name</code>,
            chosen("idea"),
            detectedKindFolder("idea") || "Ideas",
            (f) => setKindFolder("idea", f),
          )}
          {custom.map((t) =>
            row(
              t.id,
              t.label,
              <span className="flex items-center gap-1">
                <FieldInput
                  label={`${t.label} Zotero tag word`}
                  value={t.zoteroTag ?? ""}
                  placeholder="none"
                  onSave={(w) =>
                    updateNoteType(t.id, { zoteroTag: w.trim() || undefined })
                  }
                  className="w-24"
                />
                {t.zoteroTag?.trim() && (
                  <code className="text-muted-foreground">: name</code>
                )}
              </span>,
              t.folder ?? "",
              t.label,
              (f) => updateNoteType(t.id, { folder: f.trim() || undefined }),
            ),
          )}
        </tbody>
      </table>
      <p className="text-muted-foreground text-xs">
        A highlight tagged just <code>idea</code> makes an idea note named after
        its comment; it follows the comment until you edit the note.
      </p>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="New type, e.g. Method"
          className="h-7 w-44 text-xs"
        />
        <Input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={label.trim().toLowerCase() || "Zotero tag word"}
          className="h-7 w-36 text-xs"
        />
        <Button
          type="submit"
          size="sm"
          className="h-7 text-xs"
          disabled={!label.trim()}
        >
          Add type
        </Button>
      </form>
    </div>
  );
}

interface Pick {
  kind: string;
  name: string;
}

function TagsStep({ open }: { open: boolean }) {
  const index = useVaultStore((s) => s.index);
  const custom = useNoteTypes();
  const types = useMemo(() => tagTypes(custom), [custom]);
  const [tags, setTags] = useState<ZoteroTag[] | null>(null);
  const [automatic, setAutomatic] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Map<string, Pick>>(new Map());
  const [preview, setPreview] = useState<ImportPreview[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    setPreview(null);
    setError(null);
    listZoteroTags()
      .then((r) => {
        setTags(r.tags);
        setAutomatic(r.automatic);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, [open]);

  const rows = useMemo(() => {
    if (!tags || !index) return [];
    const q = query.trim().toLowerCase();
    return tags
      .filter((t) => !q || t.tag.toLowerCase().includes(q))
      .map((t) => ({
        ...t,
        status: tagStatus(t.tag, index),
        typed: parseTag(t.tag, types),
      }));
  }, [tags, index, types, query]);

  const typeOf = (kind: string): TagType | undefined =>
    types.find((t) => t.kind === kind);
  const toggle = (tag: string) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(tag)) n.delete(tag);
      else n.set(tag, { kind: "topic", name: noteNameFor(tag, types) });
      return n;
    });
  const setKind = (tag: string, kind: string) =>
    setPicked((m) => {
      const cur = m.get(tag);
      return cur ? new Map(m).set(tag, { ...cur, kind }) : m;
    });

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
          ? `“${made[0]}” is paired`
          : `${made.length} notes paired`,
      );
      setPreview(null);
      setPicked(new Map());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (error)
    return <p className="py-6 text-center text-destructive text-sm">{error}</p>;
  if (!tags || !index)
    return (
      <p className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        Reading your tags…
      </p>
    );

  if (preview)
    return (
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
                    {existing ? " — your note of that name" : " — a new note"}
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
                  {members.papers.length} paper
                  {members.papers.length === 1 ? "" : "s"}
                  {" · "}
                  {members.passages.length} highlight
                  {members.passages.length === 1 ? "" : "s"}
                  {big && " — each paper gets a note"}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex-1 text-muted-foreground text-xs">{busy}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreview(null)}
            disabled={Boolean(busy)}
          >
            Back to tags
          </Button>
          <Button size="sm" onClick={doImport} disabled={Boolean(busy)}>
            Pair {preview.length}
          </Button>
        </div>
      </>
    );

  return (
    <>
      <p className="text-muted-foreground text-xs">
        Tags written <code>word: name</code> for a type are synced as they are.
        Any other tag can be paired with a note: its papers and highlights go in
        that note.
        {automatic > 0 &&
          ` ${automatic} automatic tag${automatic === 1 ? " is" : "s are"} hidden (Zotero adds them from publishers' data and importers).`}
      </p>
      <div className="relative shrink-0">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          className="h-7 pl-7 text-xs"
        />
      </div>
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {rows.map((r) => {
          const pick = picked.get(r.tag);
          const linked = r.status.state === "linked" ? r.status.note : null;
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
                  disabled={Boolean(linked || r.typed)}
                  onChange={() => toggle(r.tag)}
                  aria-label={`Pair ${r.tag}`}
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
                  {linked ? (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => {
                        useTagManager.getState().close();
                        useVaultStore.getState().open(linked.name);
                      }}
                    >
                      → {linked.name}
                    </button>
                  ) : r.typed ? (
                    <span className="text-muted-foreground">
                      {r.typed.type.label}: {r.typed.name}
                    </span>
                  ) : null}
                </span>
              </div>
              {pick && (
                <div className="mt-1 flex items-center gap-2 pl-6">
                  <select
                    value={pick.kind}
                    onChange={(e) => setKind(r.tag, e.target.value)}
                    className="h-7 rounded-md border bg-background px-1.5 text-xs"
                    aria-label="Type of note"
                  >
                    {types.map((t) => (
                      <option key={t.kind} value={t.kind}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    → {pick.name}
                  </span>
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
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex-1 text-muted-foreground text-xs">
          {busy ?? (choices.length ? `${choices.length} chosen` : "")}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={choices.length === 0 || Boolean(busy)}
          onClick={doPreview}
        >
          Preview
        </Button>
      </div>
    </>
  );
}

function SyncStep() {
  const on = useSettingsStore((s) => s.zoteroAutoVault);
  const setOn = useSettingsStore((s) => s.setZoteroAutoVault);
  const registry = useSettingsStore((s) => s.zoteroTagRegistry);
  const setRegistry = useSettingsStore((s) => s.setZoteroTagRegistry);
  const vaultTag = useVaultStore((s) => s.paperTag || "obsidian");
  const { running, last, error } = useVaultSync();

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto text-sm">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-3.5 accent-primary"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
        <span>
          <span className="font-medium">Sync Zotero into the vault</span>
          <span className="block text-muted-foreground text-xs">
            Papers tagged “{vaultTag}”, and tags of your note types, get their
            notes, kept up to date. Runs while Latex4All is open: at start, when
            Zotero changes, and every minute. Only notes that changed are
            written.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={running}
          onClick={() =>
            syncVaultWithZotero().catch((err) =>
              toast.error(err instanceof Error ? err.message : String(err)),
            )
          }
        >
          {running ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          Sync now
        </Button>
        <span
          className={cn(error ? "text-destructive" : "text-muted-foreground")}
        >
          {running
            ? "Syncing… The first sync reads the whole library."
            : error
              ? error
              : last
                ? `Synced at ${new Date(last.at).toLocaleTimeString()}: ${last.written} note${last.written === 1 ? "" : "s"} written`
                : null}
        </span>
        {!running && !error && last && (
          <CheckIcon className="size-3.5 text-emerald-600" />
        )}
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-3.5 accent-primary"
          checked={registry}
          onChange={(e) => setRegistry(e.target.checked)}
        />
        <span>
          <span className="font-medium">
            Notes of these types become tags in Zotero
          </span>
          <span className="block text-muted-foreground text-xs">
            So they can be picked when tagging in Zotero. Adds one note to your
            Zotero library.
          </span>
        </span>
      </label>

      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground text-xs">
        <li>
          What the sync remembers about the vault (which note is whose, what you
          deleted) is in <code>{SYNC_STATE_PATH}</code>, so every computer
          syncing the vault agrees.
        </li>
        <li>A note deleted in Obsidian isn't made again.</li>
        <li>
          If another Zotero sync writes to this vault, run one of the two.
        </li>
      </ul>
    </div>
  );
}
