import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { join } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  Loader2Icon,
  NotebookTextIcon,
  QuoteIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { citeKeyAtCursor } from "@/lib/vault/cite-at-cursor";
import { findObsidianVaults, type KnownVault } from "@/lib/vault/load";
import { listField } from "@/lib/vault/parse";
import { EMBED_SRC, noteFromHref, vaultMarkdown } from "@/lib/vault/render";
import {
  findNote,
  type NoteKind,
  neighbourhood,
  searchNotes,
  type VaultIndex,
  type VaultNote,
} from "@/lib/vault/vault-index";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

const REFRESH_MS = 30_000;

const KIND_LABEL: Record<NoteKind, string> = {
  paper: "Papers",
  idea: "Ideas",
  topic: "Topics",
  note: "Notes",
};

/** Dot and graph colours per kind of note. */
const KIND_COLOR: Record<NoteKind, string> = {
  paper: "#3b82f6",
  idea: "#f59e0b",
  topic: "#10b981",
  note: "#94a3b8",
};

const vaultName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function noteSubtitle(note: VaultNote): string {
  if (note.kind === "paper") {
    const [author] = listField(note.frontmatter, "authors");
    const year = note.frontmatter.year;
    return [author?.split(" ").pop(), year].filter(Boolean).join(" · ");
  }
  const links = note.outgoing.length + note.incoming.length;
  return links ? `${links} link${links === 1 ? "" : "s"}` : "";
}

/**
 * The paper note for a citation key, via the Zotero item behind the
 * project's .bib entries, or failing that by name (`Nelson1959`) or by
 * author and year (`nelson_simple_1959`).
 */
function noteForCitekey(
  index: VaultIndex,
  key: string,
  itemKeyByCitekey: Map<string, string>,
): VaultNote | undefined {
  const itemKey = itemKeyByCitekey.get(key);
  const papers = index.list.filter((n) => n.kind === "paper");
  if (itemKey) {
    const byItem = papers.find((n) => n.zoteroKey === itemKey);
    if (byItem) return byItem;
  }
  const lower = key.toLowerCase();
  const byName = papers.find(
    (n) => n.name.toLowerCase() === lower || n.citekey?.toLowerCase() === lower,
  );
  if (byName) return byName;
  const year = lower.match(/(1[5-9]|20)\d\d/)?.[0];
  if (!year) return undefined;
  return papers.find((n) => {
    const [author] = listField(n.frontmatter, "authors");
    const last = author
      ?.split(" ")
      .pop()
      ?.normalize("NFKD")
      .replace(/[^A-Za-z]/g, "")
      .toLowerCase();
    return (
      last && String(n.frontmatter.year) === year && lower.startsWith(last)
    );
  });
}

/** Zotero item keys by the citation keys this project's .bib files use. */
function useItemKeyByCitekey(): Map<string, string> {
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

/** The citation key under the editor's cursor, if any. */
function useCiteKeyAtCursor(): string | null {
  const cursor = useDocumentStore((s) => s.cursorPosition);
  const content = useDocumentStore(
    (s) => s.files.find((f) => f.id === s.activeFileId)?.content,
  );
  return useMemo(
    () => (content ? citeKeyAtCursor(content, cursor) : null),
    [content, cursor],
  );
}

export function VaultPanel({ onClose }: { onClose: () => void }) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const index = useVaultStore((s) => s.index);
  const loading = useVaultStore((s) => s.loading);
  const error = useVaultStore((s) => s.error);
  const current = useVaultStore((s) => s.current);
  const history = useVaultStore((s) => s.history);
  const { ensureVault, reload, open, back, showList } =
    useVaultStore.getState();
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    ensureVault().finally(() => setSearched(true));
    // Notes change while you work (Obsidian, the Zotero sync); keep up.
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [ensureVault, reload]);

  const note = index && current ? findNote(index, current) : undefined;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] shrink-0 items-center gap-1.5 border-border border-b px-3 pt-[var(--titlebar-height)]">
        {current ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => (history.length ? back() : showList())}
            title="Back"
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-3.5" />
          </Button>
        ) : (
          <NotebookTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <VaultMenu
          label={note ? note.name : vaultPath ? vaultName(vaultPath) : "Vault"}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          title="Close"
          aria-label="Close vault"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <CursorCitation onOpen={open} />

      {!vaultPath ? (
        <div className="space-y-3 p-4 text-center text-muted-foreground text-xs">
          <p>
            {searched ? "No Obsidian vault found." : "Looking for your vault…"}
          </p>
          {searched && <ChooseFolderButton />}
        </div>
      ) : loading && !index ? (
        <div className="flex items-center gap-2 p-4 text-muted-foreground text-xs">
          <Loader2Icon className="size-3.5 animate-spin" />
          Reading vault…
        </div>
      ) : error && !index ? (
        <p className="p-4 text-destructive text-xs">{error}</p>
      ) : index && note ? (
        <NoteView index={index} note={note} onOpen={open} />
      ) : index && current ? (
        <p className="p-4 text-muted-foreground text-xs">
          “{current}” isn't in the vault yet.
        </p>
      ) : index ? (
        <NoteList index={index} onOpen={open} />
      ) : null}
    </div>
  );
}

