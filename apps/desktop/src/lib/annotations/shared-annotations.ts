import * as Y from "yjs";
import { layout } from "@/lib/collab/project-doc";
import type { StoredAnnotation } from "./local-annotations";
import {
  type Annotation,
  type AnnotationColor,
  type AnnotationComment,
  type AnnotationSuggestion,
  type AnnotationSource,
  type Author,
  isAnnotationColor,
  newAnnotationId,
} from "./types";

/**
 * In a shared project's document:
 *
 *   annotations: annId → { fileId, from, to, color, resolved, comments,
 *                          suggestion? }
 *
 * `from` and `to` are Yjs relative positions in the file's text, so they
 * follow everyone's edits. It's a top-level map rather than one inside each
 * file, because two devices creating that inner map at once would have one
 * silently replace the other. Comments are an array, so replies written at
 * the same time are all kept.
 */
export function annotationsMap(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>("annotations");
}

/** Annotations brought in from elsewhere; not something to undo. */
export const ANNOTATING = Symbol("annotating");

const origins = new Map<string, { annotating: string }>();

/**
 * The origin of changes made on this device to one file's annotations, so
 * that file's undo history takes them, with its typing.
 */
export function annotatingOrigin(fileId: string) {
  let origin = origins.get(fileId);
  if (!origin) {
    origin = { annotating: fileId };
    origins.set(fileId, origin);
  }
  return origin;
}

export function isAnnotating(origin: unknown) {
  return (
    typeof origin === "object" && origin !== null && "annotating" in origin
  );
}

/**
 * Points a file's annotations at text that undo or redo brought back. Undo
 * puts back deleted text as new text; only this device knows the two are
 * the same, so others would see those annotations vanish.
 */
function reanchor(doc: Y.Doc, text: Y.Text, fileId: string) {
  const map = annotationsMap(doc);
  const at = (json: unknown) => {
    if (!json || typeof json !== "object") return null;
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(json),
      doc,
    );
    return absolute && absolute.type === text ? absolute.index : null;
  };
  doc.transact(() => {
    map.forEach((entry) => {
      if (entry.get("fileId") !== fileId) return;
      const from = at(entry.get("from"));
      const to = at(entry.get("to"));
      if (from === null || to === null || from >= to) return;
      const ends = anchors(text, from, to);
      if (JSON.stringify(ends.from) !== JSON.stringify(entry.get("from"))) {
        entry.set("from", ends.from);
      }
      if (JSON.stringify(ends.to) !== JSON.stringify(entry.get("to"))) {
        entry.set("to", ends.to);
      }
    });
  }, ANNOTATING);
}

/**
 * Undo history for one file: its text and its annotations, so undo takes
 * back a highlight, note or accepted suggestion as well as typing, in the
 * order they happened. Only this file's, and only changes made here.
 */
export function fileUndoManager(doc: Y.Doc, text: Y.Text, fileId: string) {
  const origin = annotatingOrigin(fileId);
  const manager = new Y.UndoManager([text, annotationsMap(doc)], {
    trackedOrigins: new Set([null, origin]),
  });
  // An annotation change is a step of its own, never merged with typing
  // just before or after it.
  const separate = (tr: Y.Transaction) => {
    if (tr.origin === origin) manager.stopCapturing();
  };
  // For as long as the document: it's made once per file per session.
  doc.on("beforeTransaction", separate);
  doc.on("afterTransaction", separate);
  manager.on("stack-item-popped", () => reanchor(doc, text, fileId));
  return manager;
}

function readSuggestion(value: unknown): AnnotationSuggestion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { text, author, authorColor, at, conflict, settled } = value as Record<
    string,
    unknown
  >;
  if (typeof text !== "string") return undefined;
  const outcome = settled as Record<string, unknown> | undefined;
  return {
    text,
    author: typeof author === "string" ? author : "",
    authorColor: typeof authorColor === "string" ? authorColor : "",
    at: typeof at === "number" ? at : 0,
    ...(conflict === true ? { conflict: true } : {}),
    ...(outcome && typeof outcome === "object"
      ? {
          settled: {
            accepted: outcome.accepted === true,
            by: typeof outcome.by === "string" ? outcome.by : "",
            at: typeof outcome.at === "number" ? outcome.at : 0,
            original:
              typeof outcome.original === "string" ? outcome.original : "",
          },
        }
      : {}),
  };
}

/**
 * Suggests replacing `[from, to)` of a file's text. Call inside a
 * transaction.
 */
