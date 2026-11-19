/**
 * Linked devices (Settings → Devices): one person's
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
import {
  deviceId,
  deviceName,
  markSharedWithPeople,
  setLinkedDevices,
  sharedWithPeople,
  unmarkSharedWithPeople,
} from "@/lib/collab/device";
import {
  defaultProjectFolder,
  fetchInBackground,
  moveShareOwner,
  shareInBackground,
  syncInBackground,
  useCollabStore,
} from "@/stores/collab-store";
import { exists, rename } from "@tauri-apps/plugin-fs";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";
import { projectKey, usePlanStore } from "@/lib/plan/plan-store";
import { isPlaceholderName } from "@/lib/collab/project-doc";
import { readProjectMeta, writeProjectType } from "@/lib/project-meta";
import { createLogger } from "@/lib/debug/logger";
import { type AppKnown, syncAppData } from "@/lib/collab/app-data-sync";
import {
  local,
  pathMap,
  portable,
  type StateKnown,
  syncAppState,
} from "@/lib/collab/app-state-sync";

const log = createLogger("library");
const CHANNEL = "library";

export type ProjectSyncState = "syncing" | "synced" | "offline" | "error";

function setState(root: string, state: ProjectSyncState) {
  useLibraryStore.setState((st) => ({
    states: { ...st.states, [root]: state },
  }));
}

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
  list: LibraryProject[];
  here: number;
  /** Working through the list (sharing, fetching). */
  busy: string | null;
  /** Bumped when which projects are in the library changes. */
  revision: number;
  /** Copies no longer used (see `leftovers`), to show and remove. */
  leftovers: string[];
  /** How each library project's last background sync went, by folder. */
  states: Record<string, ProjectSyncState>;
  /** Projects synced so far in this round, and the one under way. */
  progress: { done: number; total: number; name: string } | null;
  error: string | null;

  /** Connects, if this device is linked (on start). */
  init: () => Promise<void>;
  /** Makes a library of this device's projects, to link others to. */
  create: () => Promise<void>;
  /** Links this device to another's library (its link or code). */
  linkTo: (text: string) => Promise<void>;
  /** This device leaves; its projects stay, and stay shared. */
  unlink: () => Promise<void>;
  /** Everything now: projects listed and fetched, each one synced, app data. */
  syncNow: () => Promise<void>;
  /** One project (by folder) synced now. */
  syncProject: (root: string) => Promise<void>;
  /** A project on, or off, the other devices. */
  setOnDevices: (id: string, on: boolean) => void;
  /** A new library (new key): for a lost device, which keeps the old one. */
  startOver: () => Promise<void>;
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
  /** Taken off the other devices: kept (so it isn't added again), not
   * fetched; copies already on a device stay there. */
  removed?: boolean;
  /** Shared with other people too, not only between one's devices. */
  people?: boolean;
  /** Its type on the home screen (Article, Thesis…), one's own setting. */
  type?: string | null;
  /** Starred on the home screen. */
  favorite?: boolean;
  /** Where its folder is, under the home folder (`@home/Seafile/…`): a
   * device whose cloud app already put it there uses that folder. */
  where?: string;
  /** Retired as the same folder as another entry. */
  duplicateOf?: string;
}

export interface LibraryProject {
  id: string;
  name: string;
  removed: boolean;
}

let session: SharedSession | null = null;
const cleanup: Array<() => void> = [];
let reconciling: Promise<void> | null = null;
let again = false;
/** Stores changed by another device: read again from what's saved. */
async function reloadStores(keys: string[]) {
  const loaders: Record<string, () => Promise<unknown>> = {
    "latex4all-settings": () =>
      import("@/stores/settings-store").then((m) =>
        m.useSettingsStore.persist.rehydrate(),
      ),
    "latex4all-projects": () =>
      Promise.resolve(useProjectStore.persist.rehydrate()),
    "project-folders": () =>
      import("@/stores/project-folders-store").then((m) =>
        m.useProjectFolders.persist.rehydrate(),
      ),
    "latex4all-bookmarks": () =>
      import("@/stores/bookmark-store").then((m) =>
        m.useBookmarkStore.persist.rehydrate(),
      ),
    "latex4all-dock": () =>
      import("@/stores/dock-store").then((m) =>
        m.useDockStore.persist.rehydrate(),
      ),
    "latex4all-vault": () =>
      import("@/stores/vault-store").then((m) =>
        m.useVaultStore.persist.rehydrate(),
      ),
    "latex4all-zotero": () =>
      import("@/stores/zotero-store").then((m) =>
        m.useZoteroStore.persist.rehydrate(),
      ),
    "latex4all-ai-usage": () =>
      import("@/lib/ai-usage").then((m) => m.useAiUsage.persist.rehydrate()),
    "latex4all-agent-accounts": () =>
      import("@/lib/agent-accounts").then((m) =>
        m.useAgentAccounts.persist.rehydrate(),
      ),
    "planner-own-lists": () =>
      import("@/lib/plan/plan-store").then((m) =>
        m.useOwnLists.persist.rehydrate(),
      ),
    "reading-queue": () =>
      import("@/components/planner/reading-home").then((m) =>
        m.useQueue.persist.rehydrate(),
      ),
    "latex4all-collab": () =>
      Promise.resolve(useCollabStore.persist.rehydrate()),
  };
  for (const key of keys) {
    await loaders[key]?.().catch((err) =>
      log.warn("Couldn't reload a synced store", { key, error: String(err) }),
    );
  }
}

