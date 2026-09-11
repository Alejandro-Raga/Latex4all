// Shapes for the project preview cards on the home screen.
//
// Every card used to be a 3:4 portrait box, so a 16:9 deck was shown as a
// cropped portrait slice of its own title slide. The shape now comes from the
// document: the rendered page's bounds when there is a PDF, and the
// \documentclass line when source is all we have.

// A4, which is what almost every LaTeX document actually is. Used for the
// loading placeholder and as the fallback when a page can't be measured, so
// the card lands at very nearly its final height on the first paint instead of
// starting at some other shape and shoving the title as the preview resolves.
export const PORTRAIT_ASPECT = 1 / Math.SQRT2;

export function pageAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return PORTRAIT_ASPECT;
  }
  if (width <= 0 || height <= 0) return PORTRAIT_ASPECT;
  return width / height;
}

// beamer's aspectratio option is the ratio with the decimal point removed, so
// 169 is 16:9 and 1610 is 16:10. Its default is 4:3 (128mm x 96mm), not 16:9 -
// an unqualified \documentclass{beamer} really is the squarer shape.
const BEAMER_ASPECT_RATIOS: Record<string, number> = {
  "169": 16 / 9,
  "1610": 16 / 10,
  "149": 14 / 9,
  "141": 1.41,
  "54": 5 / 4,
  "43": 4 / 3,
  "32": 3 / 2,
};

export function texSourceAspectRatio(content: string): number {
  // Line-wise rather than one regex over the whole file, so a commented-out
  // \documentclass doesn't win over the real one.
  const declaration = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("\\documentclass"));
  if (!declaration) return PORTRAIT_ASPECT;

  const match = declaration.match(
    /^\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/,
  );
  if (!match) return PORTRAIT_ASPECT;

  const options = (match[1] ?? "").split(",").map((option) => option.trim());

  if (match[2].trim() === "beamer") {
    const option = options.find((o) => o.startsWith("aspectratio="));
    const key = option?.slice("aspectratio=".length).trim();
    return (key ? BEAMER_ASPECT_RATIOS[key] : undefined) ?? 4 / 3;
  }

  // A landscape article is the same page turned on its side.
  if (options.includes("landscape")) return 1 / PORTRAIT_ASPECT;

  return PORTRAIT_ASPECT;
}

/**
 * The card's own shape, which is uniform across the grid. Near enough to A4
 * that an ordinary document fills it edge to edge, so documents look exactly
 * as they did before pages were measured at all.
 */
export const CARD_ASPECT = 3 / 4;

/**
 * Which edge of the card a page should be pinned to so it fits without being
 * cropped: a page taller than the card is limited by height, a wider one by
 * width.
 *
 * This is deliberately a branch rather than `max-width`/`max-height` on an
 * aspect-ratio box. WKWebView will not shrink an aspect-ratio box's width to
 * honour a max-height, so the natural-looking version of this overflows the
 * card and runs over the title beneath it — which is exactly the bug that
 * shipped in 1.0.17.
 */
export function pageFit(
  aspectRatio: number,
  cardAspectRatio: number = CARD_ASPECT,
): "height" | "width" {
  return aspectRatio < cardAspectRatio ? "height" : "width";
}
