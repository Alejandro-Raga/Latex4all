import { buildExclusionMask } from "./latex-prose-mask";

export interface CheckableSpan {
  from: number;
  to: number;
  word: string;
}

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/** Individual spell-checkable words in LaTeX source, skipping non-prose regions. */
export function extractCheckableSpans(text: string): CheckableSpan[] {
  const mask = buildExclusionMask(text);
  const spans: CheckableSpan[] = [];

  WORD_RE.lastIndex = 0;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = WORD_RE.exec(text))) {
    const word = wordMatch[0];
    if (word.length < 2) continue; // skip single letters (mostly stray math variables)
    const from = wordMatch.index;
    const to = from + word.length;

    let excluded = false;
    for (let i = from; i < to; i++) {
      if (mask[i]) {
        excluded = true;
        break;
      }
    }
    if (!excluded) spans.push({ from, to, word });
  }

  return spans;
}
