import type { AnnotationSource } from "./types";

/**
 * Takes the highlight off `[from, to)`: plain highlights there go, and notes
 * lose their color but stay, so a discussion isn't thrown away with it.
 */
export function clearHighlights(
  source: AnnotationSource,
  path: string,
  from: number,
  to: number,
) {
  for (const annotation of source.rangesFor(path)) {
    const overlaps =
      from === to
        ? annotation.from <= from && from <= annotation.to
        : annotation.from < to && from < annotation.to;
    if (!overlaps) continue;
    clearHighlight(source, annotation.id, annotation.comments.length > 0);
  }
}

export function clearHighlight(
  source: AnnotationSource,
  id: string,
  hasNote: boolean,
) {
  if (hasNote) source.setColor(id, "none");
  else source.remove(id);
}
