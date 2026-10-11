import { describe, expect, it } from "vitest";
import type { LibraryMirror } from "@/lib/zotero-library";
import type { VaultIndex, VaultNote } from "./vault-index";
import {
  looksLikeStatus,
  newTagNote,
  noteNameFor,
  outsideTagSection,
  parseTag,
  TAG_BEGIN,
  TAG_END,
  type TagMembers,
  tagSection,
  tagTypes,
  withField,
  withTagSection,
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

  it("flags tags about reading status, not subjects", () => {
    expect(looksLikeStatus("to read")).toBe(true);
    expect(looksLikeStatus("from: Essays on Corporate Science")).toBe(true);
    expect(looksLikeStatus("Network theory")).toBe(false);
  });
});

const paper = (name: string, zoteroKey: string, title: string, year: string) =>
  ({ name, kind: "paper", zoteroKey, title, year }) as VaultNote;
const index = {
  list: [paper("Arora2018", "ARORA001", "The decline of science", "2018")],
} as VaultIndex;
const mirror = {
  items: { OTHER001: { title: "A paper with no note", year: "2010" } },
  attachments: {},
} as unknown as LibraryMirror;
const members: TagMembers = {
  papers: ["ARORA001", "OTHER001"],
  passages: [
    {
      paper: "ARORA001",
      attachment: "PDF00001",
      key: "ANN00001",
      text: "Firms publish less.",
      comment: "Key point",
      page: "3",
      pageIndex: 2,
    },
    {
      paper: "ARORA001",
      attachment: "PDF00001",
      key: "ANN00002",
      text: "Already filed.",
      comment: "",
      page: "4",
      pageIndex: 3,
    },
  ],
};

describe("a tag's section in its note", () => {
  const section = tagSection(
    "topic: Corporate science",
    members,
    index,
    mirror,
    "already: annotation=ANN00002",
  );

  it("lists every paper, linking those with a note, without making notes for the rest", () => {
    expect(section).toContain("- [[Arora2018]] The decline of science (2018)");
    expect(section).toContain(
      "- A paper with no note (2010) · [Zotero](zotero://select/library/items/OTHER001)",
    );
  });

  it("copies the highlights, but not ones the note shows already", () => {
    expect(section).toContain("> Firms publish less.");
    expect(section).toContain("[[Arora2018#^ann00001|Arora2018, p. 3]]");
    expect(section).toContain("Key point");
    expect(section).not.toContain("Already filed.");
  });

  it("leaves out papers the rest of the note links already", () => {
    const again = tagSection(
      "t",
      members,
      index,
      mirror,
      "- [[Arora2018]] listed by hand",
    );
    expect(again).not.toContain("- [[Arora2018]]");
  });

  it("is the same text for the same Zotero data", () => {
    expect(
      tagSection(
        "topic: Corporate science",
        members,
        index,
        mirror,
        "already: annotation=ANN00002",
      ),
    ).toBe(section);
  });
});

describe("writing the note", () => {
  it("replaces only its own section", () => {
    const note = `---\ntags: [topic]\n---\nMine.\n\n${TAG_BEGIN}\nold\n${TAG_END}\n\n## My notes\n\nAlso mine.\n`;
    const next = withTagSection(note, `${TAG_BEGIN}\nnew\n${TAG_END}`);
    expect(next).toContain("Mine.");
    expect(next).toContain("Also mine.");
    expect(next).toContain("new");
    expect(next).not.toContain("old");
    expect(outsideTagSection(next)).not.toContain("new");
  });

  it("adds its section before My notes in a note that has none", () => {
    const next = withTagSection(
      "# Topic\n\nText\n\n## My notes\n\nx\n",
      `${TAG_BEGIN}\n${TAG_END}`,
    );
    expect(next.indexOf(TAG_BEGIN)).toBeLessThan(next.indexOf("## My notes"));
  });

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
    expect(text).toContain(TAG_BEGIN);
  });
});