/** Copies fetched before a project's own (cloud-synced) folder was found
 * here: off the home screen, left on disk for the person to remove. */
const LEFTOVERS = "latex4all-library-leftovers";
const leftovers = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(LEFTOVERS) ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
);

/** When each project last synced in the background, by folder. */
const lastBackground = new Map<string, number>();

/** Projects that are in the library (synced between one's own devices),
 * as opposed to shared with other people. */
const LIBRARY_ROOTS = "latex4all-library-roots";

export function libraryRoots(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIBRARY_ROOTS) ?? "[]"));
  } catch {
    return new Set();
  }
}

function markLibrary(root: string) {
  const roots = libraryRoots();
  if (roots.has(root)) return;
  roots.add(root);
  try {
    localStorage.setItem(LIBRARY_ROOTS, JSON.stringify([...roots]));
  } catch {
    // Shown as shared until next time.
  }
  useLibraryStore.setState((st) => ({ revision: st.revision + 1 }));
}

/**
 * A project fetched before its name was known ("Shared project 2") gets
 * its own name once the shared copy says it: the folder is renamed.
 */
async function nameFetched(root: string, listed?: string) {
  const parts = root.split(/[\\/]/);
  const base = parts.pop() ?? "";
  if (!isPlaceholderName(base)) return;
  const saved = await loadDoc(root).catch(() => null);
  if (!saved) return;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, saved.data);
    const shared = doc.getMap<string>("meta").get("name")?.trim();
    // The shared copy's name, or else the library's (from the device that
    // has the project), never a placeholder.
    const name = !isPlaceholderName(shared)
      ? shared
      : !isPlaceholderName(listed)
        ? listed?.trim()
        : undefined;
    if (!name || name === base || /[\\/:*?"<>|]/.test(name)) return;
    const target = [...parts, name].join(root.includes("\\") ? "\\" : "/");
    if (await exists(target).catch(() => true)) return;
    await rename(root, target);
    const projects = useProjectStore.getState();
    projects.renameRecentProject(root, target);
    void usePlanStore.getState().load(projectKey(target));
    moveShareOwner(root, target);
    const info = await readLink(target).catch(() => null);
    if (info) projects.rememberSharedProject(info.projectId, target);
    const roots = libraryRoots();
    roots.delete(root);
    roots.add(target);
    localStorage.setItem(LIBRARY_ROOTS, JSON.stringify([...roots]));
  } catch (err) {
    log.warn("Couldn't name a fetched project", { root, error: String(err) });
  } finally {
    doc.destroy();
  }
}

