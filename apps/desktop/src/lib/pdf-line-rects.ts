/** A rectangle on a PDF page: [x1, y1, x2, y2], in PDF points. */
export type PdfRect = [number, number, number, number];

/**
 * A highlight's rectangles as Zotero draws them: one band per line. A
 * selection (most of all in a scanned PDF) comes as a piece per word or
 * run of text, with gaps between; pieces on the same line join, unless far
 * apart (another column).
 */
export function mergeLineRects(rects: PdfRect[]): PdfRect[] {
  const norm = rects.map(
    ([a, b, c, d]) =>
      [
        Math.min(a, c),
        Math.min(b, d),
        Math.max(a, c),
        Math.max(b, d),
      ] as PdfRect,
  );
  const sameLine = (o: PdfRect, r: PdfRect) => {
    const overlap = Math.min(o[3], r[3]) - Math.max(o[1], r[1]);
    const minHeight = Math.min(o[3] - o[1], r[3] - r[1]) || 1;
    const gap = Math.max(r[0] - o[2], o[0] - r[2]);
    const maxHeight = Math.max(o[3] - o[1], r[3] - r[1]);
    return overlap >= minHeight * 0.5 && gap <= maxHeight * 1.5;
  };
  // Join pairs until nothing joins any more (order doesn't matter then).
  const out = [...norm];
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < out.length && !joined; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!sameLine(out[i], out[j])) continue;
        const [a, b] = [out[i], out[j]];
        out[i] = [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[2], b[2]),
          Math.max(a[3], b[3]),
        ];
        out.splice(j, 1);
        joined = true;
        break;
      }
    }
  }
  // Top to bottom (PDF y grows upwards), then left to right.
  return out.sort((p, q) => q[3] - p[3] || p[0] - q[0]);
}
