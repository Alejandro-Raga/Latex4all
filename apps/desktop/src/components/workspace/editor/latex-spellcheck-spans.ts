import { buildExclusionMask } from "./latex-prose-mask";

export interface CheckableSpan {
  from: number;
  to: number;
  word: string;
}

/**
 * A word is a run of letters, in any script — not just ASCII. Anchoring on
 * `\p{L}` matters for every non-English language the checker offers: an
 * ASCII-only pattern splits "análisis" into "an" + "lisis" and hands both to
 * the spell checker as if they were words, so correctly spelled Spanish (and
 * French, German, Portuguese) text gets underlined precisely where it carries
 * an accent. `\p{M}` keeps decomposed accents (NFD, e.g. "a" + U+0301) welded
 * to the letter they belong to. Apostrophes and hyphens stay word-internal
 * ("don't", "well-known"); digits stay out, so "H2O" is never a word.
 */
const WORD_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;

/** Trailing punctuation is part of the sentence, not the word — "word-" or
 * "él'" would otherwise be handed to the checker verbatim and flagged. */
const TRAILING_PUNCTUATION_RE = /['’-]+$/;

/** Individual spell-checkable words in LaTeX source, skipping non-prose regions. */
export function extractCheckableSpans(text: string): CheckableSpan[] {
  const mask = buildExclusionMask(text);
  const spans: CheckableSpan[] = [];

  WORD_RE.lastIndex = 0;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = WORD_RE.exec(text))) {
    const word = wordMatch[0].replace(TRAILING_PUNCTUATION_RE, "");
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
