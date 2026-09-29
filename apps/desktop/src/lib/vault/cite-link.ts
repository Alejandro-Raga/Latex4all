import type { VaultIndex, VaultNote } from "./vault-index";

/**
 * The paper note for a citation key, via the Zotero item behind the
 * project's .bib entries, or failing that by name (`Nelson1959`) or by
 * author and year (`nelson_simple_1959`).
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
  const lower = key.toLowerCase();
  const byName = papers.find(
    (n) => n.name.toLowerCase() === lower || n.citekey?.toLowerCase() === lower,
  );
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
