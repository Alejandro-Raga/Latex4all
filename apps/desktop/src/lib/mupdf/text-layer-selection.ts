/**
 * Text selection over the PDF text layer (an SVG of transparent <text> lines,
 * one per line of the page), done by hand.
 *
 * WebKit anchors a selection at the start of the whole SVG when a drag
 * begins anywhere but exactly on a glyph (in the margin, between lines,
 * between words), so a drag that starts just left of a paragraph selects
 * from the top of the page. Here the nearest letter to the pointer is found
 * instead, as a PDF reader does.
 */

import { mergeLineRects, type PdfRect } from "@/lib/pdf-line-rects";

export interface TextPoint {
  node: Text;
  offset: number;
}

const LINES = ".mupdf-text-layer text";

function lineText(el: SVGTextElement): Text | null {
  const node = el.firstChild;
  return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
}

/**
 * Where character `i` of a line is drawn, in the layer's own units.
 *
 * Each line is squeezed or stretched to the printed line's width with
 * textLength, but WebKit reports letters where they'd be unstretched, so
 * that is applied here. Down the page, the line's box from the PDF is used:
 * the stand-in font's own height sits a little off the printed line.
 */
/** A line's printed character edges (data-chars), parsed once. */
const edgesCache = new WeakMap<SVGTextElement, [number, number][] | null>();
function printedEdges(el: SVGTextElement): [number, number][] | null {
  if (edgesCache.has(el)) return edgesCache.get(el) ?? null;
  const raw = el.dataset.chars;
  const edges = raw
    ? raw.split(",").map((pair) => {
        const [a, b] = pair.split(" ").map(Number);
        return [a, b] as [number, number];
      })
    : null;
  edgesCache.set(el, edges);
  return edges;
}

function charExtent(el: SVGTextElement, i: number): DOMRect {
  const b = el.getExtentOfChar(i);
  // Where the page itself prints the letter, when known: exact even where
  // a scan's words are spaced unevenly.
  const printed = printedEdges(el)?.[i];
  if (printed) {
    b.x = printed[0];
    b.width = Math.max(printed[1] - printed[0], 0);
    const top = Number(el.dataset.top);
    const height = Number(el.dataset.height);
    if (Number.isFinite(top) && height > 0) {
      b.y = top;
      b.height = height;
    }
    return b;
  }
  const length = Number(el.getAttribute("textLength"));
  const natural = el.getComputedTextLength();
  if (length > 0 && natural > 0 && Math.abs(length - natural) > 0.5) {
    const x0 = Number(el.getAttribute("x")) || 0;
    const f = length / natural;
    b.x = x0 + (b.x - x0) * f;
    b.width *= f;
  }
  const top = Number(el.dataset.top);
  const height = Number(el.dataset.height);
  if (Number.isFinite(top) && height > 0) {
    b.y = top;
    b.height = height;
  }
  return b;
}

/** Client-space box of characters [from, to) of a line. */
function charsBox(
  el: SVGTextElement,
  from: number,
  to: number,
): DOMRect | null {
  const m = el.getScreenCTM();
  if (!m || to <= from) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const i of [from, to - 1]) {
    const b = charExtent(el, i);
    for (const [x, y] of [
      [b.x, b.y],
      [b.x + b.width, b.y + b.height],
    ]) {
      const p = new DOMPoint(x, y).matrixTransform(m);
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
  }
  return new DOMRect(x1, y1, x2 - x1, y2 - y1);
}

/** The page under a point, or failing that the one nearest to it vertically. */
function pageAt(container: HTMLElement, x: number, y: number): Element | null {
  const pages = container.querySelectorAll(".mupdf-page");
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const page of pages) {
    const r = page.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom && x >= r.left - 200 && x <= r.right + 200)
      return page;
    const d = y < r.top ? r.top - y : y - r.bottom;
    if (d < bestDist) {
      bestDist = d;
      best = page;
    }
  }
  return best;
}

/** The text position nearest to a point, on the page under it. */
export function caretNear(
  container: HTMLElement,
  x: number,
  y: number,
): TextPoint | null {
  const page = pageAt(container, x, y);
  if (!page) return null;
  let best: SVGTextElement | null = null;
  let bestScore = Infinity;
  for (const el of page.querySelectorAll<SVGTextElement>(LINES)) {
    if (!lineText(el) || el.getNumberOfChars() === 0) continue;
    const r = el.getBoundingClientRect();
    // Lines level with the pointer win; among them, the nearest sideways.
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const score = dy * 1000 + dx;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return null;
  const node = lineText(best) as Text;
  const m = best.getScreenCTM();
  if (!m) return { node, offset: 0 };
  const local = new DOMPoint(x, y).matrixTransform(m.inverse());
  const n = best.getNumberOfChars();
  for (let i = 0; i < n; i++) {
    const b = charExtent(best, i);
    if (local.x < b.x + b.width) {
      // Left or right half of the letter: before it or after it.
      return {
        node,
        offset: Math.min(node.length, local.x < b.x + b.width / 2 ? i : i + 1),
      };
    }
  }
  return { node, offset: node.length };
}

/**
 * One client-space rectangle per selected line, covering just the selected
 * letters (not the whole line, as the browser reports for SVG text).
 */
export function selectionLineRects(range: Range): DOMRect[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  const scope =
    root?.closest(".mupdf-text-layer") ??
    root?.closest("[data-local-zoom-shortcuts]") ??
    root;
  if (!scope) return [];
  const rects: DOMRect[] = [];
  const lines = scope.matches?.("text")
    ? [scope as SVGTextElement]
    : [...scope.querySelectorAll<SVGTextElement>(LINES)];
  for (const el of lines) {
    const node = lineText(el);
    if (!node || !range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    // Blank stretches (empty lines in the layer) aren't drawn as slivers.
    if (!node.data.slice(from, to).trim()) continue;
    const n = Math.min(to, el.getNumberOfChars());
    const box = charsBox(el, Math.min(from, n), n);
    if (box && box.width > 0.5) rects.push(box);
  }
  // One band per line, as highlights are drawn: a scanned page's text comes
  // a word at a time, and its gaps would show.
  return mergeLineRects(
    rects.map((r) => [r.left, r.top, r.right, r.bottom] as PdfRect),
  )
    .map(([x1, y1, x2, y2]) => new DOMRect(x1, y1, x2 - x1, y2 - y1))
    .sort((a, b) => a.top - b.top || a.left - b.left);
}
