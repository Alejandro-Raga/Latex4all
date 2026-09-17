import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { homeDir, join } from "@tauri-apps/api/path";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { CollabProvider } from "@/lib/collab/provider";
import {
  bindProjectText,
  shareProjectText,
  sharedFiles,
} from "@/lib/collab/text-sync";
import {
  defaultCollabName,
  hostCollabSession,
  joinCollabSession,
  openCollabChannel,
  sendCollabMessage,
  stopCollabSession,
} from "@/lib/tauri/collab";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("collab");

/** Relays the connection when sharing over the internet (apps/relay). */
const RELAY_URL = "https://collab.alejandroraga.com";

/** How long a guest waits for the host to send the project's text. */
const JOIN_TIMEOUT_MS = 15_000;

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

type CollabStatus = "idle" | "connecting" | "live";
export type ShareOver = "internet" | "network";

interface CollabState {
  role: "host" | "guest" | null;
  status: CollabStatus;
  invite: string | null;
  peers: CollabPeer[];
  displayName: string;
  shareOver: ShareOver;
  /** Bumped whenever files start or stop being shared, so editors rebind. */
  revision: number;

  setDisplayName: (name: string) => void;
  setShareOver: (over: ShareOver) => void;
  startSharing: () => Promise<void>;
  join: (invite: string) => Promise<void>;
  stop: () => void;
}

interface Session {
  doc: Y.Doc;
  provider: CollabProvider;
  undoManagers: Map<string, Y.UndoManager>;
  /** The project the session is attached to, once it's open. */
  projectRoot: string | null;
  cleanup: Array<() => void>;
}

let session: Session | null = null;

/** The shared text for a file, if it's part of the running session. */
export function getSharedText(relativePath: string): Y.Text | null {
  if (!session?.projectRoot) return null;
  return sharedFiles(session.doc).get(relativePath) ?? null;
}

export function getCollabAwareness(): Awareness | null {
  return session?.projectRoot ? session.provider.awareness : null;
}

/** One per file for the whole session, so undo history survives switching files. */
export function getSharedUndoManager(
  relativePath: string,
): Y.UndoManager | null {
  const text = getSharedText(relativePath);
  if (!session || !text) return null;
  let manager = session.undoManagers.get(relativePath);
  if (!manager) {
    manager = new Y.UndoManager(text);
    session.undoManagers.set(relativePath, manager);
  }
  return manager;
}

