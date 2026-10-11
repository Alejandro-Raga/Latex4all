import { describe, expect, it } from "vitest";
import { noteForCitekey } from "./cite-link";
import type { VaultIndex, VaultNote } from "./vault-index";

const paper = (name: string, extra: Partial<VaultNote> = {}) =>
  ({
    name,
    kind: "paper",
    title: "",
    citekey: null,
    zoteroKey: null,
    aliases: [],
    authors: [],
    year: null,
    frontmatter: {},
    ...extra,
  }) as VaultNote;

const index = (...list: VaultNote[]) => ({ list }) as VaultIndex;

const vault = index(
  // Zotero has the author's names swapped, so surname and year don't find it.
  paper("Partha1994", {
    title: "Toward a new economics of science",
    authors: ["Partha, Dasgupta"],
    year: "1994",
    frontmatter: { doi: "10.1016/0048-7333(94)01002-1" },
  }),
  paper("Stephan1996", {
    title: "The Economics of Science",
    authors: ["Stephan, Paula"],
    year: "1996",
  }),
);

describe("finding the note a citation means", () => {
  it("by the .bib entry's DOI when the key and author don't match", () => {
    expect(
      noteForCitekey(vault, "dasgupta1994toward", new Map(), {
        doi: "10.1016/0048-7333(94)01002-1",
      })?.name,
    ).toBe("Partha1994");
  });

  it("by title and year", () => {
    expect(
      noteForCitekey(vault, "dasgupta1994toward", new Map(), {
        title: "Toward a New Economics of Science",
        year: "1994",
      })?.name,
    ).toBe("Partha1994");
  });

  it("not by title alone: another year is another work", () => {
    expect(
      noteForCitekey(vault, "stephan2010economics", new Map(), {
        title: "The Economics of Science",
        year: "2010",
      }),
    ).toBeUndefined();
  });

  it("still by surname and year, with no entry at all", () => {
    expect(
      noteForCitekey(vault, "stephan_economics_1996", new Map())?.name,
    ).toBe("Stephan1996");
  });
});
