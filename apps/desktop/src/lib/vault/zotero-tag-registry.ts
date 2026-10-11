/**
 * Every idea and topic in the vault as a tag in Zotero, so Zotero suggests
 * the exact name while you tag a paper there (and a near-duplicate isn't
 * made by mistake). Zotero keeps a tag only while an item has it, so one
 * standalone note, "Ideas and topics in your vault", carries them all and
 * lists them; it's kept in step with the vault. Tags already in the library
 * keep their spelling ("Topic: Geography of innovation" isn't doubled as
 * "topic: …"). Only that note is ever changed. A Zotero sync that turns tags
 * into notes skips it: it isn't a paper.
 */
import {
  createZoteroItems,
  updateZoteroItem,
  zoteroFetch,
} from "@/lib/zotero-api";
import { topicId } from "./topics";
import type { VaultIndex } from "./vault-index";
import { pairedTag, type TagType, tagTypes } from "./zotero-tag-notes";

export const REGISTRY_TITLE = "Ideas and topics in your vault";
const KEY_STORAGE = "latex4all-zotero-tag-registry";

export interface Wanted {
  /** Tags to carry, in the library's spelling where it has one. */
  tags: string[];
  /** Note names by type label ("Topic", "Idea", "Method"…), for the note's list. */
  groups: Record<string, string[]>;
}

/** A tag's word and the name's id, for matching spellings. */
function tagId(tag: string): string {
  const m = tag.match(/^\s*([^:/]+?)\s*[:/]\s*(.+)$/);
  return m ? `${m[1].toLowerCase()}:${topicId(m[2])}` : topicId(tag);
}

/**
 * The tags the vault's notes call for: each note of a type with a Zotero tag
 * word (ideas, topics, and your own), by the tag it records if it has one,
 * else "word: name" in the library's spelling where there is one.
 */
export function wantedTags(
  index: VaultIndex,
  existing: string[],
  types: TagType[] = tagTypes([]),
): Wanted {
  const spelling = new Map<string, string>();
  for (const t of existing) {
    const id = tagId(t);
    if (!spelling.has(id)) spelling.set(id, t);
  }
  const groups: Record<string, string[]> = {};
  const tags = new Set<string>();
  for (const n of index.list) {
    const type = types.find((t) => t.kind === n.kind);
    if (!type) continue;
    (groups[type.label] ??= []).push(n.name);
    const recorded = pairedTag(n);
    const tag = recorded ?? `${type.word}: ${n.name}`;
    tags.add(recorded ?? spelling.get(tagId(tag)) ?? tag);
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  for (const names of Object.values(groups)) names.sort(byName);
  return { tags: [...tags].sort(byName), groups };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The note's text: what it's for, and the names. */
export function registryNote(w: Wanted): string {
  const list = (names: string[]) =>
    names.length
      ? `<ul>${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
      : "<p>None yet.</p>";
  const order = Object.keys(w.groups).sort(
    (a, b) =>
      (a === "Topic" ? 0 : a === "Idea" ? 1 : 2) -
        (b === "Topic" ? 0 : b === "Idea" ? 1 : 2) || a.localeCompare(b),
  );
  return (
    `<h1>${REGISTRY_TITLE}</h1>` +
    "<p>Kept by Latex4All, so Zotero suggests these names when you tag a " +
    "paper or a highlight. Changes you make here are replaced.</p>" +
    order
      .map((label) => `<h2>${esc(label)}</h2>${list(w.groups[label])}`)
      .join("")
  );
}

function savedKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

function saveKey(key: string) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Found again by its title next time.
  }
}

interface NoteItem {
  key: string;
  data: { note?: string; tags?: { tag: string }[]; deleted?: number };
}

/** The registry note, by its saved key or else its title. */
async function findRegistry(
  apiKey: string,
  userID: string,
): Promise<NoteItem | null> {
  const key = savedKey();
  if (key) {
    try {
      const item = (await (
        await zoteroFetch(apiKey, `/users/${userID}/items/${key}`)
      ).json()) as NoteItem;
      if (!item.data.deleted) return item;
    } catch {
      // Gone: look for it by title.
    }
  }
  const params = new URLSearchParams({
    itemType: "note",
    q: REGISTRY_TITLE,
    qmode: "everything",
    limit: "10",
  });
  const found = (await (
    await zoteroFetch(apiKey, `/users/${userID}/items/top?${params}`)
  ).json()) as NoteItem[];
  const item = found.find((i) =>
    (i.data.note ?? "").includes(`<h1>${REGISTRY_TITLE}</h1>`),
  );
  if (item) saveKey(item.key);
  return item ?? null;
}

/**
 * Brings the registry note in step with the vault. Returns whether Zotero
 * was changed.
 */
export async function syncTagRegistry(
  apiKey: string,
  userID: string,
  index: VaultIndex,
  types: TagType[] = tagTypes([]),
): Promise<boolean> {
  const existing: string[] = [];
  for (let start = 0; ; start += 100) {
    const page = (await (
      await zoteroFetch(
        apiKey,
        `/users/${userID}/tags?limit=100&start=${start}`,
      )
    ).json()) as { tag: string; meta?: { type?: number } }[];
    // Zotero's automatic tags (from publishers and importers) aren't yours:
    // their spellings aren't followed.
    existing.push(...page.filter((t) => t.meta?.type !== 1).map((t) => t.tag));
    if (page.length < 100) break;
  }
  const wanted = wantedTags(index, existing, types);
  const note = registryNote(wanted);
  const tags = wanted.tags.map((tag) => ({ tag }));

  const item = await findRegistry(apiKey, userID);
  if (!item) {
    if (wanted.tags.length === 0) return false;
    const [made] = await createZoteroItems(apiKey, userID, [
      { itemType: "note", note, tags, collections: [], relations: {} },
    ]);
    if ("key" in made) saveKey(made.key);
    else throw new Error(made.error);
    return true;
  }
  const have = new Set((item.data.tags ?? []).map((t) => t.tag));
  const same =
    have.size === wanted.tags.length && wanted.tags.every((t) => have.has(t));
  if (item.data.note === note && same) return false;
  await updateZoteroItem(apiKey, userID, item.key, { note, tags });
  return true;
}
