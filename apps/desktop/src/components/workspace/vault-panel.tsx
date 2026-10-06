import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  HistoryIcon,
  HomeIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  Loader2Icon,
  NotebookTextIcon,
  PencilIcon,
  PlusIcon,
  QuoteIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  UnplugIcon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { addCitekeysToVault } from "./citation-check";
import {
  CitedAt,
  CitedHeader,
  type CitedOrder,
  CitedToggle,
  orderCited,
  useCitedNotes,
  useItemKeyByCitekey,
} from "./cited-here";
import { NoteContextMenu, NoteMenuItems } from "./topic-menu";
import { kindFolder } from "@/lib/vault/kind-folders";
import { chooseNoteKind, unlinkProject } from "@/lib/vault/note-changes";
import { citeKeyAtCursor } from "@/lib/vault/cite-at-cursor";
import { noteForCitekey } from "@/lib/vault/cite-link";
import { topicsOf } from "@/lib/vault/topics";
import {
  findObsidianVaults,
  type KnownVault,
  LocalVaultSource,
} from "@/lib/vault/load";
import { WebdavConflictError } from "@/lib/vault/webdav";
import { EMBED_SRC, noteFromHref, vaultMarkdown } from "@/lib/vault/render";
import {
  findNote,
  KIND_GROUPS,
  neighbourhood,
  PAPERS_GROUP,
  type NoteKind,
  type VaultIndex,
  type VaultNote,
} from "@/lib/vault/vault-index";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";
import {
  useKindChoices,
  useVaultStore,
  vaultStyle,
} from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { MarkdownNoteEditor } from "./markdown-note-editor";
import { syncProjectNote } from "./project-note-sync";
import { useCitationCheck } from "./citation-check";
import {
  type GraphLinkInput,
  type GraphNodeInput,
  VaultGraph,
} from "./vault-graph";
import { useSettingsWindow } from "@/stores/settings-window-store";
import {
  DockHeaderBar,
  DockWideButton,
  useDockSection,
} from "./dock/dock-section";
import { useVaultStandalone } from "./vault-standalone";
import {
  EMPTY_ROW,
  type FilterRow,
  FilterRowControls,
  FilterToggle,
  rowActive,
  SortSelect,
  rowFilter,
} from "./vault-filter";
import {
  filterNotes,
  mergeFilters,
  parseNoteQuery,
} from "@/lib/vault/note-query";
import { openZoteroPdf, zoteroPdfTarget } from "@/components/zotero-pdf-dialog";
import { PanelBoundary } from "@/components/panel-boundary";

const REFRESH_MS = 30_000;

const PAPER_COLOR = "#3b82f6";
const ROOT_COLOR = "#94a3b8";
const FOLDER_COLORS = [
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#06b6d4",
];

const groupLabel = (group: string) => group || "Notes";

/** A note's colour in lists and the map: papers blue, others by their folder. */
/** A group's own color, before any picked for it. */
function defaultGroupColor(group: string, kind?: string): string {
  if (kind === "paper" || group === PAPERS_GROUP) return PAPER_COLOR;
  if (!group) return ROOT_COLOR;
  let hash = 0;
  for (const ch of group) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FOLDER_COLORS[hash % FOLDER_COLORS.length];
}

/** The color a group is drawn in: picked, its type's, or its own. */
export function groupColor(group: string, kind?: string): string {
  const { colors, types } = vaultStyle();
  return (
    colors[group] ??
    types.find((t) => t.label === group)?.color ??
    defaultGroupColor(group, kind)
  );
}

function noteColor(note: VaultNote): string {
  return groupColor(note.group, note.kind);
}

