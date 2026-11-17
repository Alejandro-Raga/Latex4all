/**
 * Copies a sync set aside when two versions of a file met: Latex4All's own
 * "main (conflicted copy).tex", Dropbox's "main (Ana's conflicted copy
 * 2026-10-26).tex" and Seafile's "main (SFConflict ana@x.org 2026-10-26-…).tex".
 */
import { diffHunks } from "./text-merge";

const COPY =
  /^(.*?) ?\((?:[^()]*conflicted copy[^()]*(?:\(\d+\))?|SFConflict[^()]*)\)(\.[^.\s()]*)?$/i;

/** The file `path` is a copy of, or null if it isn't one. */
export function copyOf(path: string): string | null {
  const slash = path.lastIndexOf("/");
  const m = COPY.exec(path.slice(slash + 1));
  if (!m || !m[1]) return null;
  return `${path.slice(0, slash + 1)}${m[1]}${m[2] ?? ""}`;
}

export interface ConflictedCopy {
  copy: string;
  original: string;
  /** False if the original is gone: the copy is all there is. */
  originalExists: boolean;
}

export function findCopies(paths: readonly string[]): ConflictedCopy[] {
  const all = new Set(paths);
  const out: ConflictedCopy[] = [];
  for (const copy of paths) {
    const original = copyOf(copy);
    if (original)
      out.push({ copy, original, originalExists: all.has(original) });
  }
  return out.sort((a, b) => a.copy.localeCompare(b.copy));
}

/**
 * Copies of system clutter and Git's pointer file: never anyone's work, so
 * removed without asking.
 */
export function isClutterCopy(c: ConflictedCopy) {
  const name = c.original.slice(c.original.lastIndexOf("/") + 1).toLowerCase();
  return [".git", ".ds_store", "thumbs.db", "desktop.ini"].includes(name);
}

export interface Difference {
  /** Line in the original where it starts, from 1. */
  line: number;
  before: string;
  /** What the original has there, and what the copy has instead. */
  original: string;
  copy: string;
  after: string;
}

const CONTEXT = 40;

/** Where the copy differs from the original, with a little text around. */
export function differences(original: string, copy: string): Difference[] {
  return diffHunks(original, copy).map((h) => {
    const start = Math.max(0, h.fromA - CONTEXT);
    const end = Math.min(original.length, h.toA + CONTEXT);
    return {
      line: original.slice(0, h.fromA).split("\n").length,
      before: (start > 0 ? "…" : "") + original.slice(start, h.fromA),
      original: original.slice(h.fromA, h.toA),
      copy: copy.slice(h.fromB, h.toB),
      after: original.slice(h.toA, end) + (end < original.length ? "…" : ""),
    };
  });
}
