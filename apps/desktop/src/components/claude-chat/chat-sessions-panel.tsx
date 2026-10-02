import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { create } from "zustand";
import { RenameInput } from "./rename-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createLogger } from "@/lib/debug/logger";
import { cn } from "@/lib/utils";
import { providerLabel, useClaudeChatStore } from "@/stores/claude-chat-store";
import { useDocumentStore } from "@/stores/document-store";
import { useMemoryDialog } from "./memory-dialog";

const log = createLogger("chat-sessions");

interface SessionInfo {
  session_id: string;
  title: string;
  last_modified: number;
}

/** Whether the chats panel is showing. */
export const useChatSessionsPanel = create<{
  open: boolean;
  toggle: () => void;
  close: () => void;
}>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

function when(unixSeconds: number): string {
  const delta = Date.now() / 1000 - unixSeconds;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} h ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Today", "Yesterday", "Previous 7 days" or "Older". */
export function dayGroup(unixSeconds: number, now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = unixSeconds * 1000;
  if (at >= start.getTime()) return "Today";
  if (at >= start.getTime() - 864e5) return "Yesterday";
  if (at >= start.getTime() - 7 * 864e5) return "Previous 7 days";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

/**
 * The project's chats: the ones open now, and earlier ones to pick up again,
 * with a search, a new chat, and deleting.
 */
export function ChatSessionsPanel() {
  const open = useChatSessionsPanel((s) => s.open);
  const close = useChatSessionsPanel((s) => s.close);
  const tabs = useClaudeChatStore((s) => s.tabs);
  const activeTabId = useClaudeChatStore((s) => s.activeTabId);
  const setActiveTab = useClaudeChatStore((s) => s.setActiveTab);
  const createTab = useClaudeChatStore((s) => s.createTab);
  const closeTab = useClaudeChatStore((s) => s.closeTab);
  const resumeSession = useClaudeChatStore((s) => s.resumeSession);
  const newSession = useClaudeChatStore((s) => s.newSession);
  const setSessionTitle = useClaudeChatStore((s) => s._setSessionTitle);
  const sessionId = useClaudeChatStore((s) => s.sessionId);
  const projectRoot = useDocumentStore((s) => s.projectRoot);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** The row whose name is being edited: "tab:<id>" or "session:<id>". */
  const [renaming, setRenaming] = useState<string | null>(null);

  const renameSession = (s: SessionInfo, name: string | null) => {
    setRenaming(null);
    const clean = name?.trim().replace(/\s+/g, " ").slice(0, 72);
    if (!clean || clean === s.title || !projectRoot) return;
    setSessions((prev) =>
      prev.map((x) =>
        x.session_id === s.session_id ? { ...x, title: clean } : x,
      ),
    );
    void invoke("rename_claude_session", {
      projectPath: projectRoot,
      sessionId: s.session_id,
      title: clean,
    }).catch((err) =>
      log.error("Failed to rename chat", { error: String(err) }),
    );
  };

  const renameButton = (key: string, label: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setRenaming(key);
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
      aria-label={`Rename ${label}`}
      title="Rename"
    >
      <PencilIcon className="size-3.5" />
    </button>
  );

  const projectTabs = tabs.filter(
    (t) => !t.projectPath || t.projectPath === projectRoot,
  );
  const running = useMemo(
    () =>
      new Set(
        projectTabs
          .filter((t) => t.isStreaming && t.sessionId)
          .map((t) => t.sessionId as string),
      ),
    [projectTabs],
  );

  const load = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    try {
      const result = await invoke<SessionInfo[]>("list_claude_sessions", {
        projectPath: projectRoot,
        generateTitles: false,
      });
      setSessions(result);
      for (const s of result) setSessionTitle(s.session_id, s.title);
    } catch (err) {
      log.error("Failed to load sessions", { error: String(err) });
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [projectRoot, setSessionTitle]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) =>
    words.every((w) => text.toLowerCase().includes(w));

  const openIds = new Set(projectTabs.map((t) => t.sessionId).filter(Boolean));
  const history = sessions.filter(
    (s) => !openIds.has(s.session_id) && matches(s.title),
  );
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: history.filter((s) => dayGroup(s.last_modified) === g),
  })).filter((g) => g.items.length);

  const remove = async () => {
    if (!deleteTarget || !projectRoot) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke("delete_claude_session", {
        projectPath: projectRoot,
        sessionId: deleteTarget.session_id,
      });
      setSessions((prev) =>
        prev.filter((s) => s.session_id !== deleteTarget.session_id),
      );
      if (deleteTarget.session_id === sessionId) newSession();
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  const row =
    "group flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted";

  return (
    <>
      <div className="absolute inset-0 z-20 flex flex-col bg-background">
        <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
          <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
            <span className="flex-1 font-medium text-sm">Chats</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => useMemoryDialog.getState().show()}
              title="Notes shared by all AIs"
            >
              Memory
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                createTab();
                close();
              }}
            >
              <PlusIcon className="size-3.5" />
              New chat
            </Button>
            <button
              type="button"
              onClick={close}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close chats"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="relative px-3 pb-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              aria-label="Search chats"
              className="h-7 pl-7 text-xs"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            <div className="flex items-center justify-between px-2 pt-1 pb-0.5">
              <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Open
              </span>
              {projectTabs.some((t) => t.messages.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    const { closeTab } = useClaudeChatStore.getState();
                    for (const t of projectTabs) {
                      if (!t.isStreaming) closeTab(t.id);
                    }
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  title="Close (kept in history)"
                >
                  Close all
                </button>
              )}
            </div>
            {projectTabs
              .filter((t) => matches(t.title))
              .map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab(t.id);
                    close();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.currentTarget as HTMLElement).click();
                  }}
                  className={cn(row, t.id === activeTabId && "bg-muted")}
                >
                  <span className="min-w-0 flex-1">
                    {renaming === `tab:${t.id}` ? (
                      <RenameInput
                        value={t.title}
                        className="w-full text-sm"
                        onDone={(name) => {
                          setRenaming(null);
                          if (name !== null)
                            useClaudeChatStore.getState().renameTab(t.id, name);
                        }}
                      />
                    ) : (
                      <span className="block truncate text-sm">
                        {t.title || "New chat"}
                      </span>
                    )}
                    <span className="block truncate text-muted-foreground text-xs">
                      {providerLabel(t.providerKey)}
                      {t.messages.length > 0 &&
                        ` · ${t.messages.filter((m) => m.type === "user").length} messages`}
                    </span>
                  </span>
                  {renaming !== `tab:${t.id}` &&
                    renameButton(`tab:${t.id}`, t.title)}
                  {t.isStreaming ? (
                    <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    (projectTabs.length > 1 || t.messages.length > 0) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
                        aria-label={`Close ${t.title}`}
                        title="Close (kept in history)"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    )
                  )}
                </div>
              ))}

            {loading && (
              <div className="flex justify-center py-4">
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <div className="px-2 pt-3 pb-0.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                  {group}
                </div>
                {items.map((s) => (
                  <div
                    key={s.session_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      resumeSession(s.session_id, s.title);
                      close();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        (e.currentTarget as HTMLElement).click();
                    }}
                    className={row}
                  >
                    <span className="min-w-0 flex-1">
                      {renaming === `session:${s.session_id}` ? (
                        <RenameInput
                          value={s.title}
                          className="w-full text-sm"
                          onDone={(name) => renameSession(s, name)}
                        />
                      ) : (
                        <span className="block truncate text-sm">
                          {s.title}
                        </span>
                      )}
                      <span className="block text-muted-foreground text-xs">
                        {when(s.last_modified)}
                      </span>
                    </span>
                    {renaming !== `session:${s.session_id}` &&
                      renameButton(`session:${s.session_id}`, s.title)}
                    <button
                      type="button"
                      disabled={running.has(s.session_id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setDeleteTarget(s);
                      }}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive disabled:opacity-0 group-hover:opacity-100"
                      aria-label={`Delete ${s.title}`}
                      title="Delete"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
            {!loading &&
              grouped.length === 0 &&
              sessions.length > 0 &&
              query && (
                <p className="px-2 py-3 text-muted-foreground text-xs">
                  No chats match.
                </p>
              )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              Delete "{deleteTarget?.title || "this chat"}" from this project?
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={remove}>
              {deleting ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
