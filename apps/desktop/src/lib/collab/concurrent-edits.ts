import * as Y from "yjs";
import { addSuggestion } from "@/lib/annotations/shared-annotations";
import type { Author } from "@/lib/annotations/types";
import { mergeText } from "@/lib/text-merge";
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
