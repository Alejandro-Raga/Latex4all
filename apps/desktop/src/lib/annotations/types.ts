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

/** An annotation as it currently sits in its file. */
export interface Annotation {
  id: string;
  from: number;
  to: number;
  color: AnnotationColor;
  resolved: boolean;
  /** Empty for a plain highlight. */
  comments: AnnotationComment[];
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
  remove(id: string): void;
  /** Called when annotations change (not when text moves them). */
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export function newAnnotationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
