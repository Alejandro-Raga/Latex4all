import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { annotationsMap } from "@/lib/annotations/shared-annotations";
import { MAX_NOTED_DIFFERENCES, noteDifferences } from "./concurrent-edits";
import { addTextFile, filesMap } from "./project-doc";

function file(content: string) {
  const doc = new Y.Doc();
  const fileId = addTextFile(doc, "main.tex", content);
  const text = filesMap(doc).get(fileId)?.get("text") as Y.Text;
  return { doc, fileId, text };
}

function notes(doc: Y.Doc, text: Y.Text) {
  return [...annotationsMap(doc).values()].map((entry) => {
    const from = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(entry.get("from")),
      doc,
    )?.index;
    const to = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(entry.get("to")),
      doc,
    )?.index;
    return {
      on: text.toString().slice(from, to),
      instead: (entry.get("suggestion") as { text: string }).text,
    };
  });
}

const me = { name: "Me", color: "#000" };

describe("differences met for the first time", () => {
  it("keeps the shared text and offers each change here on it", () => {
    const { doc, fileId, text } = file("The cat sat on the mat.");
    const found = noteDifferences(
      doc,
      fileId,
      text,
      "The dog sat on a mat.",
      me,
    );
    expect(text.toString()).toBe("The cat sat on the mat.");
    expect(found).toHaveLength(2);
    expect(notes(doc, text)).toEqual([
      { on: "cat", instead: "dog" },
      { on: "the", instead: "a" },
    ]);
  });

  it("offers an addition over the word before it", () => {
    const { doc, fileId, text } = file("The cat sat.");
    noteDifferences(doc, fileId, text, "The black cat sat.", me);
    expect(notes(doc, text)).toEqual([{ on: " ", instead: " black " }]);
  });

  it("offers a deletion as the text to remove", () => {
    const { doc, fileId, text } = file("The black cat sat.");
    noteDifferences(doc, fileId, text, "The cat sat.", me);
    expect(notes(doc, text)).toEqual([{ on: "black ", instead: "" }]);
  });

  it("leaves a file that differs everywhere to be kept as a copy", () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`);
    const { doc, fileId, text } = file(words.join(" "));
    const mine = words.map((w, i) => (i % 2 ? `${w}x` : w)).join(" ");
    expect(MAX_NOTED_DIFFERENCES).toBeLessThan(30);
    expect(noteDifferences(doc, fileId, text, mine, me)).toBeNull();
    expect(annotationsMap(doc).size).toBe(0);
  });
});
