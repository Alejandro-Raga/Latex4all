import { listField, noteName, type ParsedNote, textField } from "./parse";

/** Papers (literature notes) are told apart; everything else is a note. */
export type NoteKind = "paper" | "note";

export interface VaultNote extends ParsedNote {
  kind: NoteKind;
  /** Section it's listed under: "Papers", or its top-level folder ("" at the root). */
  group: string;
  /** Title to show: a paper's title, or the note name. */
  title: string;
  /** Zotero item key, when the note says which item it's about. */
  zoteroKey: string | null;
  citekey: string | null;
  /** Other names the note answers to (its `aliases`). */
  aliases: string[];
  authors: string[];
  year: string | null;
  /** Names of notes this one links to (resolved, no duplicates, not itself). */
  outgoing: string[];
  /** Names of notes that link here. */
  incoming: string[];
  /** Link targets with no note behind them yet. */
  unresolved: string[];
}

export interface VaultIndex {
  /** Keyed by lower-cased note name. */
  notes: Map<string, VaultNote>;
  /** Notes in display order. */
  list: VaultNote[];
}

export const PAPERS_GROUP = "Papers";

// Fields the common Obsidian ↔ Zotero setups (Zotero Integration, ZotLit,
// Citations, custom syncs) use for the citation key and the Zotero item.
const CITEKEY_FIELDS = [
  "citekey",
  "citeKey",
  "citationKey",
  "citation-key",
  "citation_key",
  "bibtex-key",
];
const ZOTERO_FIELDS = [
  "zotero_key",
  "zoteroKey",
  "zotero-key",
  "zotero",
  "itemKey",
];
const PAPER_TAGS = new Set([
  "paper",
  "papers",
  "article",
  "literature",
  "literature-note",
  "literaturenote",
  "reference",
  "source",
  "zotero",
]);
// Fields some templates use instead of tags to say what a note is
// (Zotero Integration's examples use `category: literaturenote`).
const KIND_FIELDS = ["category", "type", "note-type", "notetype", "kind"];
const ZOTERO_ITEM_KEY = /^[A-Z0-9]{8}$/;
// zotero://select/library/items/KEY, …/groups/123/items/KEY, and the
// library-prefixed …/select/items/1_KEY form.
const ZOTERO_SELECT_LINK =
  /zotero:\/\/select\/(?:(?:library|groups\/\d+)\/items\/|items\/\d+_)([A-Z0-9]{8})\b/;
// Better BibTeX's link by citation key: zotero://select/items/@key.
const BBT_SELECT_LINK = /zotero:\/\/select\/items\/@([^\s)\]>"'|]+)/;
// A Dataview-style inline field in the body, as templates often write it:
// "Citekey:: key", "**Citation key**:: key", "- citekey:: @key".
const INLINE_CITEKEY =
  /^[\s>*_-]*(?:\*\*|__)?\s*(?:cite\s*key|citation[\s_-]*key)\s*(?:\*\*|__)?\s*::\s*@?([^\s\]|,;]+)/im;

function firstText(note: ParsedNote, fields: string[]): string | null {
  for (const field of fields) {
    const value = textField(note.frontmatter, field);
    if (value?.trim()) return value.trim();
  }
  return null;
}

function zoteroKeyOf(note: ParsedNote): string | null {
  const field = firstText(note, ZOTERO_FIELDS);
  if (field && ZOTERO_ITEM_KEY.test(field)) return field;
  const link =
    field?.match(ZOTERO_SELECT_LINK) ?? note.body.match(ZOTERO_SELECT_LINK);
  return link?.[1] ?? null;
}

function citekeyOf(note: ParsedNote): string | null {
  const key =
    firstText(note, CITEKEY_FIELDS) ??
    note.body.match(INLINE_CITEKEY)?.[1] ??
    note.body.match(BBT_SELECT_LINK)?.[1] ??
    // Zotero Integration's default: literature notes named @citekey.
    (note.name.startsWith("@") ? note.name.slice(1) : null);
  return key ? key.replace(/^@/, "").trim() || null : null;
}

