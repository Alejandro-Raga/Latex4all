import { parsePublicationYear, type ZoteroItemSummary } from "@/lib/zotero-api";

/** How a list of references is ordered. */
export type ReferenceSort =
  | "relevance"
  | "newest"
  | "oldest"
  | "title"
  | "author";

export const REFERENCE_SORTS: { value: ReferenceSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "First author" },
];

/**
 * Casefolded and stripped of diacritics, so "Garcia" finds "García" and
 * "analisis" finds "análisis" — a library of Spanish sources is unusable if
 * every search needs the accents typed exactly.
 */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

type Term = { field: "title" | "creators" | "any"; text: string };

/**
 * Splits a query into terms. A bare word matches the title or the authors;
 * `author:` and `title:` (plus the shorthands `by:` and `t:`) narrow one term
 * to a single field, so "author:garcia climate" is a sensible thing to type.
 * Quoted phrases keep their spaces.
 */
export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  // Either a field-prefixed term or a bare one; each half may be quoted.
  const pattern = /(?:(author|by|title|t):)?(?:"([^"]*)"|(\S+))/g;
  for (const match of query.matchAll(pattern)) {
    const [, prefix, quoted, bare] = match;
    const text = normalize(quoted ?? bare ?? "");
    if (!text) continue;
    const field =
      prefix === "author" || prefix === "by"
        ? "creators"
        : prefix === "title" || prefix === "t"
          ? "title"
          : "any";
    terms.push({ field, text });
  }
  return terms;
}

function matches(item: ZoteroItemSummary, term: Term): boolean {
  const title = normalize(item.title);
  const creators = normalize(item.creators);
  switch (term.field) {
    case "title":
      return title.includes(term.text);
    case "creators":
      return creators.includes(term.text);
    default:
      return title.includes(term.text) || creators.includes(term.text);
  }
}

/** Higher is better. Only used to order a "best match" result list. */
function relevance(item: ZoteroItemSummary, terms: Term[]): number {
  const title = normalize(item.title);
  const creators = normalize(item.creators);
  let score = 0;
  for (const term of terms) {
    if (title.startsWith(term.text)) score += 4;
    else if (title.includes(term.text)) score += 3;
    if (creators.includes(term.text)) score += 2;
  }
  return score;
}

/** Every term must match — narrowing a search by adding a word is the
 * behaviour anyone typing into a search box expects. */
export function filterReferences(
  items: ZoteroItemSummary[],
  query: string,
): ZoteroItemSummary[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return items;
  return items.filter((item) => terms.every((term) => matches(item, term)));
}

export function sortReferences(
  items: ZoteroItemSummary[],
  sort: ReferenceSort,
  query = "",
): ZoteroItemSummary[] {
  const byTitle = (a: ZoteroItemSummary, b: ZoteroItemSummary) =>
    a.title.localeCompare(b.title);

  // An item whose date holds no readable year can't be placed on a timeline,
  // so it goes last whichever way the list is pointing rather than pretending
  // to be year zero.
  const byYear = (
    a: ZoteroItemSummary,
    b: ZoteroItemSummary,
    newest: boolean,
  ) => {
    const yearA = parsePublicationYear(a.date);
    const yearB = parsePublicationYear(b.date);
    if (yearA === null && yearB === null) return byTitle(a, b);
    if (yearA === null) return 1;
    if (yearB === null) return -1;
    if (yearA !== yearB) return newest ? yearB - yearA : yearA - yearB;
    return byTitle(a, b);
  };

  const sorted = [...items];
  switch (sort) {
    case "newest":
      return sorted.sort((a, b) => byYear(a, b, true));
    case "oldest":
      return sorted.sort((a, b) => byYear(a, b, false));
    case "title":
      return sorted.sort(byTitle);
    case "author": {
      // `creators` is surnames in Zotero's order: the first is the one cited.
      const first = (i: ZoteroItemSummary) =>
        normalize(i.creators.split(",")[0]?.trim() ?? "");
      return sorted.sort((a, b) => {
        const fa = first(a);
        const fb = first(b);
        if (!fa !== !fb) return fa ? -1 : 1;
        return fa.localeCompare(fb) || byYear(a, b, false);
      });
    }
    default: {
      const terms = parseQuery(query);
      // With nothing typed there is no "best match" to speak of, so leave the
      // library in the order Zotero returned it.
      if (terms.length === 0) return sorted;
      return sorted.sort((a, b) => {
        const diff = relevance(b, terms) - relevance(a, terms);
        return diff !== 0 ? diff : byYear(a, b, true);
      });
    }
  }
}

