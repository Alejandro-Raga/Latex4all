/**
 * Telling an edit from a different file. A sync gone wrong once wrote one
 * project's main.tex into another's; the sync now never writes a file over
 * one that is a different file altogether, either way.
 *
 * A file's identity is what it is: a LaTeX document's class and title, a
 * chapter's first heading, a bibliography's entries, other text's first
 * line (see identityOf). A file whose identity changed and that shares
 * little with the version it replaces is a different file. An edit, however
 * large, keeps one or the other: rewriting a paper keeps its title, and
 * changing the title keeps the text.
 */

/** A short fingerprint of a string. */
function hashOf(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** A bibliography's entry keys ("@article{smith2020," → smith2020). */
function entryKeys(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/@\w+\s*\{\s*([^,\s{}]+)\s*,/g)].map((m) => m[1]),
  );
}

/** Text without LaTeX markup, folded, for comparing names and headings. */
function plain(text: string, length: number) {
  return text
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/[{}\\&~$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, length);
}

/**
 * What a file is, to tell an edit from another file arriving in its place:
 * "article|corporate science and the social sdgs" for a LaTeX document (its
 * class and title); "part|introduction" for a chapter it \inputs (its first
 * heading); "bib|…" for a bibliography (its entries); "text|…" for any
 * other text of some length (its first line). Null for one too short to
 * tell: those aren't checked.
 */
export function identityOf(text: string): string | null {
  const kind = text.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/);
  if (!kind) {
    const keys = entryKeys(text);
    if (keys.size > 0) return `bib|${hashOf([...keys].sort().join(","))}`;
    const heading = text.match(
      /\\(?:part|chapter|section|subsection)\*?\s*(?:\[[^\]]*\])?\s*\{([^\n]{1,120})/,
    );
    if (heading) return `part|${plain(heading[1], 80)}`;
    const lines = [...contentLines(text)];
    if (lines.length >= 5) return `text|${plain(lines[0], 80)}`;
    return null;
  }
  const title =
    text.match(/\\title\s*(?:\[[^\]]*\])?\s*\{([\s\S]{0,200}?)\}\s*$/m)?.[1] ??
    text.match(/\\title\s*(?:\[[^\]]*\])?\s*\{([^\n]{0,120})/)?.[1] ??
    "";
  return `${kind[1].trim()}|${plain(title, 80)}`;
}

/** The lines that say what a document is about: not its preamble's
 * package lines, comments or short lines every LaTeX file has. */
function contentLines(text: string): Set<string> {
  const lines = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length < 16 || line.startsWith("%")) continue;
    if (
      /^\\(usepackage|documentclass|RequirePackage|input|include)\b/.test(line)
    )
      continue;
    lines.add(line);
  }
  return lines;
}

/** Share of the smaller one's content lines that the other has too (1
 * when either is too short to tell). */
export function overlap(a: string, b: string): number {
  // Bibliographies by their entries (a fresh export from Zotero reorders
  // and reformats them, and keeps most).
  const ka = entryKeys(a);
  const kb = entryKeys(b);
  const bibs = ka.size > 0 && kb.size > 0;
  const la = bibs ? ka : contentLines(a);
  const lb = bibs ? kb : contentLines(b);
  if (la.size < 5 || lb.size < 5) return 1;
  const [small, large] = la.size <= lb.size ? [la, lb] : [lb, la];
  let common = 0;
  for (const line of small) if (large.has(line)) common++;
  return common / small.size;
}

/**
 * Whether writing `next` over `current` would replace one document with
 * another. `recorded` is the identity the project's owner last recorded
 * for the file: a version matching it is the right document even if it
 * shares nothing with `current` (putting a damaged file right).
 */
export function isDifferentDocument(
  next: string,
  current: string,
  recorded?: string | null,
): boolean {
  if (next === current) return false;
  const nextId = identityOf(next);
  const currentId = identityOf(current);
  if (!nextId || !currentId) return false;
  const expected = recorded ?? currentId;
  if (nextId === expected) return false;
  return overlap(next, current) < 0.2;
}
