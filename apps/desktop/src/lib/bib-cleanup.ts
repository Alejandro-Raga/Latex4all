/**
 * Tidying a project's bibliography: one paper under several keys (by DOI, or
 * by title and year — never title alone, since editions and replies share
 * titles), one key written twice, and citations whose key is in no .bib but
 * plainly means an entry that is. Finding changes nothing; applying the
 * choices rewrites the citations and removes the extra entries.
 */
import { type BibEntry, bibEntries, renameCiteKey } from "./citations";
import { citeGroups } from "./vault/project-note";

const fold = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

/** One paper in the bibliography under more than one key. */
export interface DuplicateGroup {
  /** Every entry for the paper, under any of its keys. */
  entries: BibEntry[];
  /** Its keys, the one to keep first. */
  keys: string[];
  /** The key to keep: the one cited most, else Zotero's own form. */
  keep: string;
  /** How many times the text cites each key. */
  uses: Record<string, number>;
}

/** A key written more than once. */
export interface SameKey {
  key: string;
  entries: BibEntry[];
  /** All copies say the same. */
  identical: boolean;
}

/** A cited key no .bib has, that plainly means one that is there. */
export interface StrayCite {
  key: string;
  to: string;
}

export interface BibProblems {
  duplicates: DuplicateGroup[];
  sameKey: SameKey[];
  strays: StrayCite[];
}

type File = { path: string; content: string };

/** How often each key is cited (each key in each cite command). */
function citeCounts(tex: File[] | { content: string }[]) {
  const counts = new Map<string, number>();
  for (const { content } of tex) {
    for (const key of citedKeysAll(content)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Every key cited, with repeats, outside comments. */
function citedKeysAll(content: string): string[] {
  const text = content.replace(/(^|[^\\])%[^\n]*/g, "$1");
  return citeGroups(text).flatMap((g) =>
    text
      .slice(g.start, g.end)
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k && k !== "*"),
  );
}

/** Zotero's own export writes author_word_year: what a sync brings back. */
const ZOTERO_STYLE = /^[a-z0-9-]+_[a-z0-9]+_\d{4}[a-z]?$/;

export function findBibProblems(
  tex: { content: string }[],
  bib: File[],
): BibProblems {
  const entries = bib.flatMap((f) => bibEntries(f.content, f.path));
  const uses = citeCounts(tex);

  // Same key, more than once.
  const byKey = new Map<string, BibEntry[]>();
  for (const e of entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  const text = (e: BibEntry) =>
    bib
      .find((f) => f.path === e.file)
      ?.content.slice(e.start, e.end)
      .replace(/\s+/g, " ")
      .trim() ?? "";
  const sameKey: SameKey[] = [...byKey]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      key,
      entries: list,
      identical: new Set(list.map(text)).size === 1,
    }));

  // One paper, several keys: joined by DOI, or by title and year.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  const firstFor = new Map<string, string>();
  for (const e of entries) {
    const ids = [
      e.doi ? `doi:${e.doi}` : null,
      e.year && fold(e.title).length >= 12
        ? `t:${fold(e.title)}|${e.year}`
        : null,
    ];
    for (const id of ids) {
      if (!id) continue;
      const seen = firstFor.get(id);
      if (seen) join(e.key, seen);
      else firstFor.set(id, e.key);
    }
  }
  const groups = new Map<string, Set<string>>();
  for (const key of byKey.keys()) {
    const root = find(key);
    groups.set(root, (groups.get(root) ?? new Set()).add(key));
  }
  const duplicates: DuplicateGroup[] = [...groups.values()]
    .filter((keys) => keys.size > 1)
    .map((set) => {
      const keys = [...set].sort(
        (a, b) =>
          (uses.get(b) ?? 0) - (uses.get(a) ?? 0) ||
          Number(ZOTERO_STYLE.test(b)) - Number(ZOTERO_STYLE.test(a)) ||
          a.localeCompare(b),
      );
      return {
        entries: keys.flatMap((k) => byKey.get(k) ?? []),
        keys,
        keep: keys[0],
        uses: Object.fromEntries(keys.map((k) => [k, uses.get(k) ?? 0])),
      };
    });

  // Cited keys no .bib has: the entry they plainly mean, if there's one.
  const known = new Set(byKey.keys());
  const strays: StrayCite[] = [];
  for (const key of uses.keys()) {
    if (known.has(key)) continue;
    const year = key.match(/(1[5-9]|20)\d\d/)?.[0];
    const words = key
      .replace(/(1[5-9]|20)\d\d[a-z]?/g, " ")
      .split(/[_\-:\s]+|(?<=[a-z])(?=[A-Z])/)
      .map(fold)
      .filter((w) => w.length > 1);
    const surname = words[0];
    if (!year || !surname) continue;
    let hits = entries.filter(
      (e) => e.year === year && fold(e.author) === surname,
    );
    if (hits.length > 1) {
      const rest = words.slice(1).filter((w) => w.length >= 4);
      hits = hits.filter((e) => rest.some((w) => fold(e.title).includes(w)));
    }
    const target = [...new Set(hits.map((e) => e.key))];
    if (target.length === 1) strays.push({ key, to: target[0] });
  }

  return { duplicates, sameKey, strays };
}

