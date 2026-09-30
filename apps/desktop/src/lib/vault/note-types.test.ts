import { describe, expect, it } from "vitest";
import { parseNote } from "./parse";
import { buildVaultIndex, type CustomNoteType } from "./vault-index";

const types: CustomNoteType[] = [
  { id: "method", label: "Methods", color: "#ec4899", folder: "Methods" },
  { id: "dataset", label: "Datasets", color: "#14b8a6", tag: "dataset" },
];
const notes = [
  parseNote("Methods/Diff-in-diff.md", "How it works."),
  parseNote("Methods/Panel/Fixed effects.md", "Nested."),
  parseNote("Inbox/Survey 2024.md", "---\ntags: [dataset/survey]\n---\n"),
  parseNote("Papers/Cohen1990.md", "---\ncitekey: cohen1990\n---\n"),
  parseNote("Inbox/Loose.md", "Nothing special."),
];

describe("note types of your own", () => {
  it("take notes by folder (and below it) and by tag", () => {
    const index = buildVaultIndex(notes, {}, types);
    const kind = (n: string) => index.notes.get(n.toLowerCase());
    expect(kind("Diff-in-diff")).toMatchObject({
      kind: "method",
      group: "Methods",
    });
    expect(kind("Fixed effects")).toMatchObject({ kind: "method" });
    expect(kind("Survey 2024")).toMatchObject({
      kind: "dataset",
      group: "Datasets",
    });
    expect(kind("Cohen1990")).toMatchObject({ kind: "paper" });
    expect(kind("Loose")).toMatchObject({ kind: "note", group: "Inbox" });
  });

  it("give way to a type picked by hand, and forget a deleted one", () => {
    const picked = buildVaultIndex(
      notes,
      { cohen1990: "method", loose: "gone" },
      types,
    );
    expect(picked.notes.get("cohen1990")).toMatchObject({
      kind: "method",
      kindChosen: true,
    });
    // A type that no longer exists: back to what the note is found to be.
    expect(picked.notes.get("loose")).toMatchObject({
      kind: "note",
      kindChosen: false,
    });
  });
});
