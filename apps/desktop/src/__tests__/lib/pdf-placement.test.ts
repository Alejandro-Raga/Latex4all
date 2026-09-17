import { describe, expect, it } from "vitest";
import {
  type PageChar,
  type SourceBox,
  lineAt,
  placeHighlight,
  snippetWords,
} from "@/lib/annotations/pdf-placement";

/** Lays text out as a page would: 5 pt per character, 10 pt tall lines. */
function page(
  lines: Array<{ text: string; y: number; x?: number }>,
): PageChar[] {
  return lines.flatMap(({ text, y, x = 72 }, line) =>
    [...text].map((c, i) => ({
      c,
      x0: x + i * 5,
      y0: y,
      x1: x + (i + 1) * 5,
      y1: y + 10,
      line,
    })),
  );
}

const box = (line: number, y: number, pageNumber = 1): SourceBox => ({
  line,
  page: pageNumber,
  x: 72,
  y,
  width: 400,
  height: 12,
});

describe("placing highlights on the PDF", () => {
  it("covers the words themselves, across a hyphenated line break", () => {
    const chars = page([
      { text: "The results are signi-", y: 100 },
      { text: "ficant indeed.", y: 112 },
    ]);
    const [placed] = placeHighlight(
      "results are \\emph{significant}",
      [box(3, 99), box(3, 111)],
      new Map([[0, chars]]),
    );
    expect(placed.pageIndex).toBe(0);
    expect(placed.rects).toEqual([
      // "results are signi" — from x of "r" to the end of "i", hyphen left out
      { x: 72 + 4 * 5, y: 100, w: 17 * 5, h: 10 },
      // "ficant"
      { x: 72, y: 112, w: 6 * 5, h: 10 },
    ]);
  });

  it("reads ligatures as their letters", () => {
    const chars = page([{ text: "a ﬁne day", y: 100 }]);
    const [placed] = placeHighlight(
      "fine",
      [box(1, 99)],
      new Map([[0, chars]]),
    );
    expect(placed.rects).toEqual([{ x: 72 + 2 * 5, y: 100, w: 3 * 5, h: 10 }]);
  });

  it("picks the occurrence SyncTeX points at, not the first on the page", () => {
    const chars = page([
      { text: "results elsewhere", y: 100 },
      { text: "our results here", y: 500 },
    ]);
    const [placed] = placeHighlight(
      "results",
      [box(9, 499)],
      new Map([[0, chars]]),
    );
    expect(placed.rects).toEqual([{ x: 72 + 4 * 5, y: 500, w: 7 * 5, h: 10 }]);
  });

  it("falls back to SyncTeX's boxes when the words aren't there as text", () => {
    const chars = page([{ text: "E = mc", y: 100 }]);
    const placed = placeHighlight(
      "$\\int_0^1 f$",
      [box(4, 99)],
      new Map([[0, chars]]),
    );
    expect(placed).toEqual([
      { pageIndex: 0, rects: [{ x: 72, y: 99, w: 400, h: 12 }] },
    ]);
  });

  it("ignores LaTeX commands when reading the source", () => {
    expect(snippetWords("see \\cite{knuth} and \\textbf{Bold} words")).toEqual([
      "see",
      "and",
      "bold",
      "words",
    ]);
    expect(lineAt("a\nb\nc", 4)).toBe(3);
  });
});
