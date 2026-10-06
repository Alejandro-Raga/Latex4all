import { describe, expect, it } from "vitest";
import { withPassageComment, withoutPassage } from "./passage-edits";

const note = [
  "## Passages",
  "",
  "### [[Bloom2020]] Are Ideas Getting Harder to Find?",
  "",
  "> Research productivity is falling",
  "> sharply.",
  "> — [[Bloom2020#^aaaa1111|Bloom2020, p. 2]] · [PDF](zotero://open-pdf/library/items/ATT00001?page=2&annotation=AAAA1111)",
  "",
  "My comment",
  "",
  "> Another passage",
  "> — [[Bloom2020#^bbbb2222|Bloom2020, p. 3]] · [PDF](zotero://open-pdf/library/items/ATT00001?page=3&annotation=BBBB2222)",
  "",
].join("\n");

describe("a filed highlight changed afterwards", () => {
  it("leaves with its quote and note when deleted", () => {
    const next = withoutPassage(note, "AAAA1111", "My comment");
    expect(next).not.toContain("Research productivity");
    expect(next).not.toContain("My comment");
    expect(next).toContain("> Another passage");
    expect(next).not.toContain("\n\n\n");
  });

  it("keeps a paragraph that isn't its note", () => {
    const next = withoutPassage(note, "AAAA1111");
    expect(next).toContain("My comment");
    expect(next).not.toContain("Research productivity");
  });

  it("shows its new note, or none", () => {
    const edited = withPassageComment(
      note,
      "AAAA1111",
      "My comment",
      "Changed",
    );
    expect(edited).toContain("sharply.");
    expect(edited).toContain("\nChanged\n");
    expect(edited).not.toContain("My comment");
    const added = withPassageComment(note, "BBBB2222", undefined, "New one");
    expect(added).toContain("annotation=BBBB2222)\n\nNew one");
    const gone = withPassageComment(note, "AAAA1111", "My comment", "");
    expect(gone).not.toContain("My comment");
  });

  it("changes nothing when the highlight isn't there", () => {
    expect(withoutPassage(note, "ZZZZ9999")).toBe(note);
  });
});
