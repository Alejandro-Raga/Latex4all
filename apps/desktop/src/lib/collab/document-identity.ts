/**
 * Telling an edit from a different document. A sync gone wrong once wrote
 * one project's main.tex into another's; the sync now never writes a
 * LaTeX file over one that is a different document, either way.
 *
 * A document's identity is its class and title. A file whose identity
 * changed and that shares little of its text with the version it replaces
 * is a different document. An edit, however large, keeps one or the
 * other: rewriting a paper keeps its title, and changing the class or the
 * title keeps the text.
 */

/** "article|Corporate science and the social SDGs", or null if it isn't a
 * LaTeX document (no \documentclass): only those are checked. */
export function identityOf(text: string): string | null {
  const kind = text.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/);
  if (!kind) return null;
  const title =
    text.match(/\\title\s*(?:\[[^\]]*\])?\s*\{([\s\S]{0,200}?)\}\s*$/m)?.[1] ??
    text.match(/\\title\s*(?:\[[^\]]*\])?\s*\{([^\n]{0,120})/)?.[1] ??
    "";
  const plain = title
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/[{}\\&~$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  return `${kind[1].trim()}|${plain}`;
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
  const la = contentLines(a);
  const lb = contentLines(b);
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
