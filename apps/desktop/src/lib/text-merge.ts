import { diff } from "@codemirror/merge";

/** A stretch that differs between two texts, as offsets into each. */
export interface Hunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

/** Where both sides changed the same text in different ways. */
export interface MergeConflict {
  /** The version that was kept, as offsets into the merged text. */
  from: number;
  to: number;
  /** What the other side had there instead ("" if it deleted it). */
  other: string;
  /** Whether `other` is `ours`, rather than `theirs`. */
  otherIsOurs: boolean;
}

// Words, runs of spaces, and single characters (whole code points, so an
// emoji is never split).
const TOKEN = /[\p{L}\p{N}_]+|\s+|[\s\S]/gu;
// Each distinct token is diffed as one character: from U+0100, skipping the
// surrogate range.
const MAX_TOKENS = 0xffff - 0x100 - 0x800;

function tokenCode(index: number) {
  const code = 0x100 + index;
  return String.fromCharCode(code < 0xd800 ? code : code + 0x800);
}

/**
 * The stretches where `a` and `b` differ, a word at a time, so a changed
 * word reads as one change rather than a scatter of letters.
 */
export function diffHunks(a: string, b: string): Hunk[] {
  if (a === b) return [];
  const codes = new Map<string, string>();
  const encode = (text: string) => {
    const tokens = text.match(TOKEN) ?? [];
    let encoded = "";
    for (const token of tokens) {
      let code = codes.get(token);
      if (code === undefined) {
        if (codes.size >= MAX_TOKENS) return null;
        code = tokenCode(codes.size);
        codes.set(token, code);
      }
      encoded += code;
    }
    return { tokens, encoded };
  };
  const left = encode(a);
  const right = left && encode(b);
  if (!left || !right) {
    return diff(a, b).map(({ fromA, toA, fromB, toB }) => ({
      fromA,
      toA,
      fromB,
      toB,
    }));
  }
  const offsets = (tokens: string[]) => {
    const result = [0];
    for (const token of tokens)
      result.push(result[result.length - 1] + token.length);
    return result;
  };
  const atA = offsets(left.tokens);
  const atB = offsets(right.tokens);
  return diff(left.encoded, right.encoded).map((change) => ({
    fromA: atA[change.fromA],
    toA: atA[change.toA],
    fromB: atB[change.fromB],
    toB: atB[change.toB],
  }));
}

/**
 * Three-way merge: what changed from `base` to `ours` and from `base` to
 * `theirs`, together. Where both changed the same text differently, `theirs`
 * is kept, unless all it did was delete it, and the other version is
 * reported as a conflict.
 */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): { text: string; conflicts: MergeConflict[] } {
  if (ours === theirs || base === ours) return { text: theirs, conflicts: [] };
  if (base === theirs) return { text: ours, conflicts: [] };

  const hunks = [
    ...diffHunks(base, ours).map((h) => ({ ...h, ours: true })),
    ...diffHunks(base, theirs).map((h) => ({ ...h, ours: false })),
  ].sort((x, y) => x.fromA - y.fromA || x.toA - y.toA);

  let text = "";
  const conflicts: MergeConflict[] = [];
  let pos = 0;
  // How far each side's offsets have drifted from the base's so far.
  let shiftOurs = 0;
  let shiftTheirs = 0;
  let i = 0;
  while (i < hunks.length) {
    // Changes that overlap or touch, on either side, are settled together.
    const from = hunks[i].fromA;
    let to = hunks[i].toA;
    let hasOurs = false;
    let hasTheirs = false;
    let growOurs = 0;
    let growTheirs = 0;
    while (i < hunks.length && hunks[i].fromA <= to) {
      const h = hunks[i];
      to = Math.max(to, h.toA);
      const grow = h.toB - h.fromB - (h.toA - h.fromA);
      if (h.ours) {
        hasOurs = true;
        growOurs += grow;
      } else {
        hasTheirs = true;
        growTheirs += grow;
      }
      i++;
    }
    const mine = ours.slice(from + shiftOurs, to + shiftOurs + growOurs);
    const other = theirs.slice(
      from + shiftTheirs,
      to + shiftTheirs + growTheirs,
    );
    shiftOurs += growOurs;
    shiftTheirs += growTheirs;

    text += base.slice(pos, from);
    if (!hasTheirs || mine === other) {
      text += mine;
    } else if (!hasOurs) {
      text += other;
    } else {
      const keepOurs = other === "";
      const kept = keepOurs ? mine : other;
      conflicts.push({
        from: text.length,
        to: text.length + kept.length,
        other: keepOurs ? other : mine,
        otherIsOurs: !keepOurs,
      });
      text += kept;
    }
    pos = to;
  }
  text += base.slice(pos);
  return { text, conflicts };
}

/**
 * The smallest edits that turn `from` into `to`, one per changed stretch, as
 * CodeMirror change specs (or for applying to a Y.Text, last first). They're
 * a character at a time, so highlights and cursors inside a word stay put.
 */
export function textChanges(from: string, to: string) {
  if (from === to) return [];
  return diff(from, to).map((c) => ({
    from: c.fromA,
    to: c.toA,
    insert: to.slice(c.fromB, c.toB),
  }));
}
