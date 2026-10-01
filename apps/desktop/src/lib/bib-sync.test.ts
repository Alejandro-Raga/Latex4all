import { describe, expect, it } from "vitest";
import { mergeSyncedBib, parseBibEntries } from "./bib-sync";

const entry = (key: string, title: string) =>
  `@article{${key},\n  title = {${title}},\n}`;

describe("syncing a .bib with Zotero", () => {
  const before = [
    entry("nelson_simple_1959", "Simple"),
    entry("handAdded2020", "Added by a collaborator"),
    entry("arrow_economic_1962", "Economic welfare"),
  ].join("\n\n");
  const keyMap = { N1: "nelson_simple_1959", A1: "arrow_economic_1962" };

  it("keeps entries Zotero didn't make, in their place", () => {
    const { content } = mergeSyncedBib({
      content: before,
      keyMap,
      updated: [
        {
          key: "N1",
          citekey: "nelson_simple_1959",
          bibtex: entry("nelson_simple_1959", "Simple v2"),
        },
      ],
      complete: true,
    });
    expect([...parseBibEntries(content).keys()]).toEqual([
      "nelson_simple_1959",
      "handAdded2020",
    ]);
    expect(content).toContain("Simple v2");
  });

  it("keeps the key the text uses when Zotero would make another", () => {
    const { content, keyMap: next } = mergeSyncedBib({
      content: before,
      keyMap,
      updated: [
        {
          key: "N1",
          citekey: "nelson_economics_1959",
          bibtex: entry("nelson_economics_1959", "Renamed"),
        },
        {
          key: "A1",
          citekey: "arrow_economic_1962",
          bibtex: entry("arrow_economic_1962", "Economic welfare"),
        },
      ],
      complete: true,
    });
    expect(next).toEqual(keyMap);
    expect(content).toContain(
      "@article{nelson_simple_1959,\n  title = {Renamed}",
    );
    expect(content).not.toContain("nelson_economics_1959");
  });

  it("takes over a hand-made entry once its paper is in Zotero under that key", () => {
    const { content } = mergeSyncedBib({
      content: before,
      keyMap: { ...keyMap, NEW: "handAdded2020" },
      updated: [
        {
          key: "NEW",
          citekey: "smith_added_2020",
          bibtex: entry("smith_added_2020", "From Zotero now"),
        },
      ],
      complete: false,
    });
    expect(parseBibEntries(content).get("handAdded2020")).toContain(
      "From Zotero now",
    );
  });

  it("applies changes and deletions incrementally", () => {
    const { content, keyMap: next } = mergeSyncedBib({
      content: before,
      keyMap,
      updated: [
        {
          key: "Z9",
          citekey: "zahra_2002",
          bibtex: entry("zahra_2002", "New"),
        },
      ],
      deleted: ["A1"],
      complete: false,
    });
    expect([...parseBibEntries(content).keys()]).toEqual([
      "nelson_simple_1959",
      "handAdded2020",
      "zahra_2002",
    ]);
    expect(next).toEqual({ N1: "nelson_simple_1959", Z9: "zahra_2002" });
  });
});
