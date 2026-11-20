import * as Y from "yjs";
import { annotationsMap } from "@/lib/annotations/shared-annotations";
import { layout } from "./project-doc";

/**
 * How many conflicts in a shared project's document are still waiting for
 * someone to keep one version or the other (settled ones are kept, marked).
 * Only those the editor can show: one whose file or text is gone (deleted
 * or replaced since) has nothing left to choose between.
 */
export function openConflicts(doc: Y.Doc): number {
  const texts = new Map<string, Y.Text>();
  for (const file of layout(doc).values()) {
    if (file.kind === "text") texts.set(file.fileId, file.text);
  }
  const at = (json: unknown, text: Y.Text) => {
    if (!json || typeof json !== "object") return null;
    try {
      const pos = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(json),
        doc,
      );
      return pos && pos.type === text ? pos.index : null;
    } catch {
      return null;
    }
  };
  let n = 0;
  for (const entry of annotationsMap(doc).values()) {
    const s = entry.get("suggestion") as
      | { conflict?: boolean; settled?: unknown }
      | undefined;
    if (!s?.conflict || s.settled) continue;
    const text = texts.get(String(entry.get("fileId")));
    if (!text) continue;
    const from = at(entry.get("from"), text);
    const to = at(entry.get("to"), text);
    if (from !== null && to !== null && from < to) n++;
  }
  return n;
}
