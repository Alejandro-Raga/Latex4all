/**
 * Highlights and note threads on a project's text. They're kept beside the
 * files, never in them, so compiling and history see the .tex untouched.
 */

/** The colors a highlight can be given. */
export const ANNOTATION_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

/** `none`: a note whose highlight was taken away; the note stays. */
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number] | "none";

/** What a new highlight or note gets. Picking another color only changes that one. */
export const DEFAULT_ANNOTATION_COLOR: AnnotationColor = "yellow";

export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return (
    value === "none" ||
    (ANNOTATION_COLORS as readonly unknown[]).includes(value)
  );
}

export interface AnnotationComment {
  id: string;
  author: string;
  authorColor: string;
  text: string;
  /** ms since epoch */
  at: number;
  edited?: number;
}

/**
 * A proposed replacement for the annotated text, to accept or reject. Also
 * how text two people changed at once is shown: one version stays in the
 * file, and the other is offered as a suggestion.
 */
export interface AnnotationSuggestion {
  /** "" to delete the text. */
  text: string;
  /** Whose it is; "" if not known. */
  author: string;
  authorColor: string;
  /** ms since epoch */
  at: number;
  /** From two people editing the same text at once, not proposed by hand. */
  conflict?: boolean;
  /** Once accepted or rejected: kept, greyed out, as a record of it. */
  settled?: SuggestionOutcome;
}

export interface SuggestionOutcome {
  accepted: boolean;
  /** Who accepted or rejected it. */
  by: string;
  /** ms since epoch */
  at: number;
  /** The text it would replace, as it was then. */
  original: string;
}

/** Still waiting to be accepted or rejected. */
export function isOpenSuggestion(annotation: Annotation) {
  return Boolean(annotation.suggestion && !annotation.suggestion.settled);
}

/** An annotation as it currently sits in its file. */
export interface Annotation {
  id: string;
  from: number;
  to: number;
  color: AnnotationColor;
  resolved: boolean;
  /** Empty for a plain highlight. */
  comments: AnnotationComment[];
  suggestion?: AnnotationSuggestion;
}

export interface Author {
  name: string;
  color: string;
}

/**
 * Where a project's annotations are kept: in the shared document for a
 * shared project, in `.latex4all/annotations.json` otherwise.
 */
export interface AnnotationSource {
  /** The file's annotations in current offsets; ones whose text is gone are left out. */
  rangesFor(path: string): Annotation[];
  /** Every file's, for the notes bar. */
  listAll(): Array<{ path: string; annotation: Annotation }>;
  add(
    path: string,
    from: number,
    to: number,
    color: AnnotationColor,
    note?: { author: Author; text: string },
  ): string | null;
  setColor(id: string, color: AnnotationColor): void;
  addComment(id: string, author: Author, text: string): void;
  editComment(id: string, commentId: string, text: string): void;
  deleteComment(id: string, commentId: string): void;
  setResolved(id: string, resolved: boolean): void;
  /** Proposes replacing `[from, to)` with `text`. */
  suggest(
    path: string,
    from: number,
    to: number,
    text: string,
    author: Author,
  ): string | null;
  /**
   * Accepts (makes the change) or rejects a suggestion. It stays, resolved,
   * as a record of which it was.
   */
  settleSuggestion(id: string, accept: boolean, author: Author): void;
  remove(id: string): void;
  /** Called when annotations change (not when text moves them). */
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export function newAnnotationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
