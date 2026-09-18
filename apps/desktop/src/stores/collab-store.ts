import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { homeDir } from "@tauri-apps/api/path";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { metaMap } from "@/lib/collab/project-doc";
import { type Known, ProjectSync } from "@/lib/collab/project-sync";
import {
  type SessionStatus,
  SharedSession,
  type SyncEvent,
} from "@/lib/collab/shared-session";
import { documentStoreWorkspace } from "@/lib/collab/store-workspace";
import { settleConcurrentEdits } from "@/lib/collab/concurrent-edits";
import {
  type SyncWarning,
  USAGE_WARNING_IDS,
  type Usage,
  usageWarnings,
  warningForError,
} from "@/lib/collab/sync-warnings";
import {
  type LinkInfo,
  compact,
  connect,
  createProjectFolder,
  createSharedProject,
  defaultCollabName,
  disconnect,
  listenForSyncEvents,
  loadChat,
  loadDoc,
  parseLink,
  publish,
  readLink,
  removeLink,
  saveDoc,
  sendAwareness,
  writeLink,
} from "@/lib/tauri/collab";
import { join } from "@/lib/tauri/fs";
import { useDocumentStore } from "@/stores/document-store";
import { useHistoryStore } from "@/stores/history-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore } from "@/stores/chat-store";
import {
  moveAnnotationsIntoShared,
  moveAnnotationsOutOfShared,
  takeLocalAnnotations,
} from "@/stores/annotations-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("collab");

/** How long joining waits for the relay before giving up. */
const JOIN_TIMEOUT_MS = 20_000;
/** Autosave runs 2 s after changes; snapshot history once it has. */
const HISTORY_DELAY_MS = 3000;

/** Where projects are kept unless the user picks somewhere else. */
export async function defaultProjectFolder() {
  return join(await homeDir(), "Documents", "Latex4All");
}

const PEER_COLORS = [
  "#e11d48",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

export function peerColor(clientId: number) {
  return PEER_COLORS[clientId % PEER_COLORS.length];
}

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
  /** relativePath of the file they have open. */
  file: string | null;
}

interface CollabState {
  /** `none` when the open project isn't shared. */
  status: "none" | SessionStatus;
  link: string | null;
  peers: CollabPeer[];
  displayName: string;
  /** Bumped whenever the shared files change shape, so editors rebind. */
  revision: number;
  /** What a share or join in progress is doing. */
  progress: string | null;
  /** Problems with syncing, until they're resolved. */
  warnings: SyncWarning[];
  /** The relay's latest figures for the open project. */
  usage: Usage | null;

  setDisplayName: (name: string) => void;
  share: () => Promise<void>;
  /** `destParent` is the folder to save it in; defaults to the usual one. */
  join: (link: string, destParent?: string) => Promise<void>;
  stopSyncing: () => Promise<void>;
}

interface Active {
  root: string;
  info: LinkInfo;
  session: SharedSession;
  sync: ProjectSync | null;
  undoManagers: Map<string, Y.UndoManager>;
  cleanup: Array<() => void>;
}

let active: Active | null = null;
/** Opening and closing happen one at a time, in order. */
let transition: Promise<void> = Promise.resolve();

function inSequence(step: () => Promise<void>) {
  transition = transition.then(step, step);
  return transition;
}

/** Set by the store; used by `followOpenProject`. */
let openShared: (root: string, info: LinkInfo) => Promise<void> =
  async () => {};
let closeShared: () => Promise<void> = async () => {};

/**
 * Connects shared projects as they open and disconnects them as they close.
 * Called once the app has mounted: the document store and this one import
 * each other (through the editor), so neither may use the other at load.
 */
export function followOpenProject() {
  const follow = (root: string | null) =>
    inSequence(async () => {
      await closeShared();
      if (!root) return;
      const info = await readLink(root).catch(() => null);
      if (!info || useDocumentStore.getState().projectRoot !== root) return;
      await openShared(root, info).catch((err) => {
        reportError(`Couldn't sync this project: ${String(err)}`);
      });
    });
  void follow(useDocumentStore.getState().projectRoot);
  const unsubscribe = useDocumentStore.subscribe((state, prev) => {
    if (state.projectRoot !== prev.projectRoot) void follow(state.projectRoot);
  });
  return () => {
    unsubscribe();
    void inSequence(closeShared);
  };
}

/** The shared text for a file, while its project is open and shared. */
export function getSharedText(relativePath: string): Y.Text | null {
  return active?.sync?.textAt(relativePath)?.text ?? null;
}

