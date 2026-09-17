import * as Y from "yjs";
import { layout } from "@/lib/collab/project-doc";
import type { StoredAnnotation } from "./local-annotations";
import {
  type Annotation,
  type AnnotationColor,
  type AnnotationComment,
  type AnnotationSource,
  type Author,
  isAnnotationColor,
  newAnnotationId,
} from "./types";

/**
 * In a shared project's document:
 *
 *   annotations: annId → { fileId, from, to, color, resolved, comments }
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

/** Changes to annotations made on this device. */
export const ANNOTATING = Symbol("annotating");

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
      if (from === null || to === null || from >= to) return;
      result.push({
        id,
        from,
        to,
        color: isAnnotationColor(color) ? color : "yellow",
        resolved: entry.get("resolved") === true,
        comments: readComments(entry),
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
        this.entry(
          file.fileId,
          file.text,
          from,
          to,
          color,
          false,
          note ? [comment(note.author, note.text)] : [],
        ),
      );
    }, ANNOTATING);
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
          this.entry(
            file.fileId,
            file.text,
            item.from,
            item.to,
            item.color,
            item.resolved,
            item.comments,
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

  remove(id: string) {
    this.doc.transact(() => this.map.delete(id), ANNOTATING);
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
    if (entry) this.doc.transact(() => change(entry), ANNOTATING);
  }

  private entry(
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
    // The start sticks to the first highlighted character and the end to
    // the last, so typing just outside a highlight never joins it.
    entry.set(
      "from",
      Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, from, 0),
      ),
    );
    entry.set(
      "to",
      Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, to, -1),
      ),
    );
    entry.set("color", color);
    entry.set("resolved", resolved);
    const list = new Y.Array<AnnotationComment>();
    list.push(comments);
    entry.set("comments", list);
    return entry;
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
