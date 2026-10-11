import { describe, expect, it } from "vitest";
import {
  bibEntries,
  checkCitations,
  citekeySearch,
  missingCitations,
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
    expect(bibEntries(BIB, "refs.bib")).toMatchObject([
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

describe("citations a reply adds", () => {
  it("finds keys cited but in no bibliography", () => {
    expect(
      missingCitations(
        [String.raw`As \citet{nelson_simple_1959} and \cite{made_up_2024}.`],
        [BIB],
      ),
    ).toEqual(["made_up_2024"]);
  });

  it("reads an entry's DOI, year, first author and where it is", () => {
    const bib = String.raw`@article{arora_decline_2018,
  author = {Arora, Ashish and Belenzon, Sharon},
  title = {The decline of science in corporate {R\&D}},
  year = {2018},
  doi = {https://doi.org/10.1002/SMJ.2693},
}
@article{b, author = {Wesley M. Cohen}, date = {1990-03}, title = {X}}`;
    const [a, b] = bibEntries(bib, "r.bib");
    expect(a).toMatchObject({
      doi: "10.1002/smj.2693",
      year: "2018",
      author: "Arora",
    });
    expect(bib.slice(a.start, a.end).endsWith("}")).toBe(true);
    expect(bib.slice(a.start, a.end)).toContain("doi = ");
    expect(b).toMatchObject({ year: "1990", author: "Cohen" });
  });

  it("counts only the .bib files the document uses, and says why the others don't count", () => {
    const tex = [{ content: String.raw`\cite{a}\bibliography{refs}` }];
    const bibs = [
      { path: "refs.bib", content: "@article{a, title={A}}" },
      { path: "Test.bib", content: "@article{t, title={T}}" },
      {
        path: "refs (SFConflict me 2026-06-27).bib",
        content: "@article{a, title={A}}",
      },
    ];
    const report = checkCitations(tex, bibs);
    expect(report.unused).toEqual([]);
    expect(report.ignored).toEqual([
      { path: "Test.bib", why: "not used" },
      { path: "refs (SFConflict me 2026-06-27).bib", why: "conflict copy" },
    ]);
  });

  it("counts every .bib when the document names none (biber setups, say)", () => {
    const report = checkCitations(
      [{ content: String.raw`\cite{a}` }],
      [
        { path: "x.bib", content: "@article{a, title={A}}" },
        { path: "y.bib", content: "@article{b, title={B}}" },
      ],
    );
    expect(report.unused.map((e) => e.key)).toEqual(["b"]);
  });

  it("reads and renames every key of a multicite", () => {
    const tex = String.raw`see \parencites[cf.][2]{a}[3]{b,c} and \cite[p.~4]{d}`;
    expect(checkCitations([{ content: tex }], []).cited).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(renameCiteKey(tex, "c", "z")).toBe(
      String.raw`see \parencites[cf.][2]{a}[3]{b,z} and \cite[p.~4]{d}`,
    );
  });
});