/** What to do: keys to fold into another, which copy of a twice-written key stays, citations to point elsewhere. */
export interface CleanupChoice {
  merges: { from: string[]; to: string }[];
  /** For a key written twice: the copy to keep (its index among the copies). */
  keepCopy: { key: string; index: number }[];
  strays: StrayCite[];
}

export interface CleanupResult {
  tex: Map<string, string>;
  bib: Map<string, string>;
  renamed: number;
  removed: number;
}

/** A paper named twice in one citation (after a merge) named once. */
function withoutRepeats(tex: string): string {
  let out = "";
  let at = 0;
  for (const g of citeGroups(tex)) {
    const seen = new Set<string>();
    const keys = tex
      .slice(g.start, g.end)
      .split(",")
      .filter((k) => {
        const key = k.trim();
        if (!key || !seen.has(key)) {
          seen.add(key);
          return true;
        }
        return false;
      });
    out += tex.slice(at, g.start) + keys.join(",");
    at = g.end;
  }
  return out + tex.slice(at);
}

/** The project's files after the cleanup; only files that change are returned. */
export function applyCleanup(
  tex: File[],
  bib: File[],
  choice: CleanupChoice,
): CleanupResult {
  const renames = new Map<string, string>();
  for (const m of choice.merges)
    for (const k of m.from) if (k !== m.to) renames.set(k, m.to);
  for (const s of choice.strays) renames.set(s.key, s.to);

  const texOut = new Map<string, string>();
  let renamed = 0;
  for (const f of tex) {
    let next = f.content;
    for (const [from, to] of renames) next = renameCiteKey(next, from, to);
    if (renames.size > 0) next = withoutRepeats(next);
    if (next !== f.content) {
      texOut.set(f.path, next);
      renamed++;
    }
  }

  // Entries to remove: every copy of a merged-away key, and the extra copies.
  const drop = new Set<string>(); // file:start
  const all = bib.flatMap((f) => bibEntries(f.content, f.path));
  for (const e of all)
    if (renames.has(e.key) && choice.merges.some((m) => m.from.includes(e.key)))
      drop.add(`${e.file}:${e.start}`);
  for (const { key, index } of choice.keepCopy) {
    all
      .filter((e) => e.key === key)
      .forEach((e, i) => {
        if (i !== index) drop.add(`${e.file}:${e.start}`);
      });
  }
  const bibOut = new Map<string, string>();
  for (const f of bib) {
    const spans = all
      .filter((e) => e.file === f.path && drop.has(`${e.file}:${e.start}`))
      .sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
    if (spans.length === 0) continue;
    let next = f.content;
    for (const e of spans) {
      let end = e.end ?? next.length;
      while (next[end] === "\n" || next[end] === "\r") end++;
      next = next.slice(0, e.start) + next.slice(end);
    }
    bibOut.set(f.path, next);
  }
  return { tex: texOut, bib: bibOut, renamed, removed: drop.size };
}
