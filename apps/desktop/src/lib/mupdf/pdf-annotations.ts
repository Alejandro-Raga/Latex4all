import type { PDFDocument, PDFPage } from "mupdf";
import type { PageChar, PdfMark } from "@/lib/annotations/pdf-placement";

type Mupdf = typeof import("mupdf");

/** The characters of a page with their boxes, and the text line each is on. */
export function readPageChars(page: {
  toStructuredText(options: string): {
    walk(walker: {
      beginLine?: () => void;
      onChar?: (
        c: string,
        origin: unknown,
        font: unknown,
        size: number,
        quad: number[],
      ) => void;
    }): void;
  };
}): PageChar[] {
  const chars: PageChar[] = [];
  let line = -1;
  page.toStructuredText("preserve-whitespace").walk({
    beginLine: () => {
      line++;
    },
    onChar: (c, _origin, _font, _size, quad) => {
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      chars.push({
        c,
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
        line,
      });
    },
  });
  return chars;
}

const RGB = {
  yellow: [0.98, 0.8, 0.08],
  green: [0.29, 0.87, 0.5],
  blue: [0.38, 0.65, 0.98],
  pink: [0.96, 0.45, 0.71],
  purple: [0.65, 0.55, 0.98],
} as const;

function threadText(mark: PdfMark) {
  return mark.comments.map((c) => `${c.author}: ${c.text}`).join("\n\n");
}

/**
 * A copy of `pdf` with the marks written in as real PDF annotations, which any
 * PDF reader shows: a Highlight for each highlight (its note as the contents),
 * or a note icon where a note has no highlight color. Resolved notes are left
 * out. `pdf` itself is not changed.
 */
export function addHighlightAnnotations(
  mupdf: Mupdf,
  pdf: Uint8Array,
  marks: PdfMark[],
): Uint8Array {
  const doc = mupdf.Document.openDocument(
    pdf.slice(),
    "application/pdf",
  ) as unknown as PDFDocument;
  for (const mark of marks) {
    if (mark.resolved || mark.rects.length === 0) continue;
    if (mark.color === "none" && mark.comments.length === 0) continue;
    const page = doc.loadPage(mark.pageIndex) as PDFPage;
    if (mark.color !== "none") {
      const highlight = page.createAnnotation("Highlight");
      highlight.setColor([...RGB[mark.color]]);
      highlight.setQuadPoints(
        mark.rects.map(({ x, y, w, h }) => [
          x,
          y,
          x + w,
          y,
          x,
          y + h,
          x + w,
          y + h,
        ]),
      );
      if (mark.comments.length > 0) highlight.setContents(threadText(mark));
      highlight.update();
    } else {
      const last = mark.rects[mark.rects.length - 1];
      const note = page.createAnnotation("Text");
      note.setRect([
        last.x + last.w,
        last.y,
        last.x + last.w + 16,
        last.y + 16,
      ]);
      note.setContents(threadText(mark));
      note.update();
    }
  }
  return doc.saveToBuffer("compress").asUint8Array();
}
