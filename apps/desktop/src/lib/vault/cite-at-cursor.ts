/**
 * The citation key under the cursor, when it sits inside \cite{...} or any
 * of its variants (\citep, \textcite, \parencite[p.~3]{...}, …).
 */
export function citeKeyAtCursor(
  content: string,
  cursor: number,
): string | null {
  const lineStart = content.lastIndexOf("\n", cursor - 1) + 1;
  const lineEndRaw = content.indexOf("\n", cursor);
  const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw;
  const line = content.slice(lineStart, lineEnd);
  const at = cursor - lineStart;

  const re = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g;
  for (const m of line.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - m[1].length - 1;
    const close = open + m[1].length + 1;
    if (at < (m.index ?? 0) || at > close) continue;
    // Inside the braces pick the key the cursor is on; on the command
    // itself, the first key.
    if (at <= open) return m[1].split(",")[0]?.trim() || null;
    let start = 0;
    for (const key of m[1].split(",")) {
      const end = start + key.length;
      if (at - open - 1 <= end) return key.trim() || null;
      start = end + 1;
    }
  }
  return null;
}
