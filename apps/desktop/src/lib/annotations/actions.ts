import type {
  Annotation,
  AnnotationColor,
  AnnotationSource,
  Author,
} from "./types";

/** What can be done from a highlight's card. */
export interface AnnotationActions {
  setColor: (color: AnnotationColor) => void;
  /** Removes a plain highlight; a note keeps its thread and loses the color. */
  clearHighlight: () => void;
  addComment: (text: string) => void;
  editComment: (commentId: string, text: string) => void;
  deleteComment: (commentId: string) => void;
  setResolved: (resolved: boolean) => void;
  settleSuggestion: (accept: boolean) => void;
  remove: () => void;
}

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

/** The card's actions on one annotation, wherever the card is shown. */
export function annotationActions(
  source: AnnotationSource,
  annotation: Annotation,
  author: () => Author,
  onRemoved: () => void,
): AnnotationActions {
  const { id } = annotation;
  return {
    setColor: (color) => source.setColor(id, color),
    clearHighlight: () =>
      clearHighlight(source, id, annotation.comments.length > 0),
    addComment: (text) => source.addComment(id, author(), text),
    editComment: (commentId, text) => source.editComment(id, commentId, text),
    deleteComment: (commentId) => source.deleteComment(id, commentId),
    setResolved: (resolved) => source.setResolved(id, resolved),
    settleSuggestion: (accept) => {
      source.settleSuggestion(id, accept, author());
      if (annotation.comments.length === 0) onRemoved();
    },
    remove: () => {
      source.remove(id);
      onRemoved();
    },
  };
}
