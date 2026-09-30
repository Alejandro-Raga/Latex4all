import { citekeySearch } from "@/lib/citations";
import type { LibraryItem } from "@/lib/zotero-library";

/** Letters and digits only, lower-cased, accents dropped. */
export const foldText = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

/** A library's items by folded title, built once per library. */
export function itemsByTitle(items: Iterable<LibraryItem>) {
  const map = new Map<string, LibraryItem>();
  for (const item of items) map.set(foldText(item.title), item);
  return map;
}

export interface CiteMatchContext {
  items: Record<string, LibraryItem>;
  byTitle: Map<string, LibraryItem>;
  /** Zotero item keys by citation key, from the project's synced .bib files. */
  itemKeys: Map<string, string>;
  /** The key's title in the project's .bib files. */
  bibTitle?: string | null;
  /** The Zotero item its vault note names, if it has one. */
  noteItemKey?: string | null;
}

/**
 * The Zotero item a citation key stands for: by the synced .bib's record, by
 * its vault note, by title (whole, or one the other begins with, as when a
 * subtitle is left off), or by first author and year when only one fits.
 */
export function itemForCitekey(
  key: string,
  ctx: CiteMatchContext,
): LibraryItem | undefined {
  const known = ctx.itemKeys.get(key) ?? ctx.noteItemKey;
  if (known && ctx.items[known]) return ctx.items[known];
  if (ctx.bibTitle) {
    const want = foldText(ctx.bibTitle);
    const exact = ctx.byTitle.get(want);
    if (exact) return exact;
    if (want.length >= 20) {
      for (const [title, item] of ctx.byTitle) {
        const short = title.length < want.length ? title : want;
        if (
          short.length >= 20 &&
          (title.startsWith(want) || want.startsWith(title))
        ) {
          return item;
        }
      }
    }
  }
  const { words, year } = citekeySearch(key);
  if (!year) return undefined;
  const author = foldText(words);
  if (author.length < 2) return undefined;
  const fits = Object.values(ctx.items).filter(
    (item) =>
      item.year === year &&
      item.creators
        .split(",")
        .slice(0, 1)
        .some((c) => foldText(c) === author),
  );
  return fits.length === 1 ? fits[0] : undefined;
}