export const useCollabStore = create<CollabState>()(
  persist(
    (set, get) => {
      /** Everything a session needs before it's attached to a project. */
      async function openSession(): Promise<Session> {
        const doc = new Y.Doc();
        const provider = new CollabProvider(doc, { send: sendCollabMessage });
        const next: Session = {
          doc,
          provider,
          undoManagers: new Map(),
          projectRoot: null,
          cleanup: [],
        };
        next.cleanup.push(
          await openCollabChannel({
            onMessage: (message) => provider.receive(message),
            onResync: () => provider.requestSync(),
            onClosed: () => {
              if (session !== next) return;
              log.info("Host ended the session");
              get().stop();
              toast("The shared session ended");
            },
          }),
        );
        return next;
      }

      function teardown(target: Session) {
        for (const fn of target.cleanup.splice(0)) fn();
        // Say goodbye before the relay goes, so our cursor disappears for
        // everyone right away.
        target.provider.destroy();
        stopCollabSession().catch((err) =>
          log.warn("Failed to stop session", { error: String(err) }),
        );
        target.doc.destroy();
      }

      /** Attaches an open session to the project now in the document store. */
      function attach(target: Session) {
        const documents = useDocumentStore.getState();
        target.projectRoot = documents.projectRoot;
        const awareness = target.provider.awareness;
        const color = peerColor(target.doc.clientID);
        awareness.setLocalState({
          user: {
            name: get().displayName.trim() || "Anonymous",
            color,
            colorLight: `${color}33`,
          },
          file: documents.activeFileId || null,
        });

        const refreshPeers = () => {
          const peers: CollabPeer[] = [];
          awareness.getStates().forEach((state, clientId) => {
            if (clientId === target.doc.clientID || !state.user) return;
            peers.push({
              clientId,
              name: state.user.name ?? "Anonymous",
              color: state.user.color ?? peerColor(clientId),
              file: state.file ?? null,
            });
          });
          set({ peers });
        };
        awareness.on("change", refreshPeers);
        target.cleanup.push(() => awareness.off("change", refreshPeers));

        target.cleanup.push(
          bindProjectText(target.doc, useDocumentStore, () =>
            set((s) => ({ revision: s.revision + 1 })),
          ),
        );

        target.cleanup.push(
          useDocumentStore.subscribe((state, prev) => {
            if (state.activeFileId !== prev.activeFileId) {
              awareness.setLocalStateField("file", state.activeFileId || null);
            }
            // Closing or switching projects ends the session.
            if (state.projectRoot !== target.projectRoot) get().stop();
          }),
        );
        refreshPeers();
      }

      return {
        role: null,
        status: "idle",
        invite: null,
        peers: [],
        displayName: "",
        shareOver: "internet",
        revision: 0,

        setShareOver: (over) => set({ shareOver: over }),

        setDisplayName: (name) => {
          set({ displayName: name });
          const awareness = session?.provider.awareness;
          if (awareness?.getLocalState()) {
            awareness.setLocalStateField("user", {
              ...awareness.getLocalState()?.user,
              name: name.trim() || "Anonymous",
            });
          }
        },

        startSharing: async () => {
          const documents = useDocumentStore.getState();
          if (!documents.projectRoot || get().status !== "idle") return;
          set({ role: "host", status: "connecting" });
          const next = await openSession();
          session = next;
          try {
            shareProjectText(next.doc, documents.files);
            const { invite } = await hostCollabSession(
              documents.projectRoot,
              get().shareOver === "internet" ? RELAY_URL : null,
            );
            if (session !== next) return;
            attach(next);
            next.provider.connect();
            set((s) => ({
              status: "live",
              invite,
              revision: s.revision + 1,
            }));
          } catch (err) {
            if (session === next) {
              session = null;
              teardown(next);
              set({ role: null, status: "idle", invite: null });
            }
            throw err;
          }
        },

        join: async (invite) => {
          if (get().status !== "idle") return;
          set({ role: "guest", status: "connecting" });
          const next = await openSession();
          session = next;
          try {
            const destParent = await join(
              await homeDir(),
              "Documents",
              "Latex4All",
            );
            const { projectPath } = await joinCollabSession(invite, destParent);
            next.provider.connect();
            await waitForSharedText(next, JOIN_TIMEOUT_MS);
            if (session !== next) return;
            await useDocumentStore.getState().openProject(projectPath);
            useProjectStore.getState().addRecentProject(projectPath);
            if (session !== next) return;
            attach(next);
            set((s) => ({ status: "live", revision: s.revision + 1 }));
          } catch (err) {
            if (session === next) {
              session = null;
              teardown(next);
              set({ role: null, status: "idle" });
            }
            throw err;
          }
        },

        stop: () => {
          const current = session;
          if (!current) return;
          session = null;
          teardown(current);
          set((s) => ({
            role: null,
            status: "idle",
            invite: null,
            peers: [],
            revision: s.revision + 1,
          }));
        },
      };
    },
    {
      name: "latex4all-collab",
      partialize: (state) => ({
        displayName: state.displayName,
        shareOver: state.shareOver,
      }),
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

function waitForSharedText(target: Session, timeoutMs: number) {
  const map = sharedFiles(target.doc);
  if (map.size > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      map.unobserve(check);
      reject(new Error("The shared project didn't respond."));
    }, timeoutMs);
    function check() {
      if (map.size === 0) return;
      clearTimeout(timer);
      map.unobserve(check);
      resolve();
    }
    map.observe(check);
  });
}