/** App data as it was when last in step (see app-data-sync). */
let appKnown: AppKnown = {};
/** Each project's type as last in step with the library, by project id. */
let typesKnown: Record<string, string | null> = {};
/** Each saved store as last in step with the library (app-state-sync). */
let stateKnown: StateKnown = {};

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
    const all = [...projectsMap(session.doc).entries()];
    const ids = all.filter(([, e]) => !e.removed).map(([id]) => id);
    set({
      devices,
      projects: ids.length,
      here: ids.filter((id) => shared[id]).length,
      list: all
        .map(([id, e]) => ({ id, name: e.name, removed: !!e.removed }))
        .sort((a, b) => a.name.localeCompare(b.name)),
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
    // What went wrong this pass, with its code (docs/sync.md).
    const problems: string[] = [];

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
        // For the library, not for people.
        unmarkSharedWithPeople(project.path);
        info = await readLink(project.path).catch(() => null);
      }
      if (!info) {
        set({ busy: `Sharing ${project.name}…` });
        info = await shareInBackground(project.path).catch((err) => {
          log.warn("Couldn't share for linked devices", {
            path: project.path,
            error: String(err),
          });
          problems.push(`Couldn't add ${project.name} (L03)`);
          return null;
        });
      }
      if (info) markLibrary(project.path);
      if (info && !projects.has(info.projectId)) {
        projects.set(info.projectId, {
          link: info.link,
          name: project.name,
          by: me,
          at: Date.now(),
          people: sharedWithPeople().has(project.path),
        });
      }
    }

    // Where each project's folder is, as this device has it.
    const homeMap = await pathMap({});
    for (const [id, entry] of projects) {
      const root = useProjectStore.getState().sharedProjects[id];
      if (!root || entry.removed) continue;
      const info = await readLink(root).catch(() => null);
      if (info?.projectId !== id) continue;
      const where = portable(root, homeMap);
      if (where.startsWith("@home") && entry.where !== where) {
        projects.set(id, { ...(projects.get(id) ?? entry), where });
      }
    }
    // Two entries for one folder (each device shared its cloud copy before
    // they were linked): the first stays, the other is retired.
    const byWhere = new Map<string, string>();
    for (const [id, entry] of [...projects.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )) {
      if (entry.removed || !entry.where) continue;
      const first = byWhere.get(entry.where);
      if (first && first !== id) {
        projects.set(id, { ...entry, removed: true, duplicateOf: first });
      } else byWhere.set(entry.where, id);
    }

    // A project already here because a cloud app syncs its folder: that
    // folder is used, rather than a copy fetched beside it.
    for (const [id, entry] of projects) {
      if (session !== s || entry.removed || !entry.where) continue;
      const there = local(entry.where, homeMap);
      if (!there || !(await exists(there).catch(() => false))) continue;
      const current = useProjectStore.getState().sharedProjects[id];
      if (current === there) continue;
      if (useDocumentStore.getState().projectRoot === there) continue;
      const link = await readLink(there).catch(() => null);
      if (link && link.projectId !== id) {
        // Its own identity: kept if it's shared with people (switching it
        // would leave them); otherwise it takes the library's.
        if (sharedWithPeople().has(there) && !entry.people) continue;
      }
      if (link?.projectId !== id) await writeLink(there, entry.link);
      const projectsStore = useProjectStore.getState();
      projectsStore.rememberSharedProject(id, there);
      projectsStore.addRecentProject(there);
      markLibrary(there);
      if (current && current !== there) {
        // The copy fetched earlier: off the home screen, left on disk.
        projectsStore.removeRecentProject(current);
        leftovers.add(current);
        try {
          localStorage.setItem(LEFTOVERS, JSON.stringify([...leftovers]));
        } catch {
          // Shown until the app closes.
        }
        useLibraryStore.setState({ leftovers: [...leftovers] });
      }
    }

    // The list's projects this device lacks, fetched into its folder.
    const store = useProjectStore.getState();
    const parent = store.lastProjectFolder ?? (await defaultProjectFolder());
    // Every project here by its id, wherever it is now (a moved or renamed
    // folder isn't fetched again as a copy).
    const hereIds = new Set<string>();
    for (const p of useProjectStore.getState().recentProjects) {
      const info = await readLink(p.path).catch(() => null);
      if (info) {
        hereIds.add(info.projectId);
        if (store.sharedProjects[info.projectId] !== p.path) {
          useProjectStore
            .getState()
            .rememberSharedProject(info.projectId, p.path);
        }
      }
    }
    for (const [id, entry] of projects) {
      if (entry.removed || hereIds.has(id)) continue;
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
        markLibrary(path);
        if (entry.people) markSharedWithPeople(path);
      } catch (err) {
        log.warn("Couldn't fetch a linked project", {
          name: entry.name,
          error: String(err),
        });
        problems.push(`Couldn't get ${entry.name} (L02)`);
      }
    }
    // Every project's files, brought up to date in the background (one at
    // a time; each at most every ten minutes; the open one syncs live).
    const due: Array<{ root: string; entry: Entry }> = [];
    for (const [, entry] of projects) {
      if (session !== s || entry.removed) continue;
      const info = await parseLink(entry.link).catch(() => null);
      const root =
        info && useProjectStore.getState().sharedProjects[info.projectId];
      if (!root) continue;
      markLibrary(root);
      const last = lastBackground.get(root) ?? 0;
      if (Date.now() - last < 10 * 60 * 1000) continue;
      due.push({ root, entry });
    }
    for (const [i, { root, entry }] of due.entries()) {
      if (session !== s) break;
      lastBackground.set(root, Date.now());
      set({
        busy: `Syncing ${entry.name}…`,
        progress: { done: i, total: due.length, name: entry.name },
      });
      setState(root, "syncing");
      try {
        await syncInBackground(root, entry.link, entry.name);
        setState(root, "synced");
        await nameFetched(root, entry.name);
      } catch (err) {
        lastBackground.set(root, 0);
        setState(root, String(err).includes("offline") ? "offline" : "error");
        log.warn("Background sync failed", {
          name: entry.name,
          error: String(err),
        });
        if (String(err).includes("offline")) break;
        problems.push(`Couldn't sync ${entry.name} (L02)`);
      }
    }
    set({ progress: null });

    // Each project's type: changed here goes to the library, changed on
    // another device comes here.
    for (const [id, entry] of projects) {
      if (session !== s || entry.removed) continue;
      const root = useProjectStore.getState().sharedProjects[id];
      if (!root) continue;
      const mine = await readProjectMeta(root).catch(() => null);
      if (!mine) continue;
      const here =
        typeof mine.type === "string" && mine.type ? mine.type : null;
      const known = id in typesKnown ? typesKnown[id] : undefined;
      const theirs = entry.type ?? null;
      if (here !== (known ?? null) && (known !== undefined || here !== null)) {
        // Changed here (or first seen with one): into the library.
        if (theirs !== here) projects.set(id, { ...entry, type: here });
        typesKnown[id] = here;
      } else if (theirs !== (known ?? null)) {
        // Changed on another device: onto this one.
        await writeProjectType(root, theirs).catch(() => {});
        useProjectStore.getState().cacheProjectType(root, theirs);
        typesKnown[id] = theirs;
      }
    }

    // The app's own data (Planner lists, highlights) too.
    if (session === s) {
      appKnown = await syncAppData(doc, appKnown);
      // And everything else it keeps: a replica (app-state-sync).
      const roots: Record<string, string> = {};
      const shared = useProjectStore.getState().sharedProjects;
      for (const id of projects.keys()) if (shared[id]) roots[id] = shared[id];
      const result = syncAppState(doc, stateKnown, await pathMap(roots));
      stateKnown = result.known;
      if (result.changed.length) await reloadStores(result.changed);
      s.scheduleSave();
    }
    set({ error: problems.length ? problems.join(" · ") : null });
    refresh();
  }

  async function start(link: string) {
    await stop();
    const root = await libraryRoot();
    const saved = await loadDoc(root).catch(() => null);
    try {
      const local = JSON.parse(saved?.local || "{}");
      appKnown = local.app ?? {};
      typesKnown = local.types ?? {};
      stateKnown = local.state ?? {};
    } catch {
      appKnown = {};
    }
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
        local: () => ({
          app: appKnown,
          types: typesKnown,
          state: stateKnown,
        }),
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
    // App data changed on this device: looked at now and then.
    const every = setInterval(() => void reconcile(), 30_000);
    cleanup.push(() => clearInterval(every));
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
    list: [],
    here: 0,
    busy: null,
    revision: 0,
    states: {},
    progress: null,
    leftovers: [...leftovers],
    error: null,

    syncNow: async () => {
      lastBackground.clear();
      await reconcile();
    },

    syncProject: async (root) => {
      const s = session;
      if (!s) return;
      for (const [, entry] of projectsMap(s.doc)) {
        const info = await parseLink(entry.link).catch(() => null);
        if (
          !info ||
          useProjectStore.getState().sharedProjects[info.projectId] !== root
        ) {
          continue;
        }
        setState(root, "syncing");
        lastBackground.set(root, Date.now());
        try {
          await syncInBackground(root, entry.link, entry.name);
          setState(root, "synced");
          await nameFetched(root, entry.name);
        } catch (err) {
          setState(root, String(err).includes("offline") ? "offline" : "error");
        }
        return;
      }
    },

    setOnDevices: (id, on) => {
      const projects = session && projectsMap(session.doc);
      const entry = projects?.get(id);
      if (!projects || !entry) return;
      projects.set(id, { ...entry, removed: !on });
      refresh();
      if (on) void reconcile();
    },

    startOver: async () => {
      await get().unlink();
      await get().create();
    },

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
        ? await resolveCode(trimmed).catch((err) => {
            throw new Error(
              `${err instanceof Error ? err.message : err} (L01)`,
            );
          })
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
        list: [],
        here: 0,
        busy: null,
        error: null,
      });
    },
  };
});
