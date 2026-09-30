/**
 * A project's citations against its bibliography: what's cited without an
 * entry, what has an entry but is never cited, and renaming a key where
 * it's cited.
 */
import { citedKeys } from "@/lib/vault/project-note";

export interface BibEntry {
  key: string;
  title: string | null;
  file: string;
}

/** Entries in a .bib file: `@type{key, ... title = {...}}`. */
export function bibEntries(content: string, file: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  const starts = [...content.matchAll(re)].filter(
    (m) => !/^(comment|string|preamble)$/i.test(m[1]),
  );
  starts.forEach((m, i) => {
    const body = content.slice(
      m.index ?? 0,
      starts[i + 1]?.index ?? content.length,
    );
    const title =
      body.match(/\btitle\s*=\s*[{"]+([^}"]*)/i)?.[1]?.trim() ?? null;
    entries.push({ key: m[2], title, file });
  });
  return entries;
}

export interface CitationReport {
  cited: string[];
  /** Cited, but in no .bib file. */
  missing: string[];
  /** In a .bib file, never cited. */
  unused: BibEntry[];
}

export function checkCitations(
  texFiles: { content: string }[],
  bibFiles: { path: string; content: string }[],
): CitationReport {
  const cited = citedKeys(texFiles);
  const entries = bibFiles.flatMap((f) => bibEntries(f.content, f.path));
  const known = new Set(entries.map((e) => e.key));
  const citedSet = new Set(cited);
  // \nocite{*} includes the whole bibliography on purpose.
  const nociteAll = texFiles.some((f) =>
    /\\nocite\s*\{\s*\*\s*\}/.test(f.content),
  );
  return {
    cited,
    missing: cited.filter((k) => !known.has(k)),
    unused: nociteAll ? [] : entries.filter((e) => !citedSet.has(e.key)),
  };
}

/** `tex` with the citation key `from` renamed to `to` inside cite commands only. */
export function renameCiteKey(tex: string, from: string, to: string): string {
  return tex.replace(
    /(\\[A-Za-z]*cite[A-Za-z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{)([^}]*)(\})/g,
    (_, open: string, keys: string, close: string) =>
      open +
      keys
        .split(",")
        .map((k) => (k.trim() === from ? k.replace(from, to) : k))
        .join(",") +
      close,
  );
}

/** Search words for finding a key's paper: its name part(s) and year. */
export function citekeySearch(key: string): {
  words: string;
  year: string | null;
} {
  const year = key.match(/(1[5-9]|20)\d\d/)?.[0] ?? null;
  const name = key
    .replace(/(1[5-9]|20)\d\d[a-z]?/, " ")
    .split(/[_\-:\s]+|(?<=[a-z])(?=[A-Z])/)
    // Zotero writes "noauthor" (and others "anon") where a key's author goes.
    .filter(
      (w) => w.length > 1 && !/^(noauthor|anon|anonymous|nd)$/i.test(w),
    )[0];
  return { words: name ?? key, year };
}