function noteSubtitle(note: VaultNote): string {
  if (note.kind === "paper") {
    const author = note.authors[0]?.split(",")[0].split(" ").pop();
    return [author, note.year].filter(Boolean).join(" · ");
  }
  const links = note.outgoing.length + note.incoming.length;
  return links ? `${links} link${links === 1 ? "" : "s"}` : "";
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
  const source = useVaultStore((s) => s.source);
  const index = useVaultStore((s) => s.index);
  const loading = useVaultStore((s) => s.loading);
  const syncing = useVaultStore((s) => s.syncing);
  const error = useVaultStore((s) => s.error);
  const current = useVaultStore((s) => s.current);
  const history = useVaultStore((s) => s.history);
  const forward = useVaultStore((s) => s.forward);
  const { ensureVault, reload, open } = useVaultStore.getState();
  const [searched, setSearched] = useState(false);
  const [serverDialog, setServerDialog] = useState(false);

  useEffect(() => {
    ensureVault().finally(() => setSearched(true));
    // Notes change while you work (other devices, the Zotero sync); keep up.
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => reload(), REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [ensureVault, reload]);

  const note = index && current ? findNote(index, current) : undefined;

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-background"
      // A mouse's own back and forward buttons.
      onMouseUp={(e) => {
        if (e.button === 3) useVaultStore.getState().back();
        if (e.button === 4) useVaultStore.getState().goForward();
      }}
    >
      <DockHeaderBar>
        {current || history.length || forward.length ? (
          <VaultNav />
        ) : (
          <NotebookTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <VaultMenu
          label={note ? note.name : (source?.label ?? "Vault")}
          onConnectServer={() => setServerDialog(true)}
        />
        {source && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => reload(true)}
            disabled={syncing}
            title={source.kind === "server" ? "Sync with the server" : "Reload"}
            aria-label="Sync vault"
          >
            <RefreshCwIcon
              className={cn("size-3.5", syncing && "animate-spin")}
            />
          </Button>
        )}
        <DockWideButton />
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
      </DockHeaderBar>

      <CursorCitation onOpen={open} />

      {!source ? (
        searched ? (
          <VaultSetup onConnectServer={() => setServerDialog(true)} />
        ) : (
          <p className="p-4 text-muted-foreground text-xs">
            Looking for your vault…
          </p>
        )
      ) : loading && !index ? (
        <div className="flex items-center gap-2 p-4 text-muted-foreground text-xs">
          <Loader2Icon className="size-3.5 animate-spin" />
          Reading vault…
        </div>
      ) : error && !index ? (
        <p className="p-4 text-destructive text-xs">{error}</p>
      ) : index && note ? (
        <NoteView key={note.path} index={index} note={note} onOpen={open} />
      ) : index && current ? (
        <p className="p-4 text-muted-foreground text-xs">
          “{current}” isn't in the vault yet.
        </p>
      ) : index ? (
        <NoteList index={index} onOpen={open} />
      ) : null}

      <ServerDialog open={serverDialog} onOpenChange={setServerDialog} />
    </div>
  );
}

/**
 * Back, forward, all notes, and the notes you came through, so getting back
 * to the list never takes more than a click.
 */