function ChooseFolderButton() {
  const setVaultPath = useVaultStore((s) => s.setVaultPath);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const selected = await openDialog({ directory: true, multiple: false });
        if (typeof selected === "string") setVaultPath(selected);
      }}
    >
      <FolderOpenIcon className="size-3.5" />
      Choose vault folder…
    </Button>
  );
}

function VaultMenu({ label }: { label: string }) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const setVaultPath = useVaultStore((s) => s.setVaultPath);
  const [vaults, setVaults] = useState<KnownVault[]>([]);

  return (
    <DropdownMenu
      onOpenChange={(isOpen) => {
        if (isOpen) findObsidianVaults().then(setVaults);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left font-medium text-sm hover:bg-muted"
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {vaults.map((v) => (
          <DropdownMenuItem key={v.path} onSelect={() => setVaultPath(v.path)}>
            <CheckIcon
              className={cn("size-3.5", v.path !== vaultPath && "invisible")}
            />
            <span className="truncate">{v.name}</span>
          </DropdownMenuItem>
        ))}
        {vaults.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onSelect={async () => {
            const selected = await openDialog({
              directory: true,
              multiple: false,
            });
            if (typeof selected === "string") setVaultPath(selected);
          }}
        >
          <FolderOpenIcon className="size-3.5" />
          Other folder…
        </DropdownMenuItem>
        {vaultPath && (
          <DropdownMenuItem
            onSelect={() =>
              shellOpen(
                `obsidian://open?path=${encodeURIComponent(vaultPath)}`,
              ).catch(() => toast.error("Couldn't open Obsidian."))
            }
          >
            <ExternalLinkIcon className="size-3.5" />
            Open in Obsidian
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A reminder of the paper behind the \cite{} the cursor is on. */
function CursorCitation({ onOpen }: { onOpen: (name: string) => void }) {
  const index = useVaultStore((s) => s.index);
  const current = useVaultStore((s) => s.current);
  const key = useCiteKeyAtCursor();
  const itemKeyByCitekey = useItemKeyByCitekey();
  const note =
    index && key ? noteForCitekey(index, key, itemKeyByCitekey) : undefined;
  if (!note || note.name === current) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(note.name)}
      className="flex shrink-0 items-center gap-2 border-border border-b bg-muted/40 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
    >
      <QuoteIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{key} · </span>
        {note.title}
      </span>
    </button>
  );
}

function NoteList({
  index,
  onOpen,
}: {
  index: VaultIndex;
  onOpen: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchNotes(index, query), [index, query]);
  const groups = useMemo(() => {
    if (query.trim()) return [{ kind: null, notes: results }];
    const byKind = new Map<NoteKind, VaultNote[]>();
    for (const n of results)
      byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);
    return [...byKind].map(([kind, notes]) => ({ kind, notes }));
  }, [results, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2.5 pt-2.5 pb-1.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-muted-foreground text-xs">
            {query ? "No matching notes" : "No notes in this vault"}
          </p>
        )}
        {groups.map(({ kind, notes }) => (
          <div key={kind ?? "results"} className="mb-2">
            {kind && (
              <p className="px-2 pt-1.5 pb-0.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                {KIND_LABEL[kind]}
                <span className="ml-1 normal-case">{notes.length}</span>
              </p>
            )}
            {notes.map((n) => (
              <button
                key={n.name}
                type="button"
                onClick={() => onOpen(n.name)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: KIND_COLOR[n.kind] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm">{n.title}</span>
                  {noteSubtitle(n) && (
                    <span className="block truncate text-muted-foreground text-xs">
                      {noteSubtitle(n)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteView({
  index,
  note,
  onOpen,
}: {
  index: VaultIndex;
  note: VaultNote;
  onOpen: (name: string) => void;
}) {
  const markdown = useMemo(() => {
    const md = vaultMarkdown(note.body);
    // Paper notes open with their title, already shown above.
    return note.kind === "paper" ? md.replace(/^# .*\n+/, "") : md;
  }, [note.body, note.kind]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-1 px-3 pt-3">
        {note.kind === "paper" && note.title !== note.name && (
          <p className="font-medium text-sm leading-snug">{note.title}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5 text-[11px] text-white"
            style={{ backgroundColor: KIND_COLOR[note.kind] }}
          >
            {KIND_LABEL[note.kind].slice(0, -1)}
          </span>
          {noteSubtitle(note) && (
            <span className="text-muted-foreground text-xs">
              {noteSubtitle(note)}
            </span>
          )}
          <span className="flex-1" />
          {note.kind === "paper" && <CiteButton note={note} />}
        </div>
      </div>

      <Connections index={index} note={note} onOpen={onOpen} />

      <div className="border-border border-t px-3 py-3">
        <NoteMarkdown markdown={markdown} onOpen={onOpen} />
      </div>
    </div>
  );
}

/** Adds the paper to the project's bibliography if needed, then cites it. */
function CiteButton({ note }: { note: VaultNote }) {
  const zoteroConnected = useZoteroStore((s) => s.isAuthenticated);
  const addItemToBib = useZoteroStore((s) => s.addItemToBib);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const insertAtCursor = useDocumentStore((s) => s.insertAtCursor);
  const [busy, setBusy] = useState(false);

  const cite = async () => {
    let key = note.citekey ?? note.name;
    if (note.zoteroKey && zoteroConnected && projectRoot) {
      setBusy(true);
      const result = await addItemToBib(note.zoteroKey, null);
      setBusy(false);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      key = result.citekey;
      if (result.status === "added")
        toast.success(`Added to ${result.fileName}`);
    }
    insertAtCursor(`\\cite{${key}}`);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
      disabled={busy}
      onClick={cite}
      title="Insert \cite{} at the cursor"
    >
      {busy ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <QuoteIcon className="size-3" />
      )}
      Cite
    </Button>
  );
}

function Connections({
  index,
  note,
  onOpen,
}: {
  index: VaultIndex;
  note: VaultNote;
  onOpen: (name: string) => void;
}) {
  const [depth, setDepth] = useState(1);
  const both = note.outgoing.filter((n) => note.incoming.includes(n));
  const linksTo = note.outgoing.filter((n) => !both.includes(n));
  const linkedFrom = note.incoming.filter((n) => !both.includes(n));
  if (note.outgoing.length + note.incoming.length === 0) {
    return (
      <p className="px-3 pt-2 pb-3 text-muted-foreground text-xs">
        No links yet.
      </p>
    );
  }

  return (
    <div className="px-3 pt-2 pb-3">
      <LocalGraph index={index} note={note} depth={depth} onOpen={onOpen} />
      <div className="mb-1 flex justify-end gap-0.5">
        {[1, 2].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDepth(d)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] transition-colors",
              depth === d
                ? "bg-muted font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {d === 1 ? "Direct" : "2 steps"}
          </button>
        ))}
      </div>
      <LinkGroup title="Both ways" names={both} index={index} onOpen={onOpen} />
      <LinkGroup
        title="Links to"
        names={linksTo}
        index={index}
        onOpen={onOpen}
      />
      <LinkGroup
        title="Linked from"
        names={linkedFrom}
        index={index}
        onOpen={onOpen}
      />
    </div>
  );
}

function LinkGroup({
  title,
  names,
  index,
  onOpen,
}: {
  title: string;
  names: string[];
  index: VaultIndex;
  onOpen: (name: string) => void;
}) {
  if (names.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {title}
      </p>
      {names.map((name) => {
        const n = findNote(index, name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onOpen(name)}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/60"
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: n ? KIND_COLOR[n.kind] : undefined }}
            />
            <span className="truncate">{n?.title ?? name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The note in the middle, linked notes around it; arrows point along links. */
function LocalGraph({
  index,
  note,
  depth,
  onOpen,
}: {
  index: VaultIndex;
  note: VaultNote;
  depth: number;
  onOpen: (name: string) => void;
}) {
  const { nodes, edges } = useMemo(
    () => neighbourhood(index, note.name, depth),
    [index, note.name, depth],
  );
  const W = 300;
  const H = depth === 1 ? 170 : 230;
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const rings = new Map<number, typeof nodes>();
    for (const n of nodes) rings.set(n.ring, [...(rings.get(n.ring) ?? []), n]);
    for (const [ring, members] of rings) {
      members.sort(
        (a, b) =>
          a.note.kind.localeCompare(b.note.kind) ||
          a.note.name.localeCompare(b.note.name),
      );
      members.forEach((m, i) => {
        if (ring === 0) {
          pos.set(m.note.name, { x: W / 2, y: H / 2 });
          return;
        }
        const angle =
          (i / members.length) * Math.PI * 2 - Math.PI / 2 + ring * 0.4;
        const r = ring === 1 ? (depth === 1 ? 62 : 55) : 100;
        pos.set(m.note.name, {
          x: W / 2 + Math.cos(angle) * r * 1.6,
          y: H / 2 + Math.sin(angle) * r * (depth === 1 ? 1.15 : 1),
        });
      });
    }
    return pos;
  }, [nodes, H, depth]);

  const label = (text: string) =>
    text.length > 18 ? `${text.slice(0, 17)}…` : text;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-foreground"
      role="img"
      aria-label={`Notes linked with ${note.name}`}
    >
      <defs>
        <marker
          id="vault-arrow"
          viewBox="0 0 6 6"
          refX="11"
          refY="3"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground/60" />
        </marker>
      </defs>
      {edges.map(({ from, to }) => {
        const a = positions.get(from);
        const b = positions.get(to);
        if (!a || !b) return null;
        const touchesCentre = from === note.name || to === note.name;
        return (
          <line
            key={`${from}->${to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={cn(
              "stroke-muted-foreground",
              touchesCentre ? "opacity-60" : "opacity-25",
            )}
            strokeWidth={1}
            markerEnd="url(#vault-arrow)"
          />
        );
      })}
      {nodes.map(({ note: n, ring }) => {
        const p = positions.get(n.name);
        if (!p) return null;
        const centre = ring === 0;
        return (
          <g
            key={n.name}
            role="button"
            tabIndex={0}
            className={cn(!centre && "cursor-pointer")}
            onClick={() => !centre && onOpen(n.name)}
            onKeyDown={(e) => e.key === "Enter" && !centre && onOpen(n.name)}
          >
            <title>{n.title}</title>
            <circle
              cx={p.x}
              cy={p.y}
              r={centre ? 7 : ring === 1 ? 5 : 3.5}
              fill={KIND_COLOR[n.kind]}
              className={cn(ring === 2 && "opacity-60")}
            />
            <text
              x={p.x}
              y={p.y + (centre ? 17 : 13)}
              textAnchor="middle"
              className={cn(
                "fill-current text-[9px]",
                centre ? "font-medium" : "opacity-80",
                ring === 2 && "opacity-50",
              )}
            >
              {label(n.name)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function VaultImage({ name }: { name: string }) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const relPath = useVaultStore((s) => s.attachments.get(name.toLowerCase()));
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!vaultPath || !relPath) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      const bytes = await readFile(
        await join(vaultPath, ...relPath.split("/")),
      );
      if (cancelled) return;
      const type = name.toLowerCase().endsWith(".svg")
        ? "image/svg+xml"
        : undefined;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
      setUrl(objectUrl);
    })().catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vaultPath, relPath, name]);

  if (!url) return null;
  return <img src={url} alt={name} className="my-1 max-w-full rounded" />;
}

const MARKDOWN_CLASSES = cn(
  "min-w-0 break-words text-sm leading-relaxed [overflow-wrap:anywhere]",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:font-semibold [&_h1]:text-base",
  "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-semibold [&_h2]:text-sm",
  "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-medium [&_h3]:text-sm",
  "[&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1.5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4",
  "[&_blockquote]:my-2 [&_blockquote]:border-amber-400/70 [&_blockquote]:border-l-2 [&_blockquote]:pl-2.5 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_hr]:my-3 [&_hr]:border-border",
);

function NoteMarkdown({
  markdown,
  onOpen,
}: {
  markdown: string;
  onOpen: (name: string) => void;
}) {
  return (
    <div className={MARKDOWN_CLASSES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          /^(vault:|vault-embed:|zotero:\/\/|obsidian:\/\/)/.test(url)
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          a({ href, children }) {
            const target = noteFromHref(href);
            return (
              <button
                type="button"
                onClick={() =>
                  target
                    ? onOpen(target)
                    : href &&
                      shellOpen(href).catch(() =>
                        toast.error("Couldn't open that link."),
                      )
                }
                className="text-left text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
              >
                {children}
              </button>
            );
          },
          img({ src }) {
            if (typeof src !== "string") return null;
            if (src.startsWith(EMBED_SRC)) {
              return (
                <VaultImage
                  name={decodeURIComponent(src.slice(EMBED_SRC.length))}
                />
              );
            }
            return <img src={src} alt="" className="my-1 max-w-full rounded" />;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
