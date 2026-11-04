import type * as Y from "yjs";
import { annotationsMap } from "@/lib/annotations/shared-annotations";

/**
 * How many conflicts in a shared project's document are still waiting for
 * someone to keep one version or the other (settled ones are kept, marked).
 */
export function openConflicts(doc: Y.Doc): number {
  let n = 0;
  for (const entry of annotationsMap(doc).values()) {
    const s = entry.get("suggestion") as
      | { conflict?: boolean; settled?: unknown }
      | undefined;
    if (s?.conflict && !s.settled) n++;
  }
  return n;
}
