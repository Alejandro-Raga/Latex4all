import type { VaultIndex, VaultNote } from "./vault-index";

/**
 * The paper note for a citation key: via the Zotero item behind the
 * project's .bib entries; by the key the note gives (a citekey field, an
 * inline "Citekey::", a Better BibTeX link); by name or alias, with or
 * without Zotero Integration's "@" (`Nelson1959`, `@Nelson1959`), whatever
 * kind of note it is; or by author and year (`nelson_simple_1959`).
 */
export function noteForCitekey(
  index: VaultIndex,
  key: string,
  itemKeyByCitekey: Map<string, string>,
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
  const year = lower.match(/(1[5-9]|20)\d\d/)?.[0];
  if (!year) return undefined;
  return papers.find((n) => {
    const [author] = n.authors;
    const last = author
      ?.split(",")[0]
      .split(" ")
      .pop()
      ?.normalize("NFKD")
      .replace(/[^A-Za-z]/g, "")
      .toLowerCase();
    return last && n.year === year && lower.startsWith(last);
  });
}
