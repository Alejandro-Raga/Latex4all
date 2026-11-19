/**
 * Linked devices (Settings → Sync → Link another device): one person's
 * computers with the same projects.
 *
 * The library is a shared document of its own, synced like a shared
 * project (relay and peer to peer) on a connection kept beside the open
 * project's. It lists every project by its share link. Each device shares
 * its projects (without opening them) and adds them to the list, and fetches
 * the ones it doesn't have into its projects folder; a fetched project's
 * files are written the first time it's opened, and from then on it syncs
 * like any shared project.
 */

import { create } from "zustand";
import * as Y from "yjs";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { SharedSession, type SyncEvent } from "@/lib/collab/shared-session";
import {
  compact,
  connect,
  createSharedProject,
  disconnect,
  listenForSyncEvents,
  loadDoc,
  p2pPeers,
  parseLink,
  publish,
  readLink,
  removeLink,
  resolveCode,
  saveDoc,
  sendAwareness,
  writeLink,
} from "@/lib/tauri/collab";
import { join } from "@/lib/tauri/fs";
import { deviceId, deviceName, setLinkedDevices } from "@/lib/collab/device";
import {
  defaultProjectFolder,
  fetchInBackground,
  shareInBackground,
  useCollabStore,
} from "@/stores/collab-store";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("library");
const CHANNEL = "library";

export interface LinkedDevice {
  id: string;
  name: string;
  /** Last seen, ms. */
  at: number;
}

interface LibraryState {
  /** The library's link, once this device is linked. */
  link: string | null;
  status: "off" | "syncing" | "synced" | "offline";
  devices: LinkedDevice[];
  /** Projects in the library, and how many are on this device. */
  projects: number;
  here: number;
  /** Working through the list (sharing, fetching). */
  busy: string | null;
  error: string | null;

  /** Connects, if this device is linked (on start). */
  init: () => Promise<void>;
  /** Makes a library of this device's projects, to link others to. */
  create: () => Promise<void>;
  /** Links this device to another's library (its link or code). */
  linkTo: (text: string) => Promise<void>;
  /** This device leaves; its projects stay, and stay shared. */
  unlink: () => Promise<void>;
}

/** Where the library's link and document are kept on this device. */
async function libraryRoot() {
  return join(await appLocalDataDir(), "library");
}

interface Entry {
  link: string;
  name: string;
  /** Who added it, and when. */
  by: string;
  at: number;
}

let session: SharedSession | null = null;
const cleanup: Array<() => void> = [];
let reconciling: Promise<void> | null = null;
let again = false;

function projectsMap(doc: Y.Doc) {
  return doc.getMap<Entry>("projects");
}

function devicesMap(doc: Y.Doc) {
  return doc.getMap<LinkedDevice>("devices");
}

