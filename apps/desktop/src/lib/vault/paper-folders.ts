/**
 * The vault's papers in their Zotero folders: a tree with only the folders
 * that hold a paper in the vault (and the folders above them), so it grows as
 * papers are added rather than copying the whole library. A paper in several
 * folders is listed in each; one in none, or not from Zotero, is "Unfiled".
 */
import type { ZoteroCollection } from "@/lib/zotero-api";
import type { VaultNote } from "./vault-index";

export interface PaperFolder {
  key: string;
  name: string;
  folders: PaperFolder[];
  /** Papers filed directly here, in the order given. */
  notes: VaultNote[];
  /** Papers here and in every folder below, each counted once. */
  count: number;
}

export const UNFILED_KEY = "\0unfiled";

/**
 * Builds the tree. `collectionsOf` gives a Zotero item's folders (or null when
 * the library doesn't know the item); `collections` is the library's folders.
 */
export function paperFolderTree(
  notes: VaultNote[],
  collections: ZoteroCollection[],
  collectionsOf: (zoteroKey: string) => string[] | null,
): PaperFolder[] {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const nodes = new Map<string, PaperFolder>();
  const roots: PaperFolder[] = [];
  const unfiled: VaultNote[] = [];

  /** The folder's node, made (with those above it) the first time. */
  const node = (key: string): PaperFolder | null => {
    const known = nodes.get(key);
    if (known) return known;
    const c = byKey.get(key);
    if (!c) return null;
    const made: PaperFolder = {
      key,
      name: c.name,
      folders: [],
      notes: [],
      count: 0,
    };
    nodes.set(key, made);
    const parent = c.parentKey ? node(c.parentKey) : null;
    (parent ? parent.folders : roots).push(made);
    return made;
  };

  for (const note of notes) {
    const keys = note.zoteroKey ? collectionsOf(note.zoteroKey) : null;
    const placed = (keys ?? [])
      .map((k) => node(k))
      .filter((f): f is PaperFolder => f !== null);
    if (placed.length === 0) unfiled.push(note);
    for (const f of placed) f.notes.push(note);
  }

  const finish = (folder: PaperFolder): Set<string> => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    const inside = new Set(folder.notes.map((n) => n.name));
    for (const sub of folder.folders)
      for (const n of finish(sub)) inside.add(n);
    folder.count = inside.size;
    return inside;
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of roots) finish(r);
  if (unfiled.length > 0) {
    roots.push({
      key: UNFILED_KEY,
      name: "Unfiled",
      folders: [],
      notes: unfiled,
      count: unfiled.length,
    });
  }
  return roots;
}
