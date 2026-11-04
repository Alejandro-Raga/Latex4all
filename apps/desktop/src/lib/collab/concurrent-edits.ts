import * as Y from "yjs";
import { addSuggestion } from "@/lib/annotations/shared-annotations";
import type { Author } from "@/lib/annotations/types";
import { diffHunks, mergeText } from "@/lib/text-merge";
import { LOCAL, applyTextChange, filesMap, layout } from "./project-doc";

function textOf(doc: Y.Doc, fileId: string) {
  const text = filesMap(doc).get(fileId)?.get("text");
  return text instanceof Y.Text ? text.toString() : null;
}

/**
 * After catching up on changes made elsewhere while this device made its
 * own: wherever both changed the same text, keep one version whole instead
 * of the two mixed letter by letter, and offer the other as a suggestion.
 * Theirs is kept, since others have already seen it; unless they only
 * deleted it.
 *
 * Returns where each conflict is, for pointing the user to them.
 */
export function settleConcurrentEdits(
  doc: Y.Doc,
  base: Y.Doc,
  mine: Y.Doc,
  theirs: Y.Doc,
  me: Author,
): Array<{ path: string; from: number }> {
  const found: Array<{ path: string; from: number }> = [];
  doc.transact(() => {
    for (const file of layout(doc).values()) {
      if (file.kind !== "text") continue;
      const before = textOf(base, file.fileId);
      const ours = textOf(mine, file.fileId);
      const others = textOf(theirs, file.fileId);
      if (before === null || ours === null || others === null) continue;
      const { text, conflicts } = mergeText(before, ours, others);
      if (conflicts.length === 0) continue;
      applyTextChange(file.text, text);
      for (const conflict of conflicts) {
        addSuggestion(doc, file.fileId, file.text, conflict.from, conflict.to, {
          text: conflict.other,
          author: conflict.otherIsOurs ? me.name : "",
          authorColor: conflict.otherIsOurs ? me.color : "",
          at: Date.now(),
          conflict: true,
        });
        found.push({ path: file.path, from: conflict.from });
      }
    }
  }, LOCAL);
  return found;
}

/** More differences than this and a file is kept as a copy instead. */
export const MAX_NOTED_DIFFERENCES = 25;

// The word (or space, or character) before or after an offset.
const LAST_TOKEN = /(?:[\p{L}\p{N}_]+|\s+|[\s\S])$/u;
const FIRST_TOKEN = /^(?:[\p{L}\p{N}_]+|\s+|[\s\S])/u;

/**
 * Where `mine` differs from the shared text, with no common version to
 * merge from (a folder compared with the shared copy for the first time):
 * the shared text stays, and each stretch that differs here is offered on
 * it as a conflict, instead of a whole "(conflicted copy)" file. An addition
 * here is offered over the word before it, so it has text to sit on.
 *
 * Returns where each one is, or null (nothing done) if the two differ in
 * more than MAX_NOTED_DIFFERENCES places, or the shared text is empty.
 */
export function noteDifferences(
  doc: Y.Doc,
  fileId: string,
  text: Y.Text,
  mine: string,
  me: Author,
): number[] | null {
  const shared = text.toString();
  if (shared === mine) return [];
  if (shared === "") return null;
  const hunks = diffHunks(shared, mine);
  if (hunks.length > MAX_NOTED_DIFFERENCES) return null;
  const found: number[] = [];
  doc.transact(() => {
    for (const h of hunks) {
      let { fromA, toA, fromB, toB } = h;
      if (fromA === toA) {
        const before = LAST_TOKEN.exec(shared.slice(0, fromA))?.[0] ?? "";
        if (before) {
          fromA -= before.length;
          fromB -= before.length;
        } else {
          const after = FIRST_TOKEN.exec(shared.slice(toA))?.[0] ?? "";
          toA += after.length;
          toB += after.length;
        }
      }
      addSuggestion(doc, fileId, text, fromA, toA, {
        text: mine.slice(fromB, toB),
        author: me.name,
        authorColor: me.color,
        at: Date.now(),
        conflict: true,
      });
      found.push(fromA);
    }
  }, LOCAL);
  return found;
}