/** The shared document of the project at `root`, while it's open and synced. */
export function getSharedDoc(root: string): Y.Doc | null {
  return active?.sync && active.root === root ? active.session.doc : null;
}

export function getCollabAwareness(): Awareness | null {
  return active?.sync ? active.session.awareness : null;
}

/** One per file for the session, so undo history survives switching files. */
export function getSharedUndoManager(
  relativePath: string,
): Y.UndoManager | null {
  const shared = active?.sync?.textAt(relativePath);
  if (!active || !shared) return null;
  let manager = active.undoManagers.get(shared.fileId);
  if (!manager) {
    manager = new Y.UndoManager(shared.text);
    active.undoManagers.set(shared.fileId, manager);
  }
  return manager;
}

function describeError(code: string) {
  switch (code) {
    case "quota":
      return "This shared project has reached its 100 MB limit.";
    case "too-large":
      return "A file is too large to share (25 MB at most).";
    case "gone":
      return "This shared project no longer exists. Your files are still here.";
    case "outdated":
      return "This shared project needs a newer version of Latex4All. Update to keep syncing.";
    case "chat-too-large":
      return "That message is too large to send.";
    case "chat-quota":
      return "The chat can't take more messages right now.";
    default:
      return code;
  }
}

/** Points the user to text two people changed at once. */
function showConflicts(found: Array<{ path: string; from: number }>) {
  useSettingsStore.getState().setShowAnnotations(true);
  const [first] = found;
  toast.warning(
    found.length === 1
      ? "You and someone else edited the same text."
      : `You and someone else edited the same text in ${found.length} places.`,
    {
      duration: 10_000,
      action: {
        label: "Show",
        onClick: () => {
          const documents = useDocumentStore.getState();
          if (documents.activeFileId !== first.path) {
            documents.setActiveFile(first.path);
          }
          documents.requestJumpToPosition(first.from);
        },
      },
    },
  );
}

function announce(warning: SyncWarning) {
  if (warning.level === "error") toast.error(warning.text);
  else toast.warning(warning.text);
}

/** Keeps a problem on show in the Shared button, and says so once. */
function warnAbout(message: string) {
  log.warn("Sync problem", { message });
  const warning = warningForError(message);
  if (!warning) return;
  const { warnings } = useCollabStore.getState();
  if (warnings.some((w) => w.id === warning.id)) return;
  useCollabStore.setState({ warnings: [...warnings, warning] });
  announce(warning);
}

/** The relay's figures: warns as the project or the relay fills up. */
function applyUsage(usage: Usage) {
  const { warnings } = useCollabStore.getState();
  const fresh = usageWarnings(usage);
  for (const warning of fresh) {
    if (!warnings.some((w) => w.id === warning.id)) announce(warning);
  }
  useCollabStore.setState({
    usage,
    warnings: [
      ...warnings.filter((w) => !USAGE_WARNING_IDS.includes(w.id)),
      ...fresh,
    ],
  });
}

const shownErrors = new Set<string>();
function reportError(message: string) {
  log.warn("Sync problem", { message });
  if (shownErrors.has(message)) return;
  shownErrors.add(message);
  toast.error(message);
}

