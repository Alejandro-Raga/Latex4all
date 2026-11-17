/**
 * Where plans are read and written.
 *
 * - A project's plan is Plan.md at its root. While the project is open it
 *   goes through the open files, so a shared project's collaborators get
 *   each change as it's made; otherwise it's read from and written to disk.
 * - The Inbox, for what belongs to no project, lists of one's own
 *   (Teaching, Admin…) and general reading are kept in the app's own
 *   folder, one file each. Not in the vault: it's for ideas, not for
 *   organising. Earlier versions kept them in the vault's Tasks folder;
 *   what's there comes along the first time a list is read (the vault's
 *   copy is left as it was, and lists found there join the Planner).
 */
import { useEffect, useMemo } from "react";
import { appDataDir, join as joinPath } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";
import { useVaultStore } from "@/stores/vault-store";
import { PLAN_FILE } from "./plan-file";

export const INBOX = "inbox";
/** Reading that belongs to no project: its own file, not a task list. */
export const READING = "reading";
export const INBOX_PATH = "Tasks/Inbox.md";

/** A plan's key: "inbox", "list:" and a list's file name, or "project:"
 *  and the project's folder. */
export type PlanKey = string;

export const projectKey = (root: string): PlanKey => `project:${root}`;
export const listKey = (file: string): PlanKey => `list:${file}`;
export const isProjectKey = (key: PlanKey) => key.startsWith("project:");
/** The Inbox or a list of one's own: no project. */
export const isPersonalKey = (key: PlanKey) => !isProjectKey(key);

/** A personal plan's file name, without ".md": "Inbox", "Teaching". */
const fileOf = (key: PlanKey) =>
  key === INBOX
    ? "Inbox"
    : key === READING
      ? "Reading"
      : key.slice("list:".length);
/** Where it is in the vault. */
export const vaultPathOf = (key: PlanKey) =>
  key === INBOX ? INBOX_PATH : `Tasks/${fileOf(key)}.md`;

/** A personal plan when there's no vault: in the app's own folder. */
async function localFile(key: PlanKey): Promise<string> {
  const dir = await joinPath(await appDataDir(), "planner");
  await mkdir(dir, { recursive: true }).catch(() => {});
  return joinPath(dir, `${fileOf(key)}.md`);
}

async function readLocal(key: PlanKey): Promise<string | null> {
  try {
    return await readTextFile(await localFile(key));
  } catch {
    return null;
  }
}
const rootOf = (key: PlanKey) =>
  key.startsWith("project:") ? key.slice("project:".length) : null;

const join = (root: string, rel: string) =>
  `${root.replace(/[\\/]+$/, "")}/${rel}`;

interface Entry {
  /** null: no plan yet (or no vault, for the Inbox). */
  text: string | null;
  /** The vault's version of the Inbox, to write over it safely. */
  version?: string | null;
  /** The Inbox is in the vault (not yet: in the app's folder). */
  inVault?: boolean;
}

interface PlanState {
  entries: Record<PlanKey, Entry>;
  load: (key: PlanKey) => Promise<void>;
  write: (key: PlanKey, text: string) => Promise<void>;
}

/** The open project's Plan.md among its files, if it has one. */
function openPlanFile(root: string) {
  const doc = useDocumentStore.getState();
  if (doc.projectRoot !== root) return undefined;
  return doc.files.find((f) => f.relativePath === PLAN_FILE) ?? null;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  entries: {},

  load: async (key) => {
    const root = rootOf(key);
    let entry: Entry;
    if (root) {
      const open = openPlanFile(root);
      if (open !== undefined) return; // Read live from the open files.
      try {
        entry = { text: await readTextFile(join(root, PLAN_FILE)) };
      } catch {
        entry = { text: null };
      }
    } else {
      let text = await readLocal(key);
      if (text === null) text = await fromVault(key);
      entry = { text };
    }
    set((s) => ({ entries: { ...s.entries, [key]: entry } }));
  },

  write: async (key, text) => {
    const root = rootOf(key);
    // Shown at once; saved after (a dropped task lands where it was dropped).
    const known = get().entries[key];
    if (known !== undefined || !root || openPlanFile(root) === undefined) {
      set((s) => ({ entries: { ...s.entries, [key]: { ...known, text } } }));
    }
    try {
      await saveTo(key, root, text);
    } catch (err) {
      await get().load(key);
      throw err;
    }
  },
}));

async function saveTo(key: PlanKey, root: string | null, text: string) {
  const set = usePlanStore.setState;
  if (root) {
    const open = openPlanFile(root);
    if (open) {
      const doc = useDocumentStore.getState();
      doc.updateFileContent(open.id, text);
      await doc.saveFile(open.id);
      return;
    }
    await writeTextFile(join(root, PLAN_FILE), text);
    if (open === null) {
      // A new file in the open project: it joins its files (and the share).
      await useDocumentStore.getState().refreshFiles();
      return;
    }
    set((s) => ({ entries: { ...s.entries, [key]: { text } } }));
    return;
  }
  await writeTextFile(await localFile(key), text);
  set((s) => ({ entries: { ...s.entries, [key]: { text } } }));
}

/**
 * A list once kept in the vault (Tasks/Inbox.md…), copied to the app's
 * folder the first time it's read there; null if there's none.
 */
async function fromVault(key: PlanKey): Promise<string | null> {
  try {
    await useVaultStore
      .getState()
      .ensureVault()
      .catch(() => {});
    const source = useVaultStore.getState().source;
    if (!source) return null;
    const { text } = await source.readNote(vaultPathOf(key));
    if (text) await writeTextFile(await localFile(key), text);
    return text ?? null;
  } catch {
    return null;
  }
}

