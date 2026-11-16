/**
 * Where plans are read and written.
 *
 * - A project's plan is Plan.md at its root. While the project is open it
 *   goes through the open files, so a shared project's collaborators get
 *   each change as it's made; otherwise it's read from and written to disk.
 * - The Inbox, for what belongs to no project, is kept in the app's own
 *   folder; with a vault connected, it's Tasks/Inbox.md there instead (on
 *   the phone too, through the vault's sync), taking along what was kept
 *   in the app the first time it's saved.
 */
import { useEffect, useMemo } from "react";
import { appDataDir, join as joinPath } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";
import { useVaultStore } from "@/stores/vault-store";
import { PLAN_FILE } from "./plan-file";

export const INBOX = "inbox";
export const INBOX_PATH = "Tasks/Inbox.md";

/** The Inbox when there's no vault: in the app's own folder. */
async function localInbox(): Promise<string> {
  const dir = await joinPath(await appDataDir(), "planner");
  await mkdir(dir, { recursive: true }).catch(() => {});
  return joinPath(dir, "Inbox.md");
}

async function readLocalInbox(): Promise<string | null> {
  try {
    return await readTextFile(await localInbox());
  } catch {
    return null;
  }
}

/** A plan's key: "inbox", or "project:" and the project's folder. */
export type PlanKey = string;

export const projectKey = (root: string): PlanKey => `project:${root}`;
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
      await useVaultStore
        .getState()
        .ensureVault()
        .catch(() => {});
      const source = useVaultStore.getState().source;
      if (!source) {
        entry = { text: await readLocalInbox() };
      } else {
        try {
          const { text, version } = await source.readNote(INBOX_PATH);
          entry = { text, version, inVault: true };
        } catch {
          // Not in the vault yet: what the app kept, moved there on saving.
          entry = { text: await readLocalInbox(), inVault: false };
        }
      }
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
  const get = usePlanStore.getState;
  const set = usePlanStore.setState;
  {
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
    await useVaultStore
      .getState()
      .ensureVault()
      .catch(() => {});
    const source = useVaultStore.getState().source;
    if (!source) {
      await writeTextFile(await localInbox(), text);
      set((s) => ({ entries: { ...s.entries, [key]: { text } } }));
      return;
    }
    const known = get().entries[key];
    if (!known?.inVault) {
      try {
        await source.createNote(INBOX_PATH, text);
      } catch {
        await source.writeNote(INBOX_PATH, text);
      }
    } else {
      await source.writeNote(INBOX_PATH, text, known.version);
    }
    useVaultStore.getState().noteWritten(INBOX_PATH, text);
    // The new version, for the next write.
    await get().load(key);
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
}

/** The plans the Planner shows: the Inbox, then recent projects. */
export function usePlanLists(): PlanList[] {
  const recent = useProjectStore((s) => s.recentProjects);
  const types = useProjectStore((s) => s.projectTypes);
  return useMemo(
    () => [
      { key: INBOX, name: "Inbox" },
      ...recent.map((p) => ({
        key: projectKey(p.path),
        name: p.name,
        root: p.path,
        type: types?.[p.path],
        lastOpened: p.lastOpened,
      })),
    ],
    [recent, types],
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
