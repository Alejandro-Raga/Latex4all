import { describe, expect, it } from "vitest";
import { pdfSelectionText } from "./selection-text";

const SVG = "http://www.w3.org/2000/svg";

function page(lines: [string, string][]) {
  const container = document.createElement("div");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "mupdf-text-layer");
  for (const [block, text] of lines) {
    const t = document.createElementNS(SVG, "text");
    t.setAttribute("data-block", block);
    t.textContent = text;
    svg.append(t);
  }
  container.append(svg);
  document.body.append(container);
  return { container, texts: [...svg.querySelectorAll("text")] };
}

function select(from: Node, fromOffset: number, to: Node, toOffset: number) {
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("pdfSelectionText", () => {
  it("joins lines with spaces, paragraphs with line breaks, and rejoins hyphenated words", () => {
    const { container, texts } = page([
      ["0:0", "Given that scien-"],
      ["0:0", "tists are a key source "],
      ["0:0", "of ideas"],
      ["0:1", "A new paragraph."],
    ]);
    select(texts[0].firstChild!, 6, texts[3].firstChild!, 5);
    expect(pdfSelectionText(container)).toBe(
      "that scientists are a key source of ideas\nA new",
    );
  });

  it("keeps real hyphens before capitals and within one line", () => {
    const { container, texts } = page([
      ["1:0", "the Arrow-"],
      ["1:0", "Debreu model is well-known"],
    ]);
    select(texts[0].firstChild!, 0, texts[1].firstChild!, 26);
    expect(pdfSelectionText(container)).toBe(
      "the Arrow- Debreu model is well-known",
    );
  });

  it("is empty with nothing selected", () => {
    const { container } = page([["0:0", "text"]]);
    window.getSelection()!.removeAllRanges();
    expect(pdfSelectionText(container)).toBe("");
  });
});