export const useCollabStore = create<CollabState>()(
  persist(
    (set, get) => {
      function bumpRevision() {
        set((s) => ({ revision: s.revision + 1 }));
      }

      function trackPresence(target: Active) {
        const { awareness, doc } = target.session;
        const color = peerColor(doc.clientID);
        awareness.setLocalState({
          user: {
            name: get().displayName.trim() || "Anonymous",
            color,
            colorLight: `${color}33`,
          },
          file: useDocumentStore.getState().activeFileId || null,
        });
        const refresh = () => {
          if (active !== target) return;
          const peers: CollabPeer[] = [];
          awareness.getStates().forEach((state, clientId) => {
            if (clientId === doc.clientID || !state.user) return;
            peers.push({
              clientId,
              name: state.user.name ?? "Anonymous",
              color: state.user.color ?? peerColor(clientId),
              file: state.file ?? null,
            });
          });
          set({ peers });
        };
        awareness.on("change", refresh);
        target.cleanup.push(() => awareness.off("change", refresh));
        target.cleanup.push(
          useDocumentStore.subscribe((state, prev) => {
            if (state.activeFileId !== prev.activeFileId) {
              awareness.setLocalStateField("file", state.activeFileId || null);
            }
          }),
        );
      }

      /** Snapshots history once others' changes have been saved to disk. */
      function recordCollaboratorChanges(target: Active) {
        const timer = setTimeout(async () => {
          if (active !== target) return;
          try {
            await useDocumentStore.getState().saveAllFiles();
            await useHistoryStore
              .getState()
              .createSnapshot(target.root, "Changes from collaborators");
          } catch (err) {
            log.warn("Couldn't snapshot history", { error: String(err) });
          }
        }, HISTORY_DELAY_MS);
        target.cleanup.push(() => clearTimeout(timer));
      }

      async function open(root: string, info: LinkInfo) {
        const saved = await loadDoc(root).catch(() => null);
        const known: Known = saved ? JSON.parse(saved.local || "{}") : {};
        let buffered: SyncEvent[] | null = [];

        const target: Active = {
          root,
          info,
          session: null as unknown as SharedSession,
          sync: null,
          undoManagers: new Map(),
          cleanup: [],
        };
        target.session = new SharedSession(
          {
            publish: (update) => {
              publish(update).catch((err) => warnAbout(String(err)));
            },
            awareness: (data) => {
              sendAwareness(data).catch(() => {});
            },
            compact: (upTo, snapshot, blobs) => {
              compact(upTo, snapshot, blobs).catch(() => {});
            },
            save: (seq, local, state) =>
              saveDoc(root, seq, local, state).catch((err) => {
                warnAbout(
                  "Couldn't save this project's sync progress on this computer. Check there's free disk space.",
                );
                throw err;
              }),
          },
          {
            local: () => target.sync?.knownFiles() ?? known,
            onStatus: (status) => {
              if (active === target) set({ status });
            },
            onCaughtUp: (changed) => {
              if (changed) recordCollaboratorChanges(target);
            },
            onConcurrentEdits: (base, mine, theirs) => {
              const { doc } = target.session;
              const found = settleConcurrentEdits(doc, base, mine, theirs, {
                name: get().displayName.trim() || "Anonymous",
                color: peerColor(doc.clientID),
              });
              if (found.length > 0 && active === target) {
                showConflicts(found);
              }
            },
            onError: (code) => {
              if (code.startsWith("chat-")) {
                useChatStore.getState().markFailed();
                reportError(describeError(code));
              } else {
                warnAbout(code);
              }
            },
          },
        );
        const { session } = target;
        if (saved) session.load(saved.seq, saved.data);
        active = target;
        set({
          status: "syncing",
          link: info.link,
          peers: [],
          warnings: [],
          usage: null,
        });

        const chat = useChatStore.getState();
        chat.reset();
        loadChat(root)
          .then((list) => {
            if (active === target) useChatStore.getState().loadHistory(list);
          })
          .catch((err) =>
            log.warn("Couldn't read the chat", { error: String(err) }),
          );
        target.cleanup.push(
          await listenForSyncEvents((event) => {
            // Chat has nothing to do with the document; it's shown as it comes.
            if (event.type === "chat") {
              useChatStore.getState().receive(event);
              return;
            }
            if (event.type === "usage") {
              if (active === target) applyUsage(event);
              return;
            }
            if (event.type === "caughtUp") {
              useChatStore.getState().setDays(event.chatDays);
            }
            if (buffered) buffered.push(event);
            else session.handle(event);
          }),
        );
        // A restore point from before anything of anyone else's lands here.
        await useHistoryStore
          .getState()
          .createSnapshot(root, "Before syncing with collaborators")
          .catch(() => null);

        // Connected before the folder is settled, so local changes found
        // there have somewhere to go; what the relay sends waits until then,
        // so an edit made while the app was closed isn't mistaken for stale.
        await connect(info.link, session.seq, root);
        session.connecting();
        const meta = metaMap(session.doc);
        if (!meta.get("name")) {
          meta.set("name", root.split(/[\\/]/).filter(Boolean).pop() ?? "");
        }
        target.sync = new ProjectSync(
          session.doc,
          documentStoreWorkspace(root, info.link),
          known,
          { onLayoutChanged: bumpRevision, onError: warnAbout },
        );
        await target.sync.start();
        if (active !== target) return;
        for (const event of buffered.splice(0)) session.handle(event);
        buffered = null;
        trackPresence(target);
        bumpRevision();
      }

      async function close() {
        const current = active;
        if (!current) return;
        active = null;
        current.sync?.stop();
        for (const fn of current.cleanup.splice(0)) fn();
        // Goodbye (and a save) first, then drop the connection.
        await current.session.destroy().catch((err) =>
          log.warn("Couldn't save the shared document", {
            error: String(err),
          }),
        );
        await disconnect().catch(() => {});
        useChatStore.getState().reset();
        set((s) => ({
          status: "none",
          link: null,
          peers: [],
          warnings: [],
          usage: null,
          revision: s.revision + 1,
        }));
      }

      openShared = open;
      closeShared = close;

      return {
        status: "none",
        link: null,
        peers: [],
        displayName: "",
        revision: 0,
        progress: null,
        warnings: [],
        usage: null,

        setDisplayName: (name) => {
          set({ displayName: name });
          const awareness = getCollabAwareness();
          const user = awareness?.getLocalState()?.user;
          if (awareness && user) {
            awareness.setLocalStateField("user", {
              ...user,
              name: name.trim() || "Anonymous",
            });
          }
        },

        share: async () => {
          const root = useDocumentStore.getState().projectRoot;
          if (!root || active || get().progress) return;
          set({ progress: "Sharing…" });
          try {
            await useDocumentStore.getState().saveAllFiles();
            const annotations = await takeLocalAnnotations(root);
            const info = await parseLink(await createSharedProject());
            await writeLink(root, info.link);
            useProjectStore
              .getState()
              .rememberSharedProject(info.projectId, root);
            await inSequence(() => open(root, info));
            const doc = getSharedDoc(root);
            if (doc) await moveAnnotationsIntoShared(doc, root, annotations);
          } finally {
            set({ progress: null });
          }
        },

        join: async (text, destParent) => {
          if (get().progress) return;
          const info = await parseLink(text);
          const projects = useProjectStore.getState();
          const existing = projects.sharedProjects[info.projectId];
          if (existing) {
            const there = await readLink(existing).catch(() => null);
            if (there?.projectId === info.projectId) {
              await useDocumentStore.getState().openProject(existing);
              projects.addRecentProject(existing);
              return;
            }
            projects.forgetSharedProject(info.projectId);
          }

          set({ progress: "Downloading…" });
          let path = "";
          try {
            await inSequence(close);
            // Fetch the project into memory first, to learn its name.
            let resolve = () => {};
            let reject: (err: Error) => void = () => {};
            const caughtUp = new Promise<void>((res, rej) => {
              resolve = res;
              reject = rej;
            });
            const session = new SharedSession(
              {
                publish: () => {},
                awareness: () => {},
                compact: () => {},
                save: async () => {},
              },
              {
                local: () => ({}),
                onCaughtUp: () => resolve(),
                onError: (code) => {
                  if (code === "gone") reject(new Error(describeError("gone")));
                },
              },
            );
            const unlisten = await listenForSyncEvents((e) =>
              session.handle(e),
            );
            const timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "Couldn't reach the shared project. Check your connection.",
                  ),
                ),
              JOIN_TIMEOUT_MS,
            );
            try {
              await connect(info.link, 0, null);
              await caughtUp;
              const name = metaMap(session.doc).get("name") || "Shared project";
              const parent = destParent ?? (await defaultProjectFolder());
              path = await createProjectFolder(parent, name);
              await writeLink(path, info.link);
              await saveDoc(
                path,
                session.seq,
                "{}",
                Y.encodeStateAsUpdate(session.doc),
              );
              projects.rememberSharedProject(info.projectId, path);
            } finally {
              clearTimeout(timeout);
              unlisten();
              await disconnect().catch(() => {});
              session.doc.destroy();
            }
          } finally {
            set({ progress: null });
          }
          // Opening it connects again and writes every file into the folder.
          await useDocumentStore.getState().openProject(path);
          projects.addRecentProject(path);
        },

        stopSyncing: async () => {
          const current = active;
          if (!current) return;
          await moveAnnotationsOutOfShared(
            current.session.doc,
            current.root,
          ).catch((err) =>
            log.warn("Couldn't keep annotations", { error: String(err) }),
          );
          await inSequence(close);
          await removeLink(current.root);
          useProjectStore
            .getState()
            .forgetSharedProject(current.info.projectId);
        },
      };
    },
    {
      name: "latex4all-collab",
      partialize: (state) => ({ displayName: state.displayName }),
      onRehydrateStorage: () => (state) => {
        if (state && !state.displayName) {
          defaultCollabName()
            .then((name) => {
              if (name && !useCollabStore.getState().displayName) {
                useCollabStore.setState({ displayName: name });
              }
            })
            .catch(() => {});
        }
      },
    },
  ),
);
