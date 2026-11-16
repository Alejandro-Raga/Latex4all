/**
 * Where plans are read and written.
 *
 * - A project's plan is Plan.md at its root. While the project is open it
 *   goes through the open files, so a shared project's collaborators get
 *   each change as it's made; otherwise it's read from and written to disk.
 * - The Inbox, for what belongs to no project, is Tasks/Inbox.md in the
 *   vault, so it's on the phone too through the vault's own sync.
 */
import { useEffect, useMemo } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";
import { useVaultStore } from "@/stores/vault-store";
import { PLAN_FILE } from "./plan-file";

export const INBOX = "inbox";
export const INBOX_PATH = "Tasks/Inbox.md";

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
      await useVaultStore.getState().ensureVault();
      const source = useVaultStore.getState().source;
      if (!source) {
        entry = { text: null };
      } else {
        try {
          const { text, version } = await source.readNote(INBOX_PATH);
          entry = { text, version };
        } catch {
          entry = { text: null };
        }
      }
    }
    set((s) => ({ entries: { ...s.entries, [key]: entry } }));
  },

  write: async (key, text) => {
    const root = rootOf(key);
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
    const vault = useVaultStore.getState();
    await vault.ensureVault();
    const source = useVaultStore.getState().source;
    if (!source) throw new Error("Connect your vault for an Inbox.");
    const known = get().entries[key];
    if (known?.text == null) {
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
  },
}));

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

/** Writes a plan, wherever it lives. */
export const writePlan = (key: PlanKey, text: string) =>
  usePlanStore.getState().write(key, text);

export interface PlanList {
  key: PlanKey;
  name: string;
  /** The project's folder; none for the Inbox. */
  root?: string;
}

/** The plans the Planner shows: the Inbox, then recent projects. */
export function usePlanLists(): PlanList[] {
  const recent = useProjectStore((s) => s.recentProjects);
  return useMemo(
    () => [
      { key: INBOX, name: "Inbox" },
      ...[...recent]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ key: projectKey(p.path), name: p.name, root: p.path })),
    ],
    [recent],
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
