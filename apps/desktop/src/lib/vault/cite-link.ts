import type { VaultIndex, VaultNote } from "./vault-index";

/**
 * The paper note for a citation key: via the Zotero item behind the
 * project's .bib entries; by the key the note gives (a citekey field, an
 * inline "Citekey::", a Better BibTeX link); by name or alias, with or
 * without Zotero Integration's "@" (`Nelson1959`, `@Nelson1959`), whatever
 * kind of note it is; by the .bib entry's DOI; by author and year
 * (`nelson_simple_1959`); or by the entry's title and year (never title
 * alone: editions and replies share titles).
 */
export function noteForCitekey(
  index: VaultIndex,
  key: string,
  itemKeyByCitekey: Map<string, string>,
  entry?: { doi?: string | null; title?: string | null; year?: string | null },
): VaultNote | undefined {
  const found = byKeyOrAuthor(index, key, itemKeyByCitekey, entry);
  if (found || !entry?.title || !entry.year) return found;
  const title = fold(entry.title);
  if (title.length < 12) return undefined;
  return index.list.find(
    (n) =>
      n.kind === "paper" && n.year === entry.year && fold(n.title) === title,
  );
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

/** A note's DOI, as its frontmatter gives it. */
function doiOf(n: VaultNote): string | null {
  const v = n.frontmatter.doi ?? n.frontmatter.DOI;
  return typeof v === "string"
    ? v
        .toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
        .trim() || null
    : null;
}

function byKeyOrAuthor(
  index: VaultIndex,
  key: string,
  itemKeyByCitekey: Map<string, string>,
  entry?: { doi?: string | null },
): VaultNote | undefined {
  const itemKey = itemKeyByCitekey.get(key);
  const papers = index.list.filter((n) => n.kind === "paper");
  if (itemKey) {
    const byItem = papers.find((n) => n.zoteroKey === itemKey);
    if (byItem) return byItem;
  }
  const lower = key.replace(/^@/, "").toLowerCase();
  const same = (s: string | null | undefined) =>
    s?.replace(/^@/, "").toLowerCase() === lower;
  const byKey = index.list.find((n) => same(n.citekey));
  if (byKey) return byKey;
  // A note named after the key counts even if nothing else marks it a paper.
  const byName =
    index.list.find((n) => same(n.name)) ??
    index.list.find((n) => n.aliases.some(same));
  if (byName) return byName;
  if (entry?.doi) {
    const byDoi = papers.find((n) => doiOf(n) === entry.doi);
    if (byDoi) return byDoi;
  }
  const year = lower.match(/(1[5-9]|20)\d\d/)?.[0];
  if (!year) return undefined;
  const fold = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^A-Za-z]/g, "")
      .toLowerCase();
  const matches = papers.filter((n) => {
    // "Boni, Alejandra" or "Alejandra Boni"; authors may also come as one
    // comma-separated line, "Alejandra Boni, Diana Velasco".
    const first = n.authors[0]?.split(",")[0].trim();
    const last = first ? fold(first.split(/\s+/).pop() ?? "") : "";
    return last && n.year === year && fold(lower).startsWith(last);
  });
  if (matches.length < 2) return matches[0];
  // Same author, same year: Better BibTeX keys carry a title word
  // (boni_human_2025), so prefer the paper whose title has it.
  const words = lower.split(/[^a-z]+/).filter((w) => w.length > 2);
  return (
    matches.find((n) =>
      n.title
        .toLowerCase()
        .split(/[^a-z]+/)
        .some((w) => w.length > 2 && words.includes(w)),
    ) ?? matches[0]
  );
}