export const useLibraryStore = create<LibraryState>()((set, get) => {
  function refresh() {
    if (!session) return;
    const devices = [...devicesMap(session.doc).values()].sort(
      (a, b) => b.at - a.at,
    );
    setLinkedDevices(devices.map((d) => d.id));
    const shared = useProjectStore.getState().sharedProjects;
    const ids = [...projectsMap(session.doc).keys()];
    set({
      devices,
      projects: ids.length,
      here: ids.filter((id) => shared[id]).length,
    });
  }

  /** This device's projects into the list; the list's onto this device. */
  async function reconcile() {
    if (reconciling) {
      again = true;
      return reconciling;
    }
    reconciling = (async () => {
      do {
        again = false;
        await reconcileOnce().catch((err) => {
          log.warn("Library sync failed", { error: String(err) });
          set({ error: err instanceof Error ? err.message : String(err) });
        });
      } while (again && session);
    })().finally(() => {
      reconciling = null;
      set({ busy: null });
    });
    return reconciling;
  }

  async function reconcileOnce() {
    const s = session;
    if (!s || s.status !== "synced") return;
    const doc = s.doc;
    const me = deviceId();
    const devices = devicesMap(doc);
    const mine = devices.get(me);
    if (!mine || Date.now() - mine.at > 60 * 60 * 1000) {
      devices.set(me, { id: me, name: deviceName(), at: Date.now() });
    }
    const projects = projectsMap(doc);

    // This device's projects, shared (if they aren't) and listed.
    const recent = useProjectStore.getState().recentProjects;
    for (const project of recent) {
      if (session !== s) return;
      let info = await readLink(project.path).catch(() => null);
      if (!info && useDocumentStore.getState().projectRoot === project.path) {
        // The open one: shared as from the Share button, to sync right away.
        set({ busy: `Sharing ${project.name}…` });
        await useCollabStore
          .getState()
          .share()
          .catch(() => {});
        info = await readLink(project.path).catch(() => null);
      }
      if (!info) {
        set({ busy: `Sharing ${project.name}…` });
        info = await shareInBackground(project.path).catch((err) => {
          log.warn("Couldn't share for linked devices", {
            path: project.path,
            error: String(err),
          });
          return null;
        });
      }
      if (info && !projects.has(info.projectId)) {
        projects.set(info.projectId, {
          link: info.link,
          name: project.name,
          by: me,
          at: Date.now(),
        });
      }
    }

    // The list's projects this device lacks, fetched into its folder.
    const store = useProjectStore.getState();
    const parent = store.lastProjectFolder ?? (await defaultProjectFolder());
    for (const [id, entry] of projects) {
      if (session !== s) return;
      const there = store.sharedProjects[id];
      if (there) {
        const link = await readLink(there).catch(() => null);
        if (link?.projectId === id) continue;
      }
      set({ busy: `Getting ${entry.name}…` });
      try {
        const path = await fetchInBackground(entry.link, parent);
        useProjectStore.getState().addRecentProject(path);
      } catch (err) {
        log.warn("Couldn't fetch a linked project", {
          name: entry.name,
          error: String(err),
        });
      }
    }
    set({ error: null });
    refresh();
  }

  async function start(link: string) {
    await stop();
    const root = await libraryRoot();
    const saved = await loadDoc(root).catch(() => null);
    const s = new SharedSession(
      {
        publish: (update) => {
          publish(update, CHANNEL).catch(() => {});
        },
        awareness: (data) => {
          sendAwareness(data, CHANNEL).catch(() => {});
        },
        compact: (upTo, snapshot, blobs) => {
          compact(upTo, snapshot, blobs, CHANNEL).catch(() => {});
        },
        peers: (ids) => {
          p2pPeers(ids, CHANNEL).catch(() => {});
        },
        save: (seq, local, state) => saveDoc(root, seq, local, state),
      },
      {
        local: () => ({}),
        onStatus: (status) => {
          if (session !== s) return;
          set({
            status:
              status === "synced"
                ? "synced"
                : status === "syncing"
                  ? "syncing"
                  : "offline",
          });
          if (status === "synced") void reconcile();
        },
        onCaughtUp: () => {
          if (session === s) void reconcile();
        },
      },
    );
    if (saved) s.load(saved.seq, saved.data);
    session = s;
    const unlisten = await listenForSyncEvents(
      (e: SyncEvent) => s.handle(e),
      CHANNEL,
    );
    cleanup.push(unlisten);
    // Another device's additions, as they come.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      refresh();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reconcile(), 2000);
    };
    projectsMap(s.doc).observe(changed);
    devicesMap(s.doc).observe(changed);
    cleanup.push(() => {
      if (timer) clearTimeout(timer);
      projectsMap(s.doc).unobserve(changed);
      devicesMap(s.doc).unobserve(changed);
    });
    // Projects added on this device: listed too.
    cleanup.push(
      useProjectStore.subscribe((state, prev) => {
        if (state.recentProjects.length > prev.recentProjects.length) {
          changed();
        }
      }),
    );
    set({ link, status: "syncing", error: null });
    refresh();
    await connect(link, s.seq, root, CHANNEL);
    s.connecting();
  }

  async function stop() {
    const s = session;
    session = null;
    for (const fn of cleanup.splice(0)) fn();
    if (!s) return;
    await s.destroy().catch(() => {});
    await disconnect(CHANNEL).catch(() => {});
  }

  return {
    link: null,
    status: "off",
    devices: [],
    projects: 0,
    here: 0,
    busy: null,
    error: null,

    init: async () => {
      if (session) return;
      const info = await readLink(await libraryRoot()).catch(() => null);
      if (info) await start(info.link);
    },

    create: async () => {
      if (get().link) return;
      const info = await parseLink(await createSharedProject());
      await writeLink(await libraryRoot(), info.link);
      await start(info.link);
    },

    linkTo: async (text) => {
      const trimmed = text.trim();
      const link = /^[\s\w-]{12,20}$/.test(trimmed)
        ? await resolveCode(trimmed)
        : trimmed;
      const info = await parseLink(link);
      await writeLink(await libraryRoot(), info.link);
      await start(info.link);
    },

    unlink: async () => {
      if (session) devicesMap(session.doc).delete(deviceId());
      await stop();
      await removeLink(await libraryRoot()).catch(() => {});
      setLinkedDevices([]);
      set({
        link: null,
        status: "off",
        devices: [],
        projects: 0,
        here: 0,
        busy: null,
        error: null,
      });
    },
  };
});
