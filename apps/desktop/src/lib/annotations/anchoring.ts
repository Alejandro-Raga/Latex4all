/**
 * Keeping an annotation on the same words as the text around it changes, for
 * projects that aren't shared (shared ones use Yjs relative positions).
 */

export interface TextChange {
  start: number;
  deleteCount: number;
  insert: string;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The single replacement that turns `prev` into `next`: the part between
 * their common start and common end. Never splits a surrogate pair.
 */
export function textDiff(prev: string, next: string): TextChange | null {
  if (prev === next) return null;
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < max - start &&
    prev.charCodeAt(prev.length - 1 - end) ===
      next.charCodeAt(next.length - 1 - end)
  ) {
    end++;
  }
  if (end > 0 && isLowSurrogate(prev.charCodeAt(prev.length - end))) end--;
  return {
    start,
    deleteCount: prev.length - start - end,
    insert: next.slice(start, next.length - end),
  };
}

/**
 * Where `pos` ends up after `change`. `assoc` says which side it sticks to
 * when text is inserted right at it: 1 moves with the insertion (a
 * highlight's start), -1 stays put (its end), so typing just outside a
 * highlight never joins it.
 */
export function mapPosition(pos: number, change: TextChange, assoc: 1 | -1) {
  const end = change.start + change.deleteCount;
  const inserted = change.insert.length;
  if (pos < change.start) return pos;
  if (pos > end) return pos + inserted - change.deleteCount;
  // At the change, or inside the replaced text.
  if (pos === change.start && change.deleteCount > 0 && assoc < 0) {
    return change.start;
  }
  return assoc > 0 ? change.start + inserted : change.start;
}

export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 32;

export function quoteOf(text: string, from: number, to: number): Quote {
  return {
    exact: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

function sharedSuffixLength(a: string, b: string) {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++;
  return n;
}

function sharedPrefixLength(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Finds a quoted span again in text that changed while nobody was watching
 * (edited in another program, say): the occurrence whose surroundings match
 * best, the nearest to where it was on a tie. Null if the words are gone.
 */
export function reanchor(
  text: string,
  from: number,
  to: number,
  quote: Quote,
): { from: number; to: number } | null {
  if (!quote.exact) return null;
  if (text.slice(from, to) === quote.exact) return { from, to };
  let best: { from: number; score: number; distance: number } | null = null;
  for (
    let at = text.indexOf(quote.exact);
    at !== -1;
    at = text.indexOf(quote.exact, at + 1)
  ) {
    const score =
      sharedSuffixLength(
        text.slice(Math.max(0, at - CONTEXT), at),
        quote.prefix,
      ) +
      sharedPrefixLength(
        text.slice(at + quote.exact.length, at + quote.exact.length + CONTEXT),
        quote.suffix,
      );
    const distance = Math.abs(at - from);
    if (
      !best ||
      score > best.score ||
      (score === best.score && distance < best.distance)
    ) {
      best = { from: at, score, distance };
    }
  }
  return best ? { from: best.from, to: best.from + quote.exact.length } : null;
}
