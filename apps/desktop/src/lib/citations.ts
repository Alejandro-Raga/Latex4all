/**
 * A project's citations against its bibliography: what's cited without an
 * entry, what has an entry but is never cited, and renaming a key where
 * it's cited.
 */
import { citedKeys, citeGroups } from "@/lib/vault/project-note";

export interface BibEntry {
  key: string;
  title: string | null;
  file: string;
  doi?: string | null;
  year?: string | null;
  /** The first author's surname, as written. */
  author?: string | null;
  /** Where the entry is in its file: from its "@" to its closing brace. */
  start?: number;
  end?: number;
}

/** Where an entry starting at `at` ends: just past its closing brace. */
function entryEnd(content: string, at: number): number {
  const open = content.indexOf("{", at);
  const paren = content.indexOf("(", at);
  const first = paren >= 0 && (open < 0 || paren < open) ? paren : open;
  if (first < 0) return content.length;
  const [o, c] = content[first] === "(" ? ["(", ")"] : ["{", "}"];
  let depth = 0;
  for (let i = first; i < content.length; i++) {
    if (content[i] === "\\") {
      i++;
      continue;
    }
    if (content[i] === o) depth++;
    else if (content[i] === c && --depth === 0) return i + 1;
  }
  return content.length;
}

/** The first author's surname: "Arora, Ashish and …" or "Ashish Arora and …". */
function firstSurname(authors: string | null): string | null {
  const first = authors?.split(/\s+and\s+/i)[0]?.trim();
  if (!first) return null;
  return (
    (first.includes(",")
      ? first.split(",")[0]
      : first.split(/\s+/).pop()
    )?.trim() || null
  );
}

/**
 * A field's text, braces and all read through: `{The {Rate} of {R\&D}}` is
 * "The Rate of R&D".
 */
function fieldValue(body: string, field: string): string | null {
  const m = new RegExp(`\\b${field}\\s*=\\s*([{"])`, "i").exec(body);
  if (!m) return null;
  let depth = m[1] === "{" ? 1 : 0;
  let out = "";
  for (let i = m.index + m[0].length; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && i + 1 < body.length) {
      out += c + body[++i];
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0 && m[1] === "{") break;
    } else if (c === '"' && m[1] === '"' && depth === 0) break;
    out += c;
  }
  const text = out
    .replace(/\\([&%$#_])/g, "$1")
    // Accents (\'e) and commands (\textit) go; the letters they wrap stay.
    .replace(/\\[^A-Za-z\s]/g, "")
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
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
    const at = m.index ?? 0;
    const date = fieldValue(body, "year") ?? fieldValue(body, "date");
    entries.push({
      key: m[2],
      title: fieldValue(body, "title"),
      file,
      doi:
        fieldValue(body, "doi")
          ?.toLowerCase()
          .replace(/^https?:\/\/(dx\.)?doi\.org\//, "") ?? null,
      year: date?.match(/\d{4}/)?.[0] ?? null,
      author: firstSurname(
        fieldValue(body, "author") ?? fieldValue(body, "editor"),
      ),
      start: at,
      end: entryEnd(content, at),
    });
  });
  return entries;
}

/** A .bib file left out of the check, and why. */
export interface IgnoredBib {
  path: string;
  why: "not used" | "conflict copy";
}

/** A copy a sync client made when two edits collided. */
export function isConflictCopy(path: string): boolean {
  return /SFConflict|conflicted copy|\(conflict|\bconflict-\d|\.sync-conflict/i.test(
    path,
  );
}

const baseName = (path: string) =>
  (path.split(/[\\/]/).pop() ?? path).replace(/\.bib$/i, "").toLowerCase();

/**
 * The .bib files the document names, by base name (\bibliography{a,b},
 * \addbibresource{a.bib}); null when it names none.
 */
export function usedBibNames(
  texFiles: { content: string }[],
): Set<string> | null {
  const names = new Set<string>();
  for (const { content } of texFiles) {
    const text = content.replace(/(^|[^\\])%[^\n]*/g, "$1");
    for (const m of text.matchAll(
      /\\(?:bibliography|addbibresource|addglobalbib)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
    )) {
      for (const name of m[1].split(","))
        if (name.trim()) names.add(baseName(name.trim()));
    }
  }
  return names.size > 0 ? names : null;
}

/** The .bib files that count, and those left out (unused, or a conflict copy). */
export function bibsInUse<T extends { path: string }>(
  texFiles: { content: string }[],
  bibFiles: T[],
): { used: T[]; ignored: IgnoredBib[] } {
  const names = usedBibNames(texFiles);
  const used: T[] = [];
  const ignored: IgnoredBib[] = [];
  for (const f of bibFiles) {
    if (isConflictCopy(f.path))
      ignored.push({ path: f.path, why: "conflict copy" });
    else if (names && !names.has(baseName(f.path)))
      ignored.push({ path: f.path, why: "not used" });
    else used.push(f);
  }
  return { used, ignored };
}

export interface CitationReport {
  cited: string[];
  /** Cited, but in no .bib file. */
  missing: string[];
  /** In a .bib file, never cited. */
  unused: BibEntry[];
  /** .bib files in the project that the document doesn't use. */
  ignored: IgnoredBib[];
  /** Every entry in the .bib files that count. */
  entries: BibEntry[];
}

export function checkCitations(
  texFiles: { content: string }[],
  bibFiles: { path: string; content: string }[],
): CitationReport {
  const cited = citedKeys(texFiles);
  const { used, ignored } = bibsInUse(texFiles, bibFiles);
  const entries = used.flatMap((f) => bibEntries(f.content, f.path));
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
    ignored,
    entries,
  };
}

/** `tex` with the citation key `from` renamed to `to` inside cite commands only. */
export function renameCiteKey(tex: string, from: string, to: string): string {
  let out = "";
  let at = 0;
  for (const g of citeGroups(tex)) {
    const keys = tex
      .slice(g.start, g.end)
      .split(",")
      .map((k) => (k.trim() === from ? k.replace(from, to) : k))
      .join(",");
    out += tex.slice(at, g.start) + keys;
    at = g.end;
  }
  return out + tex.slice(at);
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

/** Keys these LaTeX texts cite that none of the .bib texts has. */
export function missingCitations(tex: string[], bib: string[]): string[] {
  const known = new Set(
    bib.flatMap((content) => bibEntries(content, "").map((e) => e.key)),
  );
  return citedKeys(tex.map((content) => ({ content }))).filter(
    (key) => !known.has(key),
  );
}