function describe(note: ParsedNote) {
  const fm = note.frontmatter;
  // Nested tags count by any part: #literature/paper, #source/article.
  const tags = [...listField(fm, "tags"), ...listField(fm, "tag")].flatMap(
    (t) => t.toLowerCase().replace(/^#/, "").split("/"),
  );
  const kinds = KIND_FIELDS.flatMap((f) => listField(fm, f)).map((v) =>
    v.toLowerCase().replace(/^#/, "").replace(/\s+/g, ""),
  );
  const zoteroKey = zoteroKeyOf(note);
  const citekey = citekeyOf(note);
  const authors = [...listField(fm, "authors"), ...listField(fm, "author")];
  const year =
    textField(fm, "year") ??
    textField(fm, "date")?.match(/\b\d{4}\b/)?.[0] ??
    null;
  // A note that names its authors and year is about a publication, however
  // the template that wrote it marks it (many write only these).
  const kind: NoteKind =
    zoteroKey ||
    citekey ||
    tags.some((t) => PAPER_TAGS.has(t)) ||
    kinds.some((k) => PAPER_TAGS.has(k)) ||
    (authors.length > 0 && year)
      ? "paper"
      : "note";
  const aliases = [...listField(fm, "aliases"), ...listField(fm, "alias")]
    .map((a) => a.trim())
    .filter(Boolean);
  const name = note.name.replace(/^@/, "");
  return {
    kind,
    group: kind === "paper" ? PAPERS_GROUP : note.folder,
    title: (kind === "paper" ? textField(fm, "title") : null) ?? name,
    zoteroKey,
    citekey,
    aliases,
    authors,
    year,
  };
}

export function buildVaultIndex(parsed: ParsedNote[]): VaultIndex {
  const notes = new Map<string, VaultNote>();
  // Obsidian links by file name; the first note with a name wins, like it.
  const sorted = [...parsed].sort((a, b) => a.path.localeCompare(b.path));
  for (const note of sorted) {
    const key = note.name.toLowerCase();
    if (notes.has(key)) continue;
    notes.set(key, {
      ...note,
      ...describe(note),
      outgoing: [],
      incoming: [],
      unresolved: [],
    });
  }

  for (const note of notes.values()) {
    const out = new Set<string>();
    const missing = new Set<string>();
    for (const link of note.links) {
      const target = notes.get(noteName(link.target).toLowerCase());
      if (!target) missing.add(link.target);
      else if (target.name !== note.name) out.add(target.name);
    }
    note.outgoing = [...out];
    note.unresolved = [...missing];
    for (const name of out)
      notes.get(name.toLowerCase())?.incoming.push(note.name);
  }

  // Papers first, then folders alphabetically, notes at the root last.
  const rank = (n: VaultNote) =>
    n.group === PAPERS_GROUP
      ? "0"
      : n.group
        ? `1${n.group.toLowerCase()}`
        : "2";
  const list = [...notes.values()].sort(
    (a, b) => rank(a).localeCompare(rank(b)) || a.name.localeCompare(b.name),
  );
  return { notes, list };
}

export function findNote(
  index: VaultIndex,
  name: string,
): VaultNote | undefined {
  return index.notes.get(noteName(name).toLowerCase());
}

/**
 * Notes within `depth` links of `name` (either direction), with the links
 * among them, for a local graph. `ring` is how many steps away a note is.
 */
export function neighbourhood(index: VaultIndex, name: string, depth = 1) {
  const centre = findNote(index, name);
  if (!centre) return { nodes: [], edges: [] };
  const ring = new Map<string, number>([[centre.name, 0]]);
  let frontier = [centre];
  for (let step = 1; step <= depth; step++) {
    const next: VaultNote[] = [];
    for (const note of frontier) {
      for (const n of [...note.outgoing, ...note.incoming]) {
        const other = findNote(index, n);
        if (other && !ring.has(other.name)) {
          ring.set(other.name, step);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const nodes = [...ring.keys()]
    .map((n) => findNote(index, n))
    .filter((n): n is VaultNote => Boolean(n))
    .map((note) => ({ note, ring: ring.get(note.name) ?? 0 }));
  const edges: { from: string; to: string }[] = [];
  for (const { note } of nodes) {
    for (const target of note.outgoing) {
      if (ring.has(target)) edges.push({ from: note.name, to: target });
    }
  }
  return { nodes, edges };
}

export function searchNotes(index: VaultIndex, query: string): VaultNote[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return index.list;
  const scored: { note: VaultNote; score: number }[] = [];
  for (const note of index.list) {
    const head =
      `${note.name} ${note.title} ${note.citekey ?? ""} ${note.authors.join(" ")}`.toLowerCase();
    const body = note.body.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (head.includes(w)) score += 3;
      else if (body.includes(w)) score += 1;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0) scored.push({ note, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.note);
}