/** A plan's text as it is now, kept current; null when there's none yet. */
export function usePlanText(key: PlanKey): string | null | undefined {
  const root = rootOf(key);
  const live = useDocumentStore((s) =>
    root && s.projectRoot === root
      ? (s.files.find((f) => f.relativePath === PLAN_FILE)?.content ?? null)
      : undefined,
  );
  const stored = usePlanStore((s) => s.entries[key]?.text);
  useEffect(() => {
    if (live === undefined) void usePlanStore.getState().load(key);
  }, [key, live === undefined]);
  return live !== undefined ? live : stored;
}

/** A plan's text right now, outside React (for moving tasks between plans). */
export function planTextNow(key: PlanKey): string | null | undefined {
  const root = rootOf(key);
  const doc = useDocumentStore.getState();
  if (root && doc.projectRoot === root) {
    return doc.files.find((f) => f.relativePath === PLAN_FILE)?.content ?? null;
  }
  return usePlanStore.getState().entries[key]?.text;
}

/** Writes a plan, wherever it lives. */
export const writePlan = (key: PlanKey, text: string) =>
  usePlanStore.getState().write(key, text);

export interface PlanList {
  key: PlanKey;
  name: string;
  /** The project's folder; none for the Inbox. */
  root?: string;
  /** Its type ("Article", "Thesis"…), if it has one. */
  type?: string;
  lastOpened?: number;
  /** A list of one's own (not the Inbox, not a project). */
  personal?: boolean;
  /** Its color, for a list of one's own. */
  color?: string;
}

export interface OwnList {
  /** Its file's name, which is also its name. */
  file: string;
  color?: string;
}

/** Lists of one's own (Teaching, Admin…), in the order they were made. */
export const useOwnLists = create<{
  lists: OwnList[];
  add: (name: string, color?: string) => PlanKey | null;
  remove: (file: string) => void;
  setColor: (file: string, color?: string) => void;
}>()(
  persist(
    (set, get) => ({
      lists: [],
      add: (name, color) => {
        const file = name
          .replace(/[\\/:*?"<>|#^[\]]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        if (!file || /^(inbox|reading)$/i.test(file)) return null;
        if (
          !get().lists.some((l) => l.file.toLowerCase() === file.toLowerCase())
        ) {
          set((s) => ({ lists: [...s.lists, { file, color }] }));
        }
        return listKey(file);
      },
      remove: (file) =>
        set((s) => ({ lists: s.lists.filter((l) => l.file !== file) })),
      setColor: (file, color) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.file === file ? { ...l, color } : l)),
        })),
    }),
    { name: "planner-own-lists" },
  ),
);

/** Lists found in the vault's Tasks folder that this computer hasn't seen. */
function vaultLists(paths: string[], known: OwnList[]): OwnList[] {
  const out: OwnList[] = [];
  for (const path of paths) {
    const m = /^Tasks\/([^/]+)\.md$/.exec(path);
    if (!m || /^(inbox|reading)$/i.test(m[1])) continue;
    if (known.some((l) => l.file === m[1])) continue;
    out.push({ file: m[1] });
  }
  return out;
}

/** General reading, as a list (it isn't among the task lists). */
export const READING_LIST: PlanList = { key: READING, name: "Reading" };

/** The plans the Planner shows: the Inbox, then recent projects. */
export function usePlanLists(): PlanList[] {
  const recent = useProjectStore((s) => s.recentProjects);
  const types = useProjectStore((s) => s.projectTypes);
  const own = useOwnLists((s) => s.lists);
  const vaultPaths = useVaultStore((s) => s.index?.list);
  return useMemo(
    () => [
      { key: INBOX, name: "Inbox" },
      ...[...own, ...vaultLists(vaultPaths?.map((n) => n.path) ?? [], own)].map(
        (l) => ({
          key: listKey(l.file),
          name: l.file,
          personal: true,
          color: l.color,
        }),
      ),
      ...recent.map((p) => ({
        key: projectKey(p.path),
        name: p.name,
        root: p.path,
        type: types?.[p.path],
        lastOpened: p.lastOpened,
      })),
    ],
    [recent, types, own, vaultPaths],
  );
}

/** Reads every plan again: on showing the Planner, and on coming back to it. */
export function useReloadPlans(keys: PlanKey[]) {
  useEffect(() => {
    const reload = () => {
      for (const key of keys) void usePlanStore.getState().load(key);
    };
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [keys.join("\n")]);
}

/** Several plans' texts at once, the open project's read live. */
export function usePlanTexts(
  keys: PlanKey[],
): Record<PlanKey, string | null | undefined> {
  const openRoot = useDocumentStore((s) => s.projectRoot);
  const openText = useDocumentStore(
    (s) => s.files.find((f) => f.relativePath === PLAN_FILE)?.content ?? null,
  );
  const entries = usePlanStore((s) => s.entries);
  return useMemo(() => {
    const out: Record<PlanKey, string | null | undefined> = {};
    for (const key of keys) {
      out[key] =
        openRoot && key === projectKey(openRoot)
          ? openText
          : entries[key]?.text;
    }
    return out;
  }, [keys.join("\n"), openRoot, openText, entries]);
}

/** Asks the start page to show the Planner (from a notice, say). */
export const usePlannerRequest = create<{
  asked: number;
  ask: () => void;
  /** Done with: the start page went to the Planner. */
  done: () => void;
}>((set) => ({
  asked: 0,
  ask: () => set((s) => ({ asked: s.asked + 1 })),
  done: () => set({ asked: 0 }),
}));

/** Back to the Planner: out of the open project, to the start page's Planner. */
export function backToPlanner() {
  const doc = useDocumentStore.getState();
  if (doc.projectRoot) doc.closeProject();
  usePlannerRequest.getState().ask();
}
