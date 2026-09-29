import { describe, expect, it } from "vitest";
import { findPdfTextInSource, sourceWords } from "./pdf-to-source";

const SOURCE = String.raw`\section{Introduction}
% a comment mentioning scientists
Given that \emph{scientists} are a key source of ideas that drive
economic growth~\cite{romer1990}, it is important to know how costly
it is to redirect them. Caf\'e talk aside, the r\^ole of funding matters.

Given that scientists are a key source of ideas, we look again.
`;

const at = (r: { from: number; to: number } | null) =>
  r ? SOURCE.slice(r.from, r.to) : null;

describe("findPdfTextInSource", () => {
  it("skips commands, braces and comments when reading the source", () => {
    const words = sourceWords(String.raw`\emph{Hi} % gone
there`).map((t) => t.word);
    expect(words).toEqual(["hi", "there"]);
  });

  it("finds a phrase across markup and a line break", () => {
    expect(
      at(
        findPdfTextInSource(
          SOURCE,
          "scientists are a key source of ideas that drive economic growth",
          3,
        ),
      ),
    ).toBe("scientists} are a key source of ideas that drive\neconomic growth");
  });

  it("tolerates words only the PDF has, like a citation number", () => {
    expect(
      at(
        findPdfTextInSource(SOURCE, "economic growth [12], it is important", 4),
      ),
    ).toBe("economic growth~\\cite{romer1990}, it is important");
  });

  it("picks the occurrence nearest the line SyncTeX gives", () => {
    const early = findPdfTextInSource(
      SOURCE,
      "Given that scientists are a key source of ideas",
      3,
    );
    const late = findPdfTextInSource(
      SOURCE,
      "Given that scientists are a key source of ideas",
      7,
    );
    expect(early && late && early.from < late.from).toBe(true);
    expect(at(late)).toBe("Given that scientists are a key source of ideas");
  });

  it("matches accented and ligature text from the PDF", () => {
    expect(at(findPdfTextInSource(SOURCE, "the rôle of funding", 5))).toBe(
      "the r\\^ole of funding",
    );
    expect(
      findPdfTextInSource("the ﬁrst ofﬁce", "first office"),
    ).not.toBeNull();
  });

  it("gives up on text that isn't there", () => {
    expect(
      findPdfTextInSource(SOURCE, "completely unrelated words appear here", 3),
    ).toBeNull();
  });
});
