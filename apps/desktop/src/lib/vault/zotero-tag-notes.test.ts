import { describe, expect, it } from "vitest";
import {
  newTagNote,
  noteNameFor,
  parseTag,
  tagTypes,
  withField,
} from "./zotero-tag-notes";

const types = tagTypes([
  { id: "type-m", label: "Method", color: "#000", zoteroTag: "method" },
  { id: "type-x", label: "Plain", color: "#000" },
]);

describe("what a tag pairs with", () => {
  it("reads typed tags, and only for types with a Zotero tag word", () => {
    expect(parseTag("topic: Corporate science", types)).toMatchObject({
      type: { kind: "topic" },
      name: "Corporate science",
    });
    expect(parseTag("Method: Diff-in-diff", types)).toMatchObject({
      type: { kind: "type-m" },
      name: "Diff-in-diff",
    });
    expect(parseTag("plain: anything", types)).toBeNull();
    expect(parseTag("Network theory", types)).toBeNull();
  });

  it("names a note from the tag, keeping it a valid file name", () => {
    expect(noteNameFor("topic: R&D / innovation", types)).toBe(
      "R&D innovation",
    );
    expect(noteNameFor("Network theory", types)).toBe("Network theory");
  });
});

describe("writing the note", () => {
  it("records the exact tag in the frontmatter", () => {
    expect(
      withField(
        "---\ntags: [topic]\n---\nx",
        "zotero_tag",
        "topic: R&D / innovation",
      ),
    ).toBe('---\ntags: [topic]\nzotero_tag: "topic: R&D / innovation"\n---\nx');
    expect(withField("x", "zotero_tag", "a")).toBe(
      '---\nzotero_tag: "a"\n---\nx',
    );
  });

  it("makes a new note of the type, with the tag recorded", () => {
    const text = newTagNote(
      { kind: "type-m", label: "Method", obsidianTag: "#method" },
      "Diff-in-diff",
      "method: Diff-in-diff",
      "2026-10-11",
    );
    expect(text).toContain("- method");
    expect(text).toContain('zotero_tag: "method: Diff-in-diff"');
    expect(text).toContain("## About this method");
    expect(text).toContain("%% begin zotero %%");
  });
});
