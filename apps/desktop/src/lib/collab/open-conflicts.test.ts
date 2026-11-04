import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addSuggestion } from "@/lib/annotations/shared-annotations";
import { openConflicts } from "./open-conflicts";
import { addTextFile, filesMap } from "./project-doc";

describe("conflicts still open in a shared project", () => {
  it("counts unsettled conflicts, not suggestions or settled ones", () => {
    const doc = new Y.Doc();
    const id = addTextFile(doc, "main.tex", "The cat sat on the mat.");
    const text = filesMap(doc).get(id)?.get("text") as Y.Text;
    const base = { author: "A", authorColor: "#000", at: 0 };
    doc.transact(() => {
      addSuggestion(doc, id, text, 4, 7, {
        ...base,
        text: "dog",
        conflict: true,
      });
      addSuggestion(doc, id, text, 19, 22, { ...base, text: "rug" });
      addSuggestion(doc, id, text, 8, 11, {
        ...base,
        text: "lay",
        conflict: true,
        settled: { accepted: true, by: "A", at: 1, original: "sat" },
      });
    });
    expect(openConflicts(doc)).toBe(1);
  });
});