export function addSuggestion(
  doc: Y.Doc,
  fileId: string,
  text: Y.Text,
  from: number,
  to: number,
  suggestion: AnnotationSuggestion,
  comments: AnnotationComment[] = [],
) {
  const entry = newEntry(fileId, text, from, to, "none", false, comments);
  entry.set("suggestion", { ...suggestion });
  const id = newAnnotationId();
  annotationsMap(doc).set(id, entry);
  return id;
}

function readComments(entry: Y.Map<unknown>): AnnotationComment[] {
  const comments = entry.get("comments");
  return comments instanceof Y.Array
    ? (comments.toArray() as AnnotationComment[])
    : [];
}

export class SharedAnnotations implements AnnotationSource {
  private readonly map: Y.Map<Y.Map<unknown>>;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly doc: Y.Doc) {
    this.map = annotationsMap(doc);
    this.map.observeDeep(this.notify);
    // A file appearing, moving or going away changes which annotations show.
    doc.getMap("files").observe(this.notify);
  }

  private textFor(path: string) {
    const file = layout(this.doc).get(path);
    return file?.kind === "text" ? file : null;
  }

  listAll() {
    return [...layout(this.doc).keys()].flatMap((path) =>
      this.rangesFor(path).map((annotation) => ({ path, annotation })),
    );
  }

  rangesFor(path: string): Annotation[] {
    const file = this.textFor(path);
    if (!file) return [];
    const result: Annotation[] = [];
    this.map.forEach((entry, id) => {
      if (entry.get("fileId") !== file.fileId) return;
      const from = this.resolve(entry.get("from"), file.text);
      const to = this.resolve(entry.get("to"), file.text);
      const color = entry.get("color");
      const suggestion = readSuggestion(entry.get("suggestion"));
      if (from === null || to === null || from > to) return;
      // A settled suggestion is kept even where its text is now gone.
      if (from === to && !suggestion?.settled) return;
      result.push({
        id,
        from,
        to,
        color: isAnnotationColor(color) ? color : "yellow",
        resolved: entry.get("resolved") === true,
        comments: readComments(entry),
        suggestion,
      });
    });
    return result;
  }

  add(
    path: string,
    from: number,
    to: number,
    color: AnnotationColor,
    note?: { author: Author; text: string },
  ) {
    const file = this.textFor(path);
    if (!file || from >= to) return null;
    const id = newAnnotationId();
    this.doc.transact(() => {
      this.map.set(
        id,
        newEntry(
          file.fileId,
          file.text,
          from,
          to,
          color,
          false,
          note ? [comment(note.author, note.text)] : [],
        ),
      );
    }, annotatingOrigin(file.fileId));
    return id;
  }

  /** Brings in annotations from before the project was shared. */
  importLocal(items: StoredAnnotation[]) {
    this.doc.transact(() => {
      for (const item of items) {
        const file = this.textFor(item.path);
        if (!file || item.from >= item.to || item.to > file.text.length)
          continue;
        this.map.set(
          item.id,
          withSuggestion(
            newEntry(
              file.fileId,
              file.text,
              item.from,
              item.to,
              item.color,
              item.resolved,
              item.comments,
            ),
            item.suggestion,
          ),
        );
      }
    }, ANNOTATING);
  }

  /** Everything, in the form a project that isn't shared keeps it. */
  exportLocal(
    contentOf: (path: string) => string | undefined,
  ): StoredAnnotation[] {
    const items: StoredAnnotation[] = [];
    for (const path of layout(this.doc).keys()) {
      const content = contentOf(path);
      if (content === undefined) continue;
      for (const a of this.rangesFor(path)) {
        items.push({
          ...a,
          path,
          quote: {
            exact: content.slice(a.from, a.to),
            prefix: content.slice(Math.max(0, a.from - 32), a.from),
            suffix: content.slice(a.to, a.to + 32),
          },
        });
      }
    }
    return items;
  }

  setColor(id: string, color: AnnotationColor) {
    this.edit(id, (entry) => entry.set("color", color));
  }

  addComment(id: string, author: Author, text: string) {
    this.edit(id, (entry) => {
      const comments = entry.get("comments");
      if (comments instanceof Y.Array) comments.push([comment(author, text)]);
    });
  }

  editComment(id: string, commentId: string, text: string) {
    this.edit(id, (entry) => {
      const comments = entry.get("comments");
      if (!(comments instanceof Y.Array)) return;
      const list = comments.toArray() as AnnotationComment[];
      const index = list.findIndex((c) => c.id === commentId);
      if (index < 0) return;
      comments.delete(index, 1);
      comments.insert(index, [{ ...list[index], text, edited: Date.now() }]);
    });
  }

  deleteComment(id: string, commentId: string) {
    this.edit(id, (entry) => {
      const comments = entry.get("comments");
      if (!(comments instanceof Y.Array)) return;
      const index = (comments.toArray() as AnnotationComment[]).findIndex(
        (c) => c.id === commentId,
      );
      if (index >= 0) comments.delete(index, 1);
    });
  }

  setResolved(id: string, resolved: boolean) {
    this.edit(id, (entry) => entry.set("resolved", resolved));
  }

  suggest(
    path: string,
    from: number,
    to: number,
    text: string,
    author: Author,
  ) {
    const file = this.textFor(path);
    if (!file || from >= to) return null;
    let id: string | null = null;
    this.doc.transact(() => {
      id = addSuggestion(this.doc, file.fileId, file.text, from, to, {
        text,
        author: author.name,
        authorColor: author.color,
        at: Date.now(),
      });
    }, annotatingOrigin(file.fileId));
    return id;
  }

  settleSuggestion(id: string, accept: boolean, author: Author) {
    const entry = this.map.get(id);
    const suggestion = readSuggestion(entry?.get("suggestion"));
    if (!entry || !suggestion || suggestion.settled) return;
    const file = [...layout(this.doc).values()].find(
      (f) => f.fileId === entry.get("fileId"),
    );
    this.doc.transact(() => {
      const text = file?.kind === "text" ? file.text : null;
      const from = text && this.resolve(entry.get("from"), text);
      const to = text && this.resolve(entry.get("to"), text);
      const found = text && from != null && to != null && from < to;
      const original = found ? text.toString().slice(from, to) : "";
      if (accept && found) {
        text.delete(from, to - from);
        if (suggestion.text) text.insert(from, suggestion.text);
        // The record stays on the text that replaced what it was about.
        const ends = anchors(text, from, from + suggestion.text.length);
        entry.set("from", ends.from);
        entry.set("to", ends.to);
      }
      entry.set("suggestion", {
        ...suggestion,
        settled: {
          accepted: accept,
          by: author.name,
          at: Date.now(),
          original,
        },
      });
      entry.set("resolved", true);
    }, this.originOf(entry));
  }

  remove(id: string) {
    const entry = this.map.get(id);
    if (entry)
      this.doc.transact(() => this.map.delete(id), this.originOf(entry));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.map.unobserveDeep(this.notify);
    this.doc.getMap("files").unobserve(this.notify);
    this.listeners.clear();
  }

  private notify = () => {
    for (const listener of this.listeners) listener();
  };

  private edit(id: string, change: (entry: Y.Map<unknown>) => void) {
    const entry = this.map.get(id);
    if (entry) this.doc.transact(() => change(entry), this.originOf(entry));
  }

  private originOf(entry: Y.Map<unknown>) {
    return annotatingOrigin(String(entry.get("fileId")));
  }

  private resolve(json: unknown, text: Y.Text): number | null {
    if (!json || typeof json !== "object") return null;
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(json),
      this.doc,
    );
    return absolute && absolute.type === text ? absolute.index : null;
  }
}

