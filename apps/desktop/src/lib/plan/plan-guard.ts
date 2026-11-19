/**
 * Plan.md sits in the project's folder where it can look like a stray file
 * and be thrown away, taking the project's tasks, deadline and priority
 * with it (and, in a shared or synced project, from every copy). So the app
 * keeps a copy of each project's plan in its own folder, and quietly puts
 * the file back if it disappears.
 */

import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { md5 } from "@/lib/md5";
import { writeTextSafely } from "@/lib/safe-write";
import { useDocumentStore } from "@/stores/document-store";

const PLAN_FILE = "Plan.md";

async function backupFile(root: string): Promise<string> {
  const dir = await join(await appDataDir(), "plan-backups");
  await mkdir(dir, { recursive: true }).catch(() => {});
  const id = md5(new TextEncoder().encode(root.replace(/[\\/]+$/, "")));
  return join(dir, `${id}.md`);
}

/** What was last backed up, per project: not written again if the same. */
const lastSaved = new Map<string, string>();
/** Restores under way, so one deletion brings one notice. */
const restoring = new Set<string>();

/** Keeps a copy of a project's plan, as it now reads. */
export async function backUpPlan(root: string, text: string) {
  if (!text.trim() || lastSaved.get(root) === text) return;
  lastSaved.set(root, text);
  try {
    await writeTextSafely(await backupFile(root), text);
  } catch {
    lastSaved.delete(root);
  }
}

/**
 * The project's Plan.md is gone: put back from the copy, if there is one
 * and it wasn't let go. Returns the text put back, or null.
 */
export async function restorePlan(
  root: string,
  /** Called once it's back on disk (to re-read the folder, say). */
  afterwards?: () => void | Promise<void>,
): Promise<string | null> {
  if (restoring.has(root)) return null;
  restoring.add(root);
  try {
    const copy = await backupFile(root);
    if (!(await exists(copy).catch(() => false))) return null;
    const text = await readTextFile(copy);
    if (!text.trim()) return null;
    const target = `${root.replace(/[\\/]+$/, "")}/${PLAN_FILE}`;
    // The folder itself gone (project moved or deleted): nothing to do.
    if (!(await exists(root).catch(() => false))) return null;
    if (await exists(target).catch(() => true)) return null;
    await writeTextFile(target, text);
    lastSaved.set(root, text);
    await afterwards?.();
    return text;
  } catch {
    return null;
  } finally {
    restoring.delete(root);
  }
}

/**
 * The open project's Plan.md: backed up as it changes, put back if it
 * leaves the project's files (deleted in Finder or Explorer meanwhile).
 */
export function followOpenPlan(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useDocumentStore.subscribe((state, prev) => {
    const root = state.projectRoot;
    if (!root || state.files === prev.files) return;
    const plan = state.files.find((f) => f.relativePath === PLAN_FILE);
    const had =
      prev.projectRoot === root &&
      prev.files.some((f) => f.relativePath === PLAN_FILE);
    if (plan?.content !== undefined) {
      if (timer) clearTimeout(timer);
      const text = plan.content;
      timer = setTimeout(() => void backUpPlan(root, text), 2000);
    } else if (had && !plan) {
      void restorePlan(root, () => useDocumentStore.getState().refreshFiles());
    }
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
