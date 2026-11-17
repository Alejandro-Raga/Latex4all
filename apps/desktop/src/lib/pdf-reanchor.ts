/**
 * Highlights on a PDF that's rebuilt (a project's draft): each found again
 * by the words it covered, near where it was, so it stays on its passage as
 * the text around it moves. One whose words aren't there any more is kept
 * aside ("from earlier versions") rather than left on whatever is now in
 * its place.
 */
import {
  findAllWords,
  type PageChar,
  pageTokens,
  rectsByLine,
} from "@/lib/annotations/pdf-placement";
import type { PdfAnnotationRect } from "@/components/workspace/preview/pdf-viewer";

/** The words of a highlight's text, as the page's are compared. */
export function highlightWords(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Where the highlight was: the middle of its first band, from the top. */
function oldTop(a: PdfAnnotationRect, height: number): number {
  const ys = a.rects.flatMap((r) => [r[1], r[3]]);
  return ys.length ? height - Math.max(...ys) : 0;
}

/** Pages to look on: its own, then outward, nearer first. */
export function searchOrder(page: number, count: number): number[] {
  const out: number[] = [];
  if (count <= 0) return out;
  // A shorter version: from its last page.
  page = Math.max(0, Math.min(page, count - 1));
  if (page >= 0 && page < count) out.push(page);
  for (let d = 1; d < count; d++) {
    if (page + d < count && page + d >= 0) out.push(page + d);
    if (page - d >= 0 && page - d < count) out.push(page - d);
  }
  return out;
}

export interface PageSource {
  count: number;
  /** Page height in points, to turn the page's boxes into a highlight's. */
  height: (page: number) => number;
  chars: (page: number) => Promise<PageChar[]>;
}

/**
 * The highlights placed on this version of the PDF. Found again: moved to
 * their words (the closest occurrence on the nearest page). Not found:
 * marked `stale`. Ones without text to look for stay as they are.
 */
export async function reanchor(
  notes: PdfAnnotationRect[],
  pdf: PageSource,
): Promise<PdfAnnotationRect[]> {
  const cache = new Map<number, ReturnType<typeof pageTokens>>();
  const tokensOf = async (page: number) => {
    let t = cache.get(page);
    if (!t) {
      t = pageTokens(await pdf.chars(page));
      cache.set(page, t);
    }
    return t;
  };
  const out: PdfAnnotationRect[] = [];
  for (const note of notes) {
    const words = highlightWords(note.text ?? "");
    if (words.length === 0) {
      out.push(note);
      continue;
    }
    let placed: PdfAnnotationRect | null = null;
    for (const page of searchOrder(note.pageIndex, pdf.count)) {
      const matches = findAllWords(await tokensOf(page), words);
      if (matches.length === 0) continue;
      const height = pdf.height(page);
      const was = page === note.pageIndex ? oldTop(note, height) : 0;
      // Of several on the page, the one nearest where it was.
      const best = matches
        .map((m) => ({
          m,
          d: Math.abs(
            Math.min(...m.flatMap((t) => t.chars.map((c) => c.y0))) - was,
          ),
        }))
        .sort((a, b) => a.d - b.d)[0].m;
      const rects = rectsByLine(best.flatMap((t) => t.chars)).map(
        (r) =>
          [r.x, height - (r.y + r.h), r.x + r.w, height - r.y] as [
            number,
            number,
            number,
            number,
          ],
      );
      const { stale: _, ...rest } = note;
      placed = { ...rest, pageIndex: page, rects };
      break;
    }
    out.push(placed ?? { ...note, stale: true });
  }
  return out;
}