function VaultNav() {
  const current = useVaultStore((s) => s.current);
  const history = useVaultStore((s) => s.history);
  const forward = useVaultStore((s) => s.forward);
  const { back, goForward, showList, open } = useVaultStore.getState();
  const recent = useMemo(
    () =>
      [...new Set([...history].reverse())]
        .filter((n) => n && n !== current)
        .slice(0, 12),
    [history, current],
  );
  const icon = "size-6 shrink-0";
  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        className={icon}
        onClick={back}
        disabled={!history.length}
        title="Back"
        aria-label="Back"
      >
        <ArrowLeftIcon className="size-3.5" />
      </Button>
      {forward.length > 0 && (
        <Button
          variant="ghost"
          size="icon"
          className={icon}
          onClick={goForward}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRightIcon className="size-3.5" />
        </Button>
      )}
      {current && (
        <Button
          variant="ghost"
          size="icon"
          className={icon}
          onClick={showList}
          title="All notes"
          aria-label="All notes"
        >
          <HomeIcon className="size-3.5" />
        </Button>
      )}
      {recent.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={icon}
              title="Recent notes"
              aria-label="Recent notes"
            >
              <HistoryIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-72">
            {recent.map((name) => (
              <DropdownMenuItem key={name} onSelect={() => open(name)}>
                <span className="truncate">{name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** First run with no vault found: where does it live? */
function VaultSetup({ onConnectServer }: { onConnectServer: () => void }) {
  const useLocalFolder = useVaultStore((s) => s.useLocalFolder);
  const option =
    "flex w-full items-start gap-2.5 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/60";
  return (
    <div className="space-y-2 p-3">
      <p className="px-0.5 pb-1 font-medium text-sm">Where is your vault?</p>
      <button
        type="button"
        className={option}
        onClick={async () => {
          const selected = await openDialog({
            directory: true,
            multiple: false,
          });
          if (typeof selected === "string") useLocalFolder(selected);
        }}
      >
        <FolderOpenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-sm">A folder on this computer</span>
          <span className="block text-muted-foreground text-xs">
            Obsidian Sync, iCloud, Dropbox, OneDrive, Syncthing, Git…
          </span>
        </span>
      </button>
      <button type="button" className={option} onClick={onConnectServer}>
        <ServerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-sm">A WebDAV server</span>
          <span className="block text-muted-foreground text-xs">
            Remotely Save, Nextcloud, Seafile, a NAS…
          </span>
        </span>
      </button>
    </div>
  );
}

function VaultMenu({
  label,
  onConnectServer,
}: {
  label: string;
  onConnectServer: () => void;
}) {
  const source = useVaultStore((s) => s.source);
  const server = useVaultStore((s) => s.server);
  const useLocalFolder = useVaultStore((s) => s.useLocalFolder);
  const disconnectServer = useVaultStore((s) => s.disconnectServer);
  const useServer = useVaultStore((s) => s.useServer);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const linkProject = useVaultStore((s) => s.linkProject);
  const projectLinked = useVaultStore((s) =>
    projectRoot ? Boolean(s.linkedProjects[projectRoot]) : false,
  );
  const updateProjectNote = () =>
    syncProjectNote()
      .then((name) => {
        if (name) {
          toast.success(`Updated “${name}” in the vault`);
          useVaultStore.getState().open(name);
        }
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
      );
  const [vaults, setVaults] = useState<KnownVault[]>([]);
  const localRoot = source instanceof LocalVaultSource ? source.root : null;

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
          {source?.kind === "server" && (
            <ServerIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {server && (
          <DropdownMenuItem onSelect={() => useServer()}>
            <CheckIcon
              className={cn(
                "size-3.5",
                source?.kind !== "server" && "invisible",
              )}
            />
            <ServerIcon className="size-3.5" />
            <span className="truncate">
              {decodeURIComponent(
                new URL(server.url).pathname.split("/").filter(Boolean).pop() ??
                  server.url,
              )}
            </span>
          </DropdownMenuItem>
        )}
        {vaults.map((v) => (
          <DropdownMenuItem
            key={v.path}
            onSelect={() => useLocalFolder(v.path)}
          >
            <CheckIcon
              className={cn("size-3.5", v.path !== localRoot && "invisible")}
            />
            <span className="truncate">{v.name}</span>
            <span className="ml-auto text-muted-foreground text-xs">
              this Mac
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            const selected = await openDialog({
              directory: true,
              multiple: false,
            });
            if (typeof selected === "string") useLocalFolder(selected);
          }}
        >
          <FolderOpenIcon className="size-3.5" />
          Other folder…
        </DropdownMenuItem>
        {server ? (
          <DropdownMenuItem onSelect={() => disconnectServer()}>
            <UnplugIcon className="size-3.5" />
            Disconnect server
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onConnectServer}>
            <ServerIcon className="size-3.5" />
            Connect to a server…
          </DropdownMenuItem>
        )}
        {projectRoot && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (projectLinked) {
                  unlinkProject(projectRoot).catch((err) =>
                    toast.error(
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
                } else {
                  linkProject(projectRoot, true);
                  updateProjectNote();
                }
              }}
            >
              <CheckIcon
                className={cn("size-3.5", !projectLinked && "invisible")}
              />
              Keep this project's note here
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => useCitationCheck.getState().show()}
            >
              <QuoteIcon className="size-3.5" />
              Check citations…
            </DropdownMenuItem>
            {projectLinked && (
              <DropdownMenuItem onSelect={updateProjectNote}>
                <RefreshCwIcon className="size-3.5" />
                Update project note now
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onSelect={() => useSettingsWindow.getState().show("vault")}
        >
          <SettingsIcon className="size-3.5" />
          Vault settings…
        </DropdownMenuItem>
        {source && (
          <DropdownMenuItem
            onSelect={() =>
              shellOpen(
                localRoot
                  ? `obsidian://open?path=${encodeURIComponent(localRoot)}`
                  : `obsidian://open?vault=${encodeURIComponent(source.label)}`,
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

/** Address and login of a WebDAV folder holding the vault. */
export function ServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connectServer = useVaultStore((s) => s.connectServer);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectServer(url, username, password);
      setPassword("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vault on a server</DialogTitle>
          <DialogDescription>
            The WebDAV address of the folder with the vault's notes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/dav/MyVault"
            aria-label="WebDAV address of the vault folder"
            autoFocus
          />
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            aria-label="Username"
            autoComplete="username"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoComplete="current-password"
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !url.trim() || !username.trim() || !password}
            >
              {busy && <Loader2Icon className="size-3.5 animate-spin" />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [row, setRow] = useState<FilterRow>(EMPTY_ROW);
  const filtering = query.trim() !== "" || rowActive(row);
  const standalone = useVaultStandalone();
  const projectOpen = useDocumentStore((s) => Boolean(s.projectRoot));
  const [citedOnlySet, setCitedOnly] = useState(false);
  // Only with a project open: it's what the project cites.
  const citedOnly = citedOnlySet && projectOpen;
  const [citedOrder, setCitedOrder] = useState<CitedOrder>("text");
  const cited = useCitedNotes(citedOnly);
  const results = useMemo(() => {
    const found =
      filtering || row.sort !== "relevance"
        ? filterNotes(
            index,
            index.list,
            mergeFilters(parseNoteQuery(query), rowFilter(row)),
            row.sort,
          )
        : index.list;
    if (!citedOnly) return found;
    const first = [...cited.byNote.keys()];
    return orderCited(
      found.filter((n) => cited.byNote.has(n.name)),
      (n) => cited.byNote.get(n.name),
      (n) => first.indexOf(n.name),
      citedOrder,
    );
  }, [index, query, row, filtering, citedOnly, cited, citedOrder]);
  // Ordered without a search, the sections stay: papers by year, say.
  const groups = useMemo(() => {
    if (filtering || citedOnly) return [{ group: null, notes: results }];
    const byGroup = new Map<string, VaultNote[]>();
    for (const n of results)
      byGroup.set(n.group, [...(byGroup.get(n.group) ?? []), n]);
    return [...byGroup].map(([group, notes]) => ({ group, notes }));
  }, [results, filtering, citedOnly]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2.5 pt-2.5 pb-1.5">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            title='Also: author:nelson, year:1990-2005, year:>2010, topic:"open science", type:paper, tag:name'
            className="h-7 pl-7 text-xs"
          />
        </div>
        <FilterToggle
          open={showFilters}
          active={rowActive(row)}
          onToggle={() => setShowFilters((v) => !v)}
        />
        {!citedOnly && (
          <SortSelect
            value={row.sort}
            onChange={(sort) => setRow({ ...row, sort })}
            searching={query.trim() !== ""}
          />
        )}
        {projectOpen && <CitedToggle on={citedOnly} onChange={setCitedOnly} />}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setCreating((c) => !c)}
          title="New note"
          aria-label="New note"
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
      {showFilters && (
        <FilterRowControls index={index} row={row} onChange={setRow} />
      )}
      {creating && (
        <NewNoteForm
          index={index}
          onDone={(name) => {
            setCreating(false);
            if (name) {
              editOnOpen = name;
              onOpen(name);
            }
          }}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {standalone && !filtering && <VaultMap index={index} onOpen={onOpen} />}
        {filtering && !citedOnly && (
          <p className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">
            {results.length} {results.length === 1 ? "note" : "notes"}
          </p>
        )}
        {citedOnly && (
          <CitedHeader order={citedOrder} onOrder={setCitedOrder}>
            {cited.byNote.size} cited in this project
            {cited.missing.length > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => void addCitekeysToVault(cited.missing)}
                  title={cited.missing.join(", ")}
                  className="text-primary hover:underline"
                >
                  add {cited.missing.length} missing
                </button>
              </>
            )}
          </CitedHeader>
        )}
        {results.length === 0 && !citedOnly && (
          <p className="px-3 py-6 text-center text-muted-foreground text-xs">
            {query ? "No matching notes" : "No notes in this vault"}
          </p>
        )}
        {groups.map(({ group, notes }) => (
          <div key={group ?? "\0results"} className="mb-2">
            {group !== null && (
              <p className="px-2 pt-1.5 pb-0.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                {groupLabel(group)}
                <span className="ml-1 normal-case">{notes.length}</span>
              </p>
            )}
            {notes.map((n) => {
              const places = citedOnly ? cited.byNote.get(n.name) : undefined;
              const row = (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(n.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(n.name);
                    }
                  }}
                  className="flex w-full cursor-default items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                >
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: noteColor(n) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm">
                      {n.title}
                    </span>
                    {noteSubtitle(n) && (
                      <span className="block truncate text-muted-foreground text-xs">
                        {noteSubtitle(n)}
                      </span>
                    )}
                    {places && <CitedAt places={places} />}
                    {places && <TopicChips index={index} note={n} />}
                  </span>
                </div>
              );
              return (
                <NoteContextMenu key={n.name} noteName={n.name}>
                  {row}
                </NoteContextMenu>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The topics a note is filed under, or a nudge when it has none. */
function TopicChips({ index, note }: { index: VaultIndex; note: VaultNote }) {
  if (note.kind === "topic") return null;
  const topics = [...topicsOf(index, note)];
  return (
    <span className="flex flex-wrap gap-1 pt-0.5">
      {topics.length === 0 ? (
        <span className="text-[10px] text-muted-foreground/70 italic">
          no topic
        </span>
      ) : (
        topics.map((t) => (
          <span
            key={t}
            className="rounded px-1.5 py-px text-[10px]"
            style={{
              color: groupColor(KIND_GROUPS.topic, "topic"),
              backgroundColor: `color-mix(in srgb, ${groupColor(KIND_GROUPS.topic, "topic")} 14%, transparent)`,
            }}
          >
            {findNote(index, t)?.title ?? t}
          </span>
        ))
      )}
    </span>
  );
}

/** The kind a template makes, going by its name ("Idea", "Topic note"…). */
function kindFromTemplate(path: string): NoteKind | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  for (const kind of ["idea", "topic", "project", "paper"] as const) {
    if (name.includes(kind)) return kind;
  }
  return null;
}

/** A note just created from the list, to open straight into editing. */
let editOnOpen: string | null = null;

/** Every folder holding notes, plus Obsidian's folder for new notes. */
function noteFolders(index: VaultIndex, extra: (string | null)[]): string[] {
  const folders = new Set(
    index.list.map((n) => n.path.split("/").slice(0, -1).join("/")),
  );
  for (const f of extra) if (f !== null) folders.add(f);
  return [...folders].sort((a, b) => a.localeCompare(b));
}

const templateName = (path: string) =>
  (path.split("/").pop() ?? path).replace(/\.md$/i, "");

function NewNoteForm({
  index,
  onDone,
}: {
  index: VaultIndex;
  onDone: (name: string | null) => void;
}) {
  const createNote = useVaultStore((s) => s.createNote);
  const templates = useVaultStore((s) => s.templates);
  const newNoteFolder = useVaultStore((s) => s.newNoteFolder);
  const lastNoteFolder = useVaultStore((s) => s.lastNoteFolder);
  const lastTemplate = useVaultStore((s) => s.lastTemplate);
  const folders = useMemo(
    () => noteFolders(index, [newNoteFolder, lastNoteFolder]),
    [index, newNoteFolder, lastNoteFolder],
  );
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState(lastNoteFolder ?? newNoteFolder ?? "");
  const [template, setTemplate] = useState(
    lastTemplate && templates.includes(lastTemplate) ? lastTemplate : "",
  );
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      onDone(await createNote(folder, title, template || null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const selectClass =
    "h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs";

  return (
    <form
      className="mx-2.5 mb-1.5 space-y-1.5 rounded-md border border-border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone(null)}
        placeholder="Title"
        aria-label="Title of the new note"
        className="h-7 text-xs"
        autoFocus
      />
      <div className="flex items-center gap-1.5">
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          aria-label="Folder"
          title="Folder"
          className={selectClass}
        >
          {(folders.includes(folder)
            ? folders
            : [...folders, folder].sort()
          ).map((f) => (
            <option key={f} value={f}>
              {f || "Vault root"}
            </option>
          ))}
        </select>
        {templates.length > 0 && (
          <select
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              // A template named for a kind (Idea, Topic…) files the note
              // where that kind's notes live.
              const kind = kindFromTemplate(e.target.value);
              const where = kind ? kindFolder(kind) : null;
              if (where !== null) setFolder(where);
            }}
            aria-label="Template"
            title="Template"
            className={selectClass}
          >
            <option value="">No template</option>
            {templates.map((t) => (
              <option key={t} value={t}>
                {templateName(t)}
              </option>
            ))}
          </select>
        )}
      </div>
      <Button
        type="submit"
        size="sm"
        className="h-7 w-full text-xs"
        disabled={busy || !title.trim()}
      >
        Create
      </Button>
    </form>
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
  const [editing, setEditing] = useState<string | null>(null);
  const kindChoices = useKindChoices();
  const projectOpen = useDocumentStore((s) => Boolean(s.projectRoot));
  // Where the open project cites this paper.
  const citedAt = useCitedNotes(
    projectOpen && note.kind === "paper",
  ).byNote.get(note.name);
  // The papers an idea draws on: the ones it links to.
  const linkedPapers = useMemo(
    () =>
      note.outgoing
        .map((n) => findNote(index, n))
        .filter((n): n is VaultNote => n?.kind === "paper"),
    [note.outgoing, index],
  );

  const startEditing = async () => {
    const source = useVaultStore.getState().source;
    if (!source) return;
    try {
      const { text, version } = await source.readNote(note.path);
      useVaultStore.setState((s) => ({
        versions: new Map(s.versions).set(note.path, version),
      }));
      setEditing(text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (editOnOpen === note.name) {
      editOnOpen = null;
      startEditing();
    }
  });

  if (editing !== null) {
    return (
      <NoteEditor
        note={note}
        initial={editing}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-1 px-3 pt-3">
        {note.kind === "paper" && note.title !== note.name && (
          <p className="font-medium text-sm leading-snug">{note.title}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-white"
                style={{ backgroundColor: noteColor(note) }}
                title="What this note is"
              >
                {note.kind === "note"
                  ? groupLabel(note.group)
                  : kindChoices.find((k) => k.kind === note.kind)?.label}
                <ChevronDownIcon className="size-3 opacity-80" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {kindChoices.map(({ kind, label }) => (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() =>
                    chooseNoteKind(note.name, kind)
                      .then((moved) => {
                        if (moved) toast.success(`Moved to ${moved}`);
                      })
                      .catch((err) =>
                        toast.error(
                          `Couldn't move it: ${err instanceof Error ? err.message : String(err)}`,
                        ),
                      )
                  }
                >
                  {note.kind === kind ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <span className="size-3.5" />
                  )}
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!note.kindChosen}
                onSelect={() =>
                  useVaultStore.getState().setNoteKind(note.name, null)
                }
              >
                <span className="size-3.5" />
                Automatic
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {noteSubtitle(note) && (
            <span className="text-muted-foreground text-xs">
              {noteSubtitle(note)}
            </span>
          )}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={startEditing}
            title="Edit this note"
          >
            <PencilIcon className="size-3" />
            Edit
          </Button>
          {note.kind === "paper"
            ? projectOpen && <CiteButton papers={[note]} />
            : linkedPapers.length > 0 &&
              projectOpen && (
                <CiteButton
                  papers={linkedPapers}
                  label={`Cite its ${linkedPapers.length === 1 ? "paper" : `${linkedPapers.length} papers`}`}
                />
              )}
        </div>
        {citedAt && (
          <div className="flex items-baseline gap-1.5 text-muted-foreground text-xs">
            <QuoteIcon className="size-3 shrink-0 translate-y-0.5" />
            <CitedAt places={citedAt} />
          </div>
        )}
      </div>

      <Connections index={index} note={note} onOpen={onOpen} />

      <div className="border-border border-t px-3 py-3">
        <NoteMarkdown markdown={markdown} onOpen={onOpen} title={note.title} />
      </div>
    </div>
  );
}

function NoteEditor({
  note,
  initial,
  onDone,
}: {
  note: VaultNote;
  initial: string;
  onDone: () => void;
}) {
  const saveNote = useVaultStore((s) => s.saveNote);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const generated = initial.includes("%% begin zotero %%");

  // Let the rest of the panel ask before navigating away from unsaved edits.
  const dirty = text !== initial;
  useEffect(() => {
    useVaultStore.setState({ unsavedEdit: dirty ? note.name : null });
  }, [dirty, note.name]);
  useEffect(
    () => () => {
      useVaultStore.setState({ unsavedEdit: null });
    },
    [],
  );

  const save = async (force = false) => {
    if (saving) return;
    if (text === initial && !force) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await saveNote(note.path, text, force);
      onDone();
    } catch (err) {
      if (err instanceof WebdavConflictError) setConflict(true);
      else toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (text === initial || window.confirm("Discard your changes?")) onDone();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-border border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {generated ? "The Zotero part is rewritten by the sync" : "Editing"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={cancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => save()}
          disabled={saving}
          title="Save (⌘S)"
        >
          {saving && <Loader2Icon className="size-3 animate-spin" />}
          Save
        </Button>
      </div>
      {conflict && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-border border-b bg-amber-500/10 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            Changed elsewhere since you opened it.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => save(true)}
          >
            Keep mine
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onDone}
          >
            Use theirs
          </Button>
        </div>
      )}
      <MarkdownNoteEditor
        noteName={note.name}
        initial={initial}
        onChange={setText}
        onSave={() => save()}
        onCancel={cancel}
      />
    </div>
  );
}

/** Adds the paper to the project's bibliography if needed, then cites it. */
/**
 * Inserts \cite{} for `papers` at the cursor, adding each to the project's
 * bibliography from Zotero first where it can.
 */
function CiteButton({
  papers,
  label = "Cite",
}: {
  papers: VaultNote[];
  label?: string;
}) {
  const zoteroConnected = useZoteroStore((s) => s.isAuthenticated);
  const addItemToBib = useZoteroStore((s) => s.addItemToBib);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const insertAtCursor = useDocumentStore((s) => s.insertAtCursor);
  const [busy, setBusy] = useState(false);

  const cite = async () => {
    setBusy(true);
    const keys: string[] = [];
    let added = 0;
    for (const paper of papers) {
      let key = paper.citekey ?? paper.name.replace(/^@/, "");
      if (paper.zoteroKey && zoteroConnected && projectRoot) {
        const result = await addItemToBib(paper.zoteroKey, null);
        if (result.status === "error") {
          toast.error(`${paper.name}: ${result.message}`);
        } else {
          key = result.citekey;
          if (result.status === "added") added++;
        }
      }
      if (!keys.includes(key)) keys.push(key);
    }
    setBusy(false);
    if (added > 0) {
      toast.success(`Added ${added} to the bibliography`);
    }
    if (keys.length) insertAtCursor(`\\cite{${keys.join(", ")}}`);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
      disabled={busy || papers.length === 0}
      onClick={cite}
      title="Insert \cite{} at the cursor"
    >
      {busy ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <QuoteIcon className="size-3" />
      )}
      {label}
    </Button>
  );
}

type GraphScope = 1 | 2 | "all";

/** Nodes and links for the map: the note's neighbourhood, or the whole vault. */
export function graphFor(index: VaultIndex, name: string, scope: GraphScope) {
  const ring = new Map<string, number>();
  let members: VaultNote[];
  if (scope === "all") {
    members = index.list;
    const centre = findNote(index, name);
    for (const n of members) ring.set(n.name, n.name === centre?.name ? 0 : 1);
  } else {
    const hood = neighbourhood(index, name, scope);
    members = hood.nodes.map((n) => n.note);
    for (const n of hood.nodes) ring.set(n.note.name, n.ring);
  }
  const names = new Set(members.map((n) => n.name));
  const nodes: GraphNodeInput[] = members.map((n) => ({
    id: n.name,
    label: n.kind === "paper" ? n.name : n.title,
    color: noteColor(n),
    centre: ring.get(n.name) === 0,
    ring: ring.get(n.name) ?? 1,
  }));
  const links: GraphLinkInput[] = [];
  for (const n of members) {
    for (const target of n.outgoing) {
      if (names.has(target)) links.push({ source: n.name, target });
    }
  }
  // The groups on the map, for its legend and filters.
  const groupOf = new Map(members.map((n) => [n.name, n.group]));
  const groups = new Map<string, { color: string; count: number }>();
  for (const n of members) {
    const g = groups.get(n.group);
    groups.set(n.group, { color: noteColor(n), count: (g?.count ?? 0) + 1 });
  }
  return { nodes, links, groupOf, groups };
}

/** The map without the groups switched off (the note itself always stays). */
export function filterGraph(
  graph: ReturnType<typeof graphFor>,
  hidden: Set<string>,
): { nodes: GraphNodeInput[]; links: GraphLinkInput[] } {
  if (hidden.size === 0) return graph;
  const keep = new Set(
    graph.nodes
      .filter((n) => n.centre || !hidden.has(graph.groupOf.get(n.id) ?? ""))
      .map((n) => n.id),
  );
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    links: graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
  };
}

/** Colored chips naming the map's groups; clicking one hides or shows it. */
function GraphLegend({
  groups,
  hidden,
  onToggle,
}: {
  groups: Map<string, { color: string; count: number }>;
  hidden: Set<string>;
  onToggle: (group: string) => void;
}) {
  if (groups.size < 2) return null;
  const order = [...groups.keys()].sort((a, b) =>
    a === PAPERS_GROUP ? -1 : b === PAPERS_GROUP ? 1 : a.localeCompare(b),
  );
  return (
    <div
      role="group"
      className="mt-1.5 flex flex-wrap gap-1"
      aria-label="Groups on the map"
    >
      {order.map((group) => {
        const { color, count } = groups.get(group) as {
          color: string;
          count: number;
        };
        const off = hidden.has(group);
        return (
          <button
            key={group}
            type="button"
            onClick={() => onToggle(group)}
            aria-pressed={!off}
            title={
              off ? `Show ${groupLabel(group)}` : `Hide ${groupLabel(group)}`
            }
            className={cn(
              "flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-muted",
              off && "opacity-40",
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {groupLabel(group)}
            <span className="text-muted-foreground">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Saves the map as a JPEG where the user picks. */
const saveMapImage = (name: string) => async (jpeg: Uint8Array) => {
  const path = await saveDialog({
    defaultPath: `${name} map.jpg`,
    filters: [{ name: "JPEG image", extensions: ["jpg", "jpeg"] }],
  });
  if (!path) return;
  try {
    await writeFile(path, jpeg);
    toast.success(`Saved ${path.split(/[\\/]/).pop()}`);
  } catch (err) {
    toast.error(
      `Couldn't save the image. ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/** Notes whose title has every word typed, to light up in the map. */
function useMapHighlight(nodes: GraphNodeInput[], query: string) {
  return useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return new Set(
      nodes
        .filter((n) => words.every((w) => n.label.toLowerCase().includes(w)))
        .map((n) => n.id),
    );
  }, [nodes, query]);
}

/**
 * The whole vault's map, on the vault's front page when it's shown on its
 * own (Library & Vault): every note, filterable by type, click to open.
 */
function VaultMap({
  index,
  onOpen,
}: {
  index: VaultIndex;
  onOpen: (name: string) => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [menuNote, setMenuNote] = useState<string | null>(null);
  const fullGraph = useMemo(() => graphFor(index, "", "all"), [index]);
  const graph = useMemo(
    () => filterGraph(fullGraph, hidden),
    [fullGraph, hidden],
  );
  const highlight = useMapHighlight(graph.nodes, query);
  if (index.list.length === 0) return null;
  return (
    <div className="mb-2 px-1.5">
      <div className="mb-1.5 flex items-center gap-1 px-1">
        <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Whole vault
        </span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Highlight…"
          aria-label="Highlight notes in the map"
          className="ml-auto h-6 w-32 text-xs"
        />
      </div>
      <PanelBoundary name="The map" resetKeys={[graph]}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div>
              <VaultGraph
                onNodeMenu={setMenuNote}
                nodes={graph.nodes}
                links={graph.links}
                height={380}
                layout="force"
                onSaveImage={saveMapImage("Vault")}
                highlight={highlight}
                onOpen={onOpen}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            {menuNote ? (
              <NoteMenuItems noteName={menuNote} />
            ) : (
              <ContextMenuItem disabled>Right-click a note</ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </PanelBoundary>
      <GraphLegend
        groups={fullGraph.groups}
        hidden={hidden}
        onToggle={(group) =>
          setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(group)) next.delete(group);
            else next.add(group);
            return next;
          })
        }
      />
    </div>
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
  const [scope, setScope] = useState<GraphScope>(1);
  const [query, setQuery] = useState("");
  const wide = useDockSection()?.wide ?? false;
  const allBoth = note.outgoing.filter((n) => note.incoming.includes(n));
  const allTo = note.outgoing.filter((n) => !allBoth.includes(n));
  const allFrom = note.incoming.filter((n) => !allBoth.includes(n));
  // The linked notes, filtered and ordered (by year, say) like the list.
  const [linkQuery, setLinkQuery] = useState("");
  const [linkRow, setLinkRow] = useState<FilterRow>(EMPTY_ROW);
  const [linkFilters, setLinkFilters] = useState(false);
  const linkFiltering = linkQuery.trim() !== "" || rowActive(linkRow);
  const narrow = (names: string[]) => {
    if (!linkFiltering && linkRow.sort === "relevance") return names;
    const notes = names
      .map((n) => findNote(index, n))
      .filter((n): n is VaultNote => Boolean(n));
    return filterNotes(
      index,
      notes,
      mergeFilters(parseNoteQuery(linkQuery), rowFilter(linkRow)),
      linkRow.sort,
    ).map((n) => n.name);
  };
  const both = narrow(allBoth);
  const linksTo = narrow(allTo);
  const linkedFrom = narrow(allFrom);
  const linkCount = allBoth.length + allTo.length + allFrom.length;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const fullGraph = useMemo(
    () => graphFor(index, note.name, scope),
    [index, note.name, scope],
  );
  const graph = useMemo(
    () => filterGraph(fullGraph, hidden),
    [fullGraph, hidden],
  );
  // The note a right-click on the map landed on, for its menu.
  const [menuNote, setMenuNote] = useState<string | null>(null);
  const toggleGroup = (group: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const highlight = useMapHighlight(graph.nodes, query);
  if (note.outgoing.length + note.incoming.length === 0 && scope !== "all") {
    return (
      <div className="flex items-center justify-between px-3 pt-2 pb-3 text-muted-foreground text-xs">
        No links yet.
        <button
          type="button"
          onClick={() => setScope("all")}
          className="rounded px-1.5 py-0.5 hover:text-foreground"
        >
          Whole vault
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pt-2 pb-3">
      <div className="mb-1.5 flex items-center gap-1">
        {(
          [
            [1, "Direct"],
            [2, "2 steps"],
            ["all", "Whole vault"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setScope(value)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] transition-colors",
              scope === value
                ? "bg-muted font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        {(scope !== 1 || wide) && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight…"
            aria-label="Highlight notes in the map"
            className="ml-auto h-6 w-32 text-xs"
          />
        )}
      </div>
      <PanelBoundary name="The map" resetKeys={[graph]}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div>
              <VaultGraph
                onNodeMenu={setMenuNote}
                nodes={graph.nodes}
                links={graph.links}
                height={wide ? 460 : scope === 1 ? 200 : 280}
                layout={scope === "all" ? "force" : "radial"}
                onSaveImage={saveMapImage(
                  scope === "all" ? "Vault" : note.name,
                )}
                highlight={highlight}
                onOpen={onOpen}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            {menuNote ? (
              <NoteMenuItems noteName={menuNote} />
            ) : (
              <ContextMenuItem disabled>Right-click a note</ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </PanelBoundary>
      <GraphLegend
        groups={fullGraph.groups}
        hidden={hidden}
        onToggle={toggleGroup}
      />
      {linkCount > 5 && (
        <div className="mt-2">
          <div className="flex items-center gap-1">
            <Input
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              placeholder="Filter links…"
              aria-label="Filter linked notes"
              title='Also: author:nelson, year:1990-2005, topic:"open science", type:paper'
              className="h-6 text-xs"
            />
            <FilterToggle
              open={linkFilters}
              active={rowActive(linkRow)}
              onToggle={() => setLinkFilters((v) => !v)}
            />
            <SortSelect
              value={linkRow.sort}
              onChange={(sort) => setLinkRow({ ...linkRow, sort })}
              searching={linkQuery.trim() !== ""}
              className="h-6!"
            />
          </div>
          {linkFilters && (
            <div className="-mx-2.5 pt-1.5">
              <FilterRowControls
                index={index}
                row={linkRow}
                onChange={setLinkRow}
              />
            </div>
          )}
          {linkFiltering && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              {both.length + linksTo.length + linkedFrom.length} of {linkCount}
            </p>
          )}
        </div>
      )}
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
          <NoteContextMenu key={name} noteName={name}>
            <button
              type="button"
              onClick={() => onOpen(name)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/60"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: n ? noteColor(n) : undefined }}
              />
              <span className="min-w-0 flex-1 truncate">
                {n?.title ?? name}
              </span>
              {n?.kind === "paper" && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {noteSubtitle(n)}
                </span>
              )}
            </button>
          </NoteContextMenu>
        );
      })}
    </div>
  );
}

function VaultImage({ name }: { name: string }) {
  const source = useVaultStore((s) => s.source);
  const relPath = useVaultStore((s) => s.attachments.get(name.toLowerCase()));
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source || !relPath) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      const bytes = await source.readAttachment(relPath);
      if (cancelled) return;
      const type = name.toLowerCase().endsWith(".svg")
        ? "image/svg+xml"
        : undefined;
      objectUrl = URL.createObjectURL(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type }),
      );
      setUrl(objectUrl);
    })().catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, relPath, name]);

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

/** Obsidian's block ids ("^ab12cd34", alone on a line or ending one):
 *  link targets, not text, so not shown. */
const BLOCK_ID_LINE = /^[ \t]*\^[A-Za-z0-9-]+[ \t]*$/gm;
const BLOCK_ID_END = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm;

export function withoutBlockIds(markdown: string): string {
  return markdown.replace(BLOCK_ID_LINE, "").replace(BLOCK_ID_END, "");
}

function NoteMarkdown({
  markdown,
  onOpen,
  title = "Paper",
}: {
  markdown: string;
  onOpen: (name: string) => void;
  /** Names the PDF a highlight link opens. */
  title?: string;
}) {
  const shown = useMemo(() => withoutBlockIds(markdown), [markdown]);
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
                onClick={() => {
                  if (target) return onOpen(target);
                  if (!href) return;
                  // A highlight's "p. 4": the PDF here, at that page.
                  const pdf = zoteroPdfTarget(href, title);
                  if (pdf) return void openZoteroPdf(pdf);
                  shellOpen(href).catch(() =>
                    toast.error("Couldn't open that link."),
                  );
                }}
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
        {shown}
      </ReactMarkdown>
    </div>
  );
}