/** Conditions that narrow the library, picked or typed (`year:`, `type:`). */
export interface ReferenceFilter {
  yearFrom: number | null;
  yearTo: number | null;
  /** A Zotero item type, or "" for any. */
  type: string;
}

export const NO_REFERENCE_FILTER: ReferenceFilter = {
  yearFrom: null,
  yearTo: null,
  type: "",
};

export const referenceFilterActive = (f: ReferenceFilter) =>
  f.yearFrom !== null || f.yearTo !== null || f.type !== "";

/** "journalArticle" → "Journal article". */
export function referenceTypeLabel(type: string): string {
  const words = type.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CONDITION = /(?:^|\s)(year|y|type):(?:"([^"]*)"|(\S+))/gi;

/**
 * The `year:` and `type:` conditions typed in a search, and the words left:
 * `year:2005`, `year:1990-2005`, `year:>2010`, `type:book`.
 */
export function splitConditions(query: string): {
  filter: ReferenceFilter;
  words: string;
} {
  const filter = { ...NO_REFERENCE_FILTER };
  const words = query.replace(CONDITION, (_m, field, quoted, bare) => {
    const value = String(quoted ?? bare ?? "").trim();
    if (field.toLowerCase() === "type") {
      filter.type = normalize(value).replace(/\s+/g, "");
      return " ";
    }
    const range = value.match(/^(\d{4})?\s*-\s*(\d{4})?$/);
    const cmp = value.match(/^([<>]=?)(\d{4})$/);
    if (range) {
      if (range[1]) filter.yearFrom = Number(range[1]);
      if (range[2]) filter.yearTo = Number(range[2]);
    } else if (cmp) {
      const y = Number(cmp[2]);
      if (cmp[1] === ">") filter.yearFrom = y + 1;
      if (cmp[1] === ">=") filter.yearFrom = y;
      if (cmp[1] === "<") filter.yearTo = y - 1;
      if (cmp[1] === "<=") filter.yearTo = y;
    } else if (/^\d{4}$/.test(value)) {
      filter.yearFrom = filter.yearTo = Number(value);
    }
    return " ";
  });
  return { filter, words: words.trim() };
}

/** The items that meet the conditions (undated ones fail a year range). */
export function filterByConditions(
  items: ZoteroItemSummary[],
  f: ReferenceFilter,
): ZoteroItemSummary[] {
  if (!referenceFilterActive(f)) return items;
  return items.filter((item) => {
    if (f.yearFrom !== null || f.yearTo !== null) {
      const y = parsePublicationYear(item.date);
      if (y === null) return false;
      if (f.yearFrom !== null && y < f.yearFrom) return false;
      if (f.yearTo !== null && y > f.yearTo) return false;
    }
    if (f.type) {
      // Picked exactly, or typed as the start of the type ("journal").
      const type = (item.itemType ?? "").toLowerCase();
      if (!type.startsWith(f.type.toLowerCase())) return false;
    }
    return true;
  });
}

/** Filter then order, the pair every caller actually wants. Conditions typed
 *  in the query add to those picked (`picked`). */
export function searchReferences(
  items: ZoteroItemSummary[],
  query: string,
  sort: ReferenceSort,
  picked: ReferenceFilter = NO_REFERENCE_FILTER,
): ZoteroItemSummary[] {
  const { filter: typed, words } = splitConditions(query);
  const max = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.max(a, b);
  const min = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.min(a, b);
  const both: ReferenceFilter = {
    yearFrom: max(typed.yearFrom, picked.yearFrom),
    yearTo: min(typed.yearTo, picked.yearTo),
    type: typed.type || picked.type,
  };
  return sortReferences(
    filterReferences(filterByConditions(items, both), words),
    sort,
    words,
  );
}
