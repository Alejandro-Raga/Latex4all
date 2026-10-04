/**
 * Searching the vault the way Zotero's search works: free words, plus field
 * conditions typed in (`author:nelson year:1990-2005 topic:"open science"`)
 * or picked in the filter row, and a sort order.
 */
import { topicsOf } from "./topics";
import type { VaultIndex, VaultNote } from "./vault-index";

export type NoteSort =
  | "relevance"
  | "year-desc"
  | "year-asc"
  | "title"
  | "author";

export interface NoteFilter {
  /** Free words: in the title, authors and citation key first, then the text. */
  words: string[];
  authors: string[];
  yearFrom: number | null;
  yearTo: number | null;
  topics: string[];
  kinds: string[];
  tags: string[];
}

export const EMPTY_FILTER: NoteFilter = {
  words: [],
  authors: [],
  yearFrom: null,
  yearTo: null,
  topics: [],
  kinds: [],
  tags: [],
};

const FIELD = /(-?)(\w+):(?:"([^"]*)"|(\S+))|"([^"]+)"|(\S+)/g;

/** A typed query as a filter: `author:`, `year:`, `topic:`, `type:`, `tag:`
 *  conditions (also `a:`, `y:`, `t:`), the rest words to find. */
export function parseNoteQuery(query: string): NoteFilter {
  const f: NoteFilter = {
    words: [],
    authors: [],
    yearFrom: null,
    yearTo: null,
    topics: [],
    kinds: [],
    tags: [],
  };
  for (const m of query.matchAll(FIELD)) {
    const [, , field, quoted, bare, phrase, word] = m;
    if (field) {
      const value = (quoted ?? bare ?? "").trim();
      if (!value) continue;
      switch (field.toLowerCase()) {
        case "author":
        case "a":
          f.authors.push(value.toLowerCase());
          continue;
        case "year":
        case "y": {
          const range = value.match(/^(\d{4})?\s*-\s*(\d{4})?$/);
          const cmp = value.match(/^([<>]=?)(\d{4})$/);
          if (range) {
            if (range[1]) f.yearFrom = Number(range[1]);
            if (range[2]) f.yearTo = Number(range[2]);
          } else if (cmp) {
            const y = Number(cmp[2]);
            if (cmp[1] === ">") f.yearFrom = y + 1;
            if (cmp[1] === ">=") f.yearFrom = y;
            if (cmp[1] === "<") f.yearTo = y - 1;
            if (cmp[1] === "<=") f.yearTo = y;
          } else if (/^\d{4}$/.test(value)) {
            f.yearFrom = f.yearTo = Number(value);
          }
          continue;
        }
        case "topic":
        case "t":
          f.topics.push(value.toLowerCase());
          continue;
        case "type":
        case "kind":
          f.kinds.push(value.toLowerCase());
          continue;
        case "tag":
          f.tags.push(value.replace(/^#/, "").toLowerCase());
          continue;
      }
      // Not a field we know ("http://…", "ratio:2"): an ordinary word.
      f.words.push(m[0].toLowerCase());
      continue;
    }
    f.words.push((phrase ?? word).toLowerCase());
  }
  return f;
}

/** Two filters as one: the typed one and the one picked in the filter row. */
export function mergeFilters(a: NoteFilter, b: NoteFilter): NoteFilter {
  const max = (x: number | null, y: number | null) =>
    x === null ? y : y === null ? x : Math.max(x, y);
  const min = (x: number | null, y: number | null) =>
    x === null ? y : y === null ? x : Math.min(x, y);
  return {
    words: [...a.words, ...b.words],
    authors: [...a.authors, ...b.authors],
    yearFrom: max(a.yearFrom, b.yearFrom),
    yearTo: min(a.yearTo, b.yearTo),
    topics: [...a.topics, ...b.topics],
    kinds: [...a.kinds, ...b.kinds],
    tags: [...a.tags, ...b.tags],
  };
}

export const isEmptyFilter = (f: NoteFilter) =>
  !f.words.length &&
  !f.authors.length &&
  f.yearFrom === null &&
  f.yearTo === null &&
  !f.topics.length &&
  !f.kinds.length &&
  !f.tags.length;

function tagsOf(note: VaultNote): string[] {
  const raw = note.frontmatter.tags ?? note.frontmatter.tag;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : [];
  return list.map((t) => String(t).replace(/^#/, "").toLowerCase());
}

const yearOf = (n: VaultNote) => {
  const y = Number.parseInt(n.year ?? "", 10);
  return Number.isFinite(y) ? y : null;
};

/** How well a note matches (0: it doesn't). Conditions must all hold. */
function score(index: VaultIndex, note: VaultNote, f: NoteFilter): number {
  if (f.yearFrom !== null || f.yearTo !== null) {
    const y = yearOf(note);
    if (y === null) return 0;
    if (f.yearFrom !== null && y < f.yearFrom) return 0;
    if (f.yearTo !== null && y > f.yearTo) return 0;
  }
  if (f.authors.length) {
    const names = note.authors.join(" ").toLowerCase();
    if (!f.authors.every((a) => names.includes(a))) return 0;
  }
  if (
    f.kinds.length &&
    !f.kinds.some((k) => note.kind.toLowerCase().startsWith(k))
  ) {
    return 0;
  }
  if (f.topics.length) {
    const topics = [...topicsOf(index, note)].map((t) => t.toLowerCase());
    if (!f.topics.every((t) => topics.some((n) => n.includes(t)))) return 0;
  }
  if (f.tags.length) {
    const tags = tagsOf(note);
    if (!f.tags.every((t) => tags.includes(t))) return 0;
  }
  if (!f.words.length) return 1;
  const head =
    `${note.name} ${note.title} ${note.citekey ?? ""} ${note.authors.join(" ")} ${note.year ?? ""}`.toLowerCase();
  const body = note.body.toLowerCase();
  let s = 0;
  for (const w of f.words) {
    if (head.includes(w)) s += 3;
    else if (body.includes(w)) s += 1;
    else return 0;
  }
  return s;
}

const firstAuthor = (n: VaultNote) =>
  (n.authors[0] ?? "").split(/\s+/).pop()?.toLowerCase() ?? "";

/** The notes of `list` that match, in the order asked. */
export function filterNotes(
  index: VaultIndex,
  list: VaultNote[],
  f: NoteFilter,
  sort: NoteSort = "relevance",
): VaultNote[] {
  const scored = list
    .map((note, i) => ({ note, i, s: score(index, note, f) }))
    .filter((x) => x.s > 0);
  const byYear =
    (dir: 1 | -1) => (a: (typeof scored)[0], b: (typeof scored)[0]) => {
      const ya = yearOf(a.note);
      const yb = yearOf(b.note);
      // Undated last either way.
      if (ya === null || yb === null)
        return (ya === null ? 1 : 0) - (yb === null ? 1 : 0);
      return (ya - yb) * dir || a.i - b.i;
    };
  const compare = {
    relevance: (a: (typeof scored)[0], b: (typeof scored)[0]) =>
      b.s - a.s || a.i - b.i,
    "year-desc": byYear(-1),
    "year-asc": byYear(1),
    title: (a: (typeof scored)[0], b: (typeof scored)[0]) =>
      a.note.title.localeCompare(b.note.title),
    author: (a: (typeof scored)[0], b: (typeof scored)[0]) =>
      firstAuthor(a.note).localeCompare(firstAuthor(b.note)) ||
      (yearOf(a.note) ?? 0) - (yearOf(b.note) ?? 0),
  }[sort];
  return scored.sort(compare).map((x) => x.note);
}
