import { parsePublicationYear, type ZoteroItemSummary } from "@/lib/zotero-api";

/** How a list of references is ordered. */
export type ReferenceSort = "relevance" | "newest" | "oldest" | "title";

export const REFERENCE_SORTS: { value: ReferenceSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
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

/** Filter then order, the pair every caller actually wants. */
export function searchReferences(
  items: ZoteroItemSummary[],
  query: string,
  sort: ReferenceSort,
): ZoteroItemSummary[] {
  return sortReferences(filterReferences(items, query), sort, query);
}
