import type { StructuredTextData, StructuredTextLine } from "./types";

const DEFAULT_FONT = {
  name: "",
  family: "",
  size: 12,
  weight: "normal",
  style: "normal",
};

function lineFrom(line: any): StructuredTextLine {
  const bbox = line.bbox || { x: 0, y: 0, w: 0, h: 0 };
  const fallbackBaseline = (bbox.y || 0) + (bbox.h || 0);

  // mupdf.js 1.x: each line carries its text, font and baseline directly.
  if (typeof line.text === "string") {
    return {
      bbox,
      wmode: line.wmode || 0,
      x: typeof line.x === "number" ? line.x : bbox.x || 0,
      y: typeof line.y === "number" ? line.y : fallbackBaseline,
      text: line.text,
      font: { ...DEFAULT_FONT, ...(line.font || {}) },
    };
  }

  // Older output: spans of characters, each with its origin.
  const spans = line.spans || [];
  const first = spans[0];
  return {
    bbox,
    wmode: line.wmode || 0,
    x: bbox.x || 0,
    y: first?.chars?.[0]?.origin?.y ?? fallbackBaseline,
    text: spans
      .map((span: any) => (span.chars || []).map((ch: any) => ch.c).join(""))
      .join(""),
    font: first
      ? {
          name: first.font?.name || "",
          family: first.font?.family || "",
          size: first.size || first.font?.size || 12,
          weight: first.font?.weight || "normal",
          style: first.font?.style || "normal",
        }
      : DEFAULT_FONT,
  };
}

/**
 * Each line's character edges, from mupdf's walk of the same structured
 * text, set on the lines (in the same order) whose text they match.
 */
export function withCharEdges(
  data: StructuredTextData,
  walked: [number, number][][],
): StructuredTextData {
  const lines = data.blocks.flatMap((b) => (b.type === "text" ? b.lines : []));
  if (lines.length !== walked.length) return data;
  lines.forEach((line, i) => {
    if (walked[i].length === line.text.length) line.chars = walked[i];
  });
  return data;
}

/**
 * mupdf's structured-text JSON as the flat lines the text layer draws. The
 * text layer is what makes a PDF's words selectable and copyable.
 */
export function toTextLayer(raw: any): StructuredTextData {
  const blocks = (raw?.blocks || []).map((block: any) =>
    block.type !== "text"
      ? block
      : {
          type: "text",
          bbox: block.bbox,
          lines: (block.lines || []).map(lineFrom),
        },
  );
  return { blocks };
}
