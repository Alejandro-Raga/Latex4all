import { describe, expect, it } from "vitest";
import {
  bibEntries,
  checkCitations,
  citekeySearch,
  renameCiteKey,
} from "./citations";

const BIB = `@article{nelson_simple_1959,
  title = {The Simple Economics of Basic Scientific Research},
  year = {1959}
}
@comment{ignored}
@book{unused_book_2001, title = "A Book Nobody Cites"}
@string{jpe = "Journal"}
`;

describe("citation check", () => {
  it("reads entries and titles, skipping @comment and @string", () => {
    expect(bibEntries(BIB, "refs.bib")).toEqual([
      {
        key: "nelson_simple_1959",
        title: "The Simple Economics of Basic Scientific Research",
        file: "refs.bib",
      },
      {
        key: "unused_book_2001",
        title: "A Book Nobody Cites",
        file: "refs.bib",
      },
    ]);
  });

  it("reads titles with inner braces, accents and escapes whole", () => {
    const bib = String.raw`@article{a, shorttitle = {Short},
  title = {The {Rate} and {Direction} of {R\&D}: {M}arkets in {Espa\~{n}a}},
}
@book{b, title = "A {Quoted} Title"}`;
    expect(bibEntries(bib, "r.bib").map((e) => e.title)).toEqual([
      "The Rate and Direction of R&D: Markets in Espana",
      "A Quoted Title",
    ]);
  });

  it("finds citations without entries and entries never cited", () => {
    const report = checkCitations(
      [
        {
          content: String.raw`As \citet{nelson_simple_1959} and \cite{Arrow1962} argue.`,
        },
      ],
      [{ path: "refs.bib", content: BIB }],
    );
    expect(report.missing).toEqual(["Arrow1962"]);
    expect(report.unused.map((e) => e.key)).toEqual(["unused_book_2001"]);
  });

  it("treats \\nocite{*} as citing everything", () => {
    expect(
      checkCitations(
        [{ content: String.raw`\nocite{*}` }],
        [{ path: "r.bib", content: BIB }],
      ).unused,
    ).toEqual([]);
  });

  it("renames a key only inside cite commands", () => {
    const tex = String.raw`Nelson1959 said \citep[p.~2]{Nelson1959, arrow1962} and \cite{Nelson1959x}.`;
    expect(renameCiteKey(tex, "Nelson1959", "nelson_simple_1959")).toBe(
      String.raw`Nelson1959 said \citep[p.~2]{nelson_simple_1959, arrow1962} and \cite{Nelson1959x}.`,
    );
  });

  it("guesses search words from different key styles", () => {
    expect(citekeySearch("nelson_simple_1959")).toEqual({
      words: "nelson",
      year: "1959",
    });
    expect(citekeySearch("Nelson1959")).toEqual({
      words: "Nelson",
      year: "1959",
    });
    expect(citekeySearch("rotoloWhyFirmsPublish2022")).toEqual({
      words: "rotolo",
      year: "2022",
    });
    // Zotero's key for an item without an author (a web page, say).
    expect(citekeySearch("noauthor_horizon_2025")).toEqual({
      words: "horizon",
      year: "2025",
    });
  });
});
