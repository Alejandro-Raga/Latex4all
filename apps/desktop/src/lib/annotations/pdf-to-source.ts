/**
 * Finding text selected in the compiled PDF in the LaTeX it came from, so a
 * highlight or note made on the PDF lands on the source like one made in the
 * editor.
 *
 * The PDF has typeset words; the source has the same words among commands,
 * braces, comments and line breaks. Both are reduced to words (accents and
 * ligatures folded, commands and comments skipped), and the selection's
 * words are lined up against the source's, allowing for a few words on
 * either side that only one of them has (a citation's key, "[12]").
 */

interface Token {
  word: string;
  from: number;
  to: number;
}

const fold = (text: string) =>
  text.normalize("NFKC").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The words of a LaTeX source, with where each sits in it. */
export function sourceWords(source: string): Token[] {
  const tokens: Token[] = [];
  const re = /(%[^\n]*)|(\\(?:[A-Za-z@]+|.))|([\p{L}\p{N}]+)/gu;
  for (const m of source.matchAll(re)) {
    if (m[3] === undefined) continue; // a comment or a command name
    const start = m.index ?? 0;
    tokens.push({ word: fold(m[3]), from: start, to: start + m[3].length });
  }
  return tokens;
}

export function selectionWords(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** How far ahead in the source to look for the next selected word. */
const LOOKAHEAD = 8;

function align(src: Token[], sel: string[], start: number) {
  let pos = start;
  let matched = 0;
  let first = -1;
  let last = -1;
  for (const word of sel) {
    let found = -1;
    for (let k = pos; k < Math.min(src.length, pos + LOOKAHEAD); k++) {
      if (src[k].word === word) {
        found = k;
        break;
      }
    }
    if (found === -1) continue; // a word only the PDF has
    if (first === -1) first = found;
    last = found;
    matched++;
    pos = found + 1;
  }
  return { matched, first, last };
}

const lineOf = (source: string, offset: number) => {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
};

/**
 * Where `selected` (text from the PDF) is in `source`, or null if it can't be
 * found convincingly. With `nearLine` (from SyncTeX), a phrase that occurs
 * more than once resolves to the occurrence closest to it.
 */
export function findPdfTextInSource(
  source: string,
  selected: string,
  nearLine?: number,
): { from: number; to: number } | null {
  const sel = selectionWords(selected);
  if (sel.length === 0) return null;
  const src = sourceWords(source);
  // Start from any of the first few selected words, in case the selection
  // begins with something the source spells differently.
  const heads = new Set(sel.slice(0, 3));
  let best: {
    from: number;
    to: number;
    score: number;
    distance: number;
  } | null = null;
  for (let i = 0; i < src.length; i++) {
    if (!heads.has(src[i].word)) continue;
    const skipped = sel.indexOf(src[i].word);
    const { matched, first, last } = align(src, sel.slice(skipped), i);
    if (first === -1) continue;
    const score = matched / sel.length;
    const needed = sel.length <= 3 ? 1 : 0.75;
    if (score < needed) continue;
    const distance =
      nearLine === undefined
        ? 0
        : Math.abs(lineOf(source, src[first].from) - nearLine);
    if (
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 && distance < best.distance)
    ) {
      best = { from: src[first].from, to: src[last].to, score, distance };
    }
  }
  return best && { from: best.from, to: best.to };
}
