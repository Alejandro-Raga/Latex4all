import { describe, expect, it } from "vitest";
import { isOwnFile, noteTypesFile, readNoteTypesFile } from "./note-types-file";

describe("note types kept in the vault", () => {
  it("reads back what it writes", () => {
    const types = [
      {
        id: "type-m",
        label: "Method",
        color: "#14b8a6",
        folder: "Methods",
        zoteroTag: "method",
      },
      { id: "type-d", label: "Dataset", color: "#f97316" },
    ];
    expect(readNoteTypesFile(noteTypesFile(types))).toEqual(types);
  });

  it("reads nothing from a file it can't make sense of", () => {
    expect(
      readNoteTypesFile("---\nlatex4all: note-types\n---\nnot json"),
    ).toBeNull();
    expect(readNoteTypesFile("```json\n{oops\n```")).toBeNull();
  });

  it("keeps its own files out of the notes", () => {
    expect(isOwnFile("Latex4All/Note types.md")).toBe(true);
    expect(isOwnFile("Papers/Latex4All.md")).toBe(false);
  });
});
