import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import {
  addHighlightAnnotations,
  readPageChars,
} from "@/lib/mupdf/pdf-annotations";
import type { PdfMark } from "@/lib/annotations/pdf-placement";

function onePagePdf() {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Times-Roman"));
  const resources = doc.addObject({ Font: { F1: font } });
  const page = doc.addPage(
    [0, 0, 612, 792],
    0,
    resources,
    "BT /F1 12 Tf 72 700 Td (Hello fine world) Tj ET",
  );
  doc.insertPage(-1, page);
  return doc.saveToBuffer("compress").asUint8Array();
}

const comment = (author: string, text: string) => ({
  id: text,
  author,
  authorColor: "#000",
  text,
  at: 0,
});

describe("PDF annotations", () => {
  it("reads characters with their boxes, top-left based", () => {
    const pdf = mupdf.Document.openDocument(onePagePdf(), "application/pdf");
    const chars = readPageChars(pdf.loadPage(0));
    expect(chars.map((c) => c.c).join("")).toBe("Hello fine world");
    // 700 pt up from the bottom of a 792 pt page is about 92 pt down.
    expect(chars[0].y1).toBeGreaterThan(85);
    expect(chars[0].y0).toBeLessThan(92);
    expect(new Set(chars.map((c) => c.line)).size).toBe(1);
  });

  it("writes highlights and notes a PDF reader can show, leaving the original alone", () => {
    const original = onePagePdf();
    const before = original.slice();
    const marks: PdfMark[] = [
      {
        id: "a",
        pageIndex: 0,
        rects: [{ x: 72, y: 80, w: 40, h: 14 }],
        color: "green",
        resolved: false,
        comments: [comment("Ana", "Check"), comment("Ben", "Done")],
      },
      {
        id: "b",
        pageIndex: 0,
        rects: [{ x: 120, y: 80, w: 20, h: 14 }],
        color: "none",
        resolved: false,
        comments: [comment("Ana", "No color, still a note")],
      },
      {
        id: "c",
        pageIndex: 0,
        rects: [{ x: 150, y: 80, w: 20, h: 14 }],
        color: "yellow",
        resolved: true,
        comments: [comment("Ana", "Resolved, so left out")],
      },
    ];

    const out = addHighlightAnnotations(mupdf, original, marks);
    expect(original).toEqual(before);

    const doc = mupdf.Document.openDocument(
      out,
      "application/pdf",
    ) as mupdf.PDFDocument;
    const annotations = (doc.loadPage(0) as mupdf.PDFPage).getAnnotations();
    expect(annotations.map((a) => a.getType())).toEqual(["Highlight", "Text"]);
    const [highlight, note] = annotations;
    expect(highlight.getContents()).toBe("Ana: Check\n\nBen: Done");
    expect(highlight.getQuadPoints()).toEqual([
      [72, 80, 112, 80, 72, 94, 112, 94],
    ]);
    expect(highlight.getColor().map((v) => Math.round(v * 100) / 100)).toEqual([
      0.29, 0.87, 0.5,
    ]);
    expect(note.getContents()).toBe("Ana: No color, still a note");
  });
});
