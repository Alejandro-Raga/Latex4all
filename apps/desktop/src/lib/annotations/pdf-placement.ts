import { sanitizeForGrammarCheck } from "@/components/workspace/editor/latex-grammar-sanitize";
import type { AnnotationColor, AnnotationComment } from "./types";

/**
 * Putting highlights on the compiled PDF.
 *
 * SyncTeX says roughly where a source line was typeset (which page, which
 * band of it). Within that band, the highlighted words are looked for among
 * the page's own characters, so the mark covers the words themselves and not
 * the whole line. If the words can't be found — math, a figure, a macro that
 * expands to something else — the SyncTeX boxes are used as they are.
 */

/** A rectangle on a page, in PDF points from its top-left corner. */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A character on a rendered page, and which text line it's on. */
export interface PageChar {
  c: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  line: number;
}

/** Where SyncTeX says part of a source line went. */
export interface SourceBox {
  line: number;
  /** 1-based */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A highlight or note as drawn on (or written into) the PDF. */
export interface PdfMark {
  id: string;
  pageIndex: number;
  rects: PdfRect[];
  color: AnnotationColor;
  resolved: boolean;
  comments: AnnotationComment[];
}

const WORD = /[\p{L}\p{N}]/u;
const HYPHENS = new Set(["-", "\u2010", "\u00ad"]);
/** How far above and below the SyncTeX boxes to still look for the words. */
const BAND_MARGIN = 3;
/** The rough height of a line, for SyncTeX points that have no size. */
const POINT_LINE_HEIGHT = 10;

function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase();
}

/** The words of a piece of LaTeX source, without its commands. */
export function snippetWords(snippet: string): string[] {
  return (
    normalize(sanitizeForGrammarCheck(snippet)).match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

interface Token {
  text: string;
  chars: PageChar[];
}

/**
 * The words on the page, in reading order. A word broken with a hyphen at the
 * end of a line is joined back into one.
 */
function pageTokens(chars: PageChar[]): Token[] {
  const tokens: Token[] = [];
  let current: Token | null = null;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const next = chars[i + 1];
    const brokenWord =
      HYPHENS.has(char.c) &&
      current !== null &&
      next !== undefined &&
      next.line !== char.line &&
      WORD.test(next.c);
    if (brokenWord) continue;
    const text = normalize(char.c);
    if (WORD.test(text)) {
      const continues =
        current !== null &&
        (current.chars[current.chars.length - 1].line === char.line ||
          HYPHENS.has(chars[i - 1]?.c ?? ""));
      if (!continues || current === null) {
        current = { text: "", chars: [] };
        tokens.push(current);
      }
      current.text += text;
      current.chars.push(char);
    } else {
      current = null;
    }
  }
  return tokens;
}

/** Where `words` appear in order: the tokens covering them, or null. */
function findWords(tokens: Token[], words: string[]): Token[] | null {
  const last = words.length - 1;
  for (let start = 0; start + last < tokens.length; start++) {
    let matched = true;
    for (let k = 0; k <= last && matched; k++) {
      const token = tokens[start + k].text;
      const word = words[k];
      if (last === 0) matched = token.includes(word);
      // A highlight can begin or end partway through a word.
      else if (k === 0) matched = token.endsWith(word);
      else if (k === last) matched = token.startsWith(word);
      else matched = token === word;
    }
    if (matched) return tokens.slice(start, start + words.length);
  }
  return null;
}

/** One rectangle per text line the characters are on. */
function rectsByLine(chars: PageChar[]): PdfRect[] {
  const lines = new Map<number, PdfRect>();
  for (const char of chars) {
    const rect = lines.get(char.line);
    if (!rect) {
      lines.set(char.line, {
        x: char.x0,
        y: char.y0,
        w: char.x1 - char.x0,
        h: char.y1 - char.y0,
      });
      continue;
    }
    const x0 = Math.min(rect.x, char.x0);
    const y0 = Math.min(rect.y, char.y0);
    const x1 = Math.max(rect.x + rect.w, char.x1);
    const y1 = Math.max(rect.y + rect.h, char.y1);
    Object.assign(rect, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return [...lines.values()];
}

/**
 * Where a highlighted piece of source appears on the PDF, page by page.
 * `boxes` are the SyncTeX boxes of the source lines it spans; `charsByPage`
 * holds the characters of those pages (0-based).
 */
export function placeHighlight(
  snippet: string,
  boxes: SourceBox[],
  charsByPage: Map<number, PageChar[]>,
): Array<{ pageIndex: number; rects: PdfRect[] }> {
  const words = snippetWords(snippet);
  const pages = new Map<number, SourceBox[]>();
  for (const box of boxes) {
    const list = pages.get(box.page - 1) ?? [];
    list.push(box);
    pages.set(box.page - 1, list);
  }

  const matched: Array<{ pageIndex: number; rects: PdfRect[] }> = [];
  const approximate: Array<{ pageIndex: number; rects: PdfRect[] }> = [];
  for (const [pageIndex, pageBoxes] of pages) {
    const top = Math.min(
      ...pageBoxes.map((b) => (b.height > 0 ? b.y : b.y - POINT_LINE_HEIGHT)),
    );
    const bottom = Math.max(
      ...pageBoxes.map((b) => (b.height > 0 ? b.y + b.height : b.y)),
    );
    const inBand = (charsByPage.get(pageIndex) ?? []).filter((char) => {
      const middle = (char.y0 + char.y1) / 2;
      return middle >= top - BAND_MARGIN && middle <= bottom + BAND_MARGIN;
    });

    const found =
      words.length > 0 ? findWords(pageTokens(inBand), words) : null;
    if (found) {
      matched.push({
        pageIndex,
        rects: rectsByLine(found.flatMap((t) => t.chars)),
      });
      continue;
    }
    const sized = pageBoxes
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }));
    if (sized.length > 0) approximate.push({ pageIndex, rects: sized });
  }
  // Where the words were found, the rough boxes elsewhere would only draw the
  // same highlight a second time.
  return matched.length > 0 ? matched : approximate;
}

/** 1-based line of an offset. */
export function lineAt(text: string, offset: number) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}