function comment(author: Author, text: string): AnnotationComment {
  return {
    id: newAnnotationId(),
    author: author.name,
    authorColor: author.color,
    text,
    at: Date.now(),
  };
}

/**
 * `[from, to)` as positions that follow edits. The start sticks to the first
 * highlighted character and the end to the last, so typing just outside a
 * highlight never joins it.
 */
function anchors(text: Y.Text, from: number, to: number) {
  return {
    from: Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(text, from, 0),
    ),
    to: Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(text, to, -1),
    ),
  };
}

function newEntry(
  fileId: string,
  text: Y.Text,
  from: number,
  to: number,
  color: AnnotationColor,
  resolved: boolean,
  comments: AnnotationComment[],
) {
  const entry = new Y.Map<unknown>();
  entry.set("fileId", fileId);
  const ends = anchors(text, from, to);
  entry.set("from", ends.from);
  entry.set("to", ends.to);
  entry.set("color", color);
  entry.set("resolved", resolved);
  const list = new Y.Array<AnnotationComment>();
  list.push(comments);
  entry.set("comments", list);
  return entry;
}

function withSuggestion(
  entry: Y.Map<unknown>,
  suggestion: AnnotationSuggestion | undefined,
) {
  if (suggestion) entry.set("suggestion", { ...suggestion });
  return entry;
}
