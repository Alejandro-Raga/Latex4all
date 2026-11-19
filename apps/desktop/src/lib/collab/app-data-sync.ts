/**
 * App data between linked devices: the app's own Planner lists (Inbox,
 * lists of one's own, reading — when there's no vault to keep them) and
 * highlights on PDFs that aren't in Zotero. Each file is a text in the
 * library's document, under its path in the app's folder.
 *
 * A file changed here goes in as the words that changed, so edits made on
 * two devices at once both stay; the merged text comes back to disk. A JSON
 * file that doesn't parse once merged takes this device's version instead.
 * A file deleted on one device is deleted on the others, unless it changed
 * there since.
 */

import * as Y from "yjs";
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { applyTextChange, textHash } from "./project-doc";
import { writeTextSafely } from "@/lib/safe-write";
import { INBOX, listKey, READING, usePlanStore } from "@/lib/plan/plan-store";

/** The folders synced, inside the app's data folder. */
const FOLDERS = ["planner", "pdf-notes"];
/** Past this a file stays on its device (a highlights file is a few KB). */
const MAX_BYTES = 2 * 1024 * 1024;

export function appFiles(doc: Y.Doc) {
  return doc.getMap<Y.Text>("appFiles");
}

/** What each file was the last time it was in step: path → hash. */
export type AppKnown = Record<string, string>;

async function localFiles(): Promise<Map<string, string>> {
  const base = await appDataDir();
  const out = new Map<string, string>();
  for (const folder of FOLDERS) {
    const dir = await join(base, folder);
    if (!(await exists(dir).catch(() => false))) continue;
    for (const entry of await readDir(dir).catch(() => [])) {
      if (!entry.isFile || !/\.(md|json)$/.test(entry.name)) continue;
      const text = await readTextFile(await join(dir, entry.name)).catch(
        () => null,
      );
      if (text !== null && text.length <= MAX_BYTES) {
        out.set(`${folder}/${entry.name}`, text);
      }
    }
  }
  return out;
}

async function writeLocal(path: string, text: string) {
  const [folder, name] = path.split("/");
  if (!FOLDERS.includes(folder) || !name || name.includes("..")) return;
  const dir = await join(await appDataDir(), folder);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await writeTextSafely(await join(dir, name), text);
}

async function removeLocal(path: string) {
  const [folder, name] = path.split("/");
  if (!FOLDERS.includes(folder) || !name || name.includes("..")) return;
  await remove(await join(await appDataDir(), folder, name)).catch(() => {});
}

function parses(path: string, text: string) {
  if (!path.endsWith(".json")) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Two versions of a file that grew apart before the devices were linked:
 * a list keeps all of its lines (theirs, then this device's lines they
 * lack); highlights keep every note of both.
 */
export function combine(path: string, theirs: string, mine: string): string {
  if (path.endsWith(".json")) {
    try {
      const a = JSON.parse(theirs);
      const b = JSON.parse(mine);
      const seen = new Set<string>();
      const notes = [...(a.notes ?? []), ...(b.notes ?? [])].filter((n) => {
        const key = n?.id ?? JSON.stringify(n);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return JSON.stringify({ ...b, ...a, notes });
    } catch {
      return parses(path, mine) ? mine : theirs;
    }
  }
  const have = new Set(theirs.split("\n"));
  const extra = mine.split("\n").filter((l) => l.trim() && !have.has(l));
  if (extra.length === 0) return theirs;
  return `${theirs.replace(/\n*$/, "\n")}${extra.join("\n")}\n`;
}

/** The Planner list a file in `planner/` is, to read it again. */
function planKeyOf(path: string) {
  const m = /^planner\/(.+)\.md$/.exec(path);
  if (!m) return null;
  if (m[1] === "Inbox") return INBOX;
  if (m[1] === "Reading") return READING;
  return listKey(m[1]);
}

/**
 * One pass: this device's changes into the document, others' onto disk.
 * Returns what's known afterwards, to keep with the library's document.
 */
export async function syncAppData(
  doc: Y.Doc,
  known: AppKnown,
): Promise<AppKnown> {
  const files = appFiles(doc);
  const local = await localFiles();
  const next: AppKnown = { ...known };
  const written: string[] = [];

  for (const [path, text] of local) {
    const hash = textHash(text);
    const shared = files.get(path);
    if (!shared) {
      // Deleted on another device, and unchanged here since: deleted here.
      if (known[path] === hash) {
        await removeLocal(path);
        delete next[path];
        written.push(path);
        continue;
      }
      const t = new Y.Text();
      t.insert(0, text);
      files.set(path, t);
      next[path] = hash;
      continue;
    }
    if (known[path] === undefined && shared.toString() !== text) {
      // Both devices had it before they met (each its own Inbox): put
      // together, nothing of either dropped.
      const merged = combine(path, shared.toString(), text);
      applyTextChange(shared, merged);
      await writeLocal(path, merged);
      written.push(path);
      next[path] = textHash(merged);
      continue;
    }
    if (hash !== known[path]) {
      // Changed here: the changed words in, so others' edits stay.
      const before = shared.toString();
      applyTextChange(shared, text);
      let merged = shared.toString();
      if (!parses(path, merged)) {
        doc.transact(() => {
          shared.delete(0, shared.length);
          shared.insert(0, text);
        });
        merged = text;
      }
      if (merged !== text) {
        await writeLocal(path, merged);
        written.push(path);
      }
      if (merged !== before || merged !== text) next[path] = textHash(merged);
      else next[path] = hash;
    } else {
      const theirs = shared.toString();
      if (textHash(theirs) !== hash && parses(path, theirs)) {
        await writeLocal(path, theirs);
        written.push(path);
      }
      next[path] = textHash(theirs);
    }
  }

  for (const [path, shared] of files) {
    if (local.has(path)) continue;
    if (known[path] !== undefined) {
      // Deleted here: deleted for the others too.
      files.delete(path);
      delete next[path];
      continue;
    }
    const text = shared.toString();
    if (!parses(path, text)) continue;
    await writeLocal(path, text);
    next[path] = textHash(text);
    written.push(path);
  }

  for (const path of written) {
    const key = planKeyOf(path);
    if (key) void usePlanStore.getState().load(key);
  }
  return next;
}
