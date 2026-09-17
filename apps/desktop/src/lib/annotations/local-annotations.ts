import {
  type Quote,
  mapPosition,
  quoteOf,
  reanchor,
  textDiff,
} from "./anchoring";
import {
  type Annotation,
  type AnnotationColor,
  type AnnotationComment,
  type AnnotationSource,
  type Author,
  isAnnotationColor,
  newAnnotationId,
} from "./types";

/** One annotation as kept in `.latex4all/annotations.json`. */
export interface StoredAnnotation {
  id: string;
  path: string;
  from: number;
  to: number;
  quote: Quote;
  color: AnnotationColor;
  resolved: boolean;
  comments: AnnotationComment[];
}

/** Reading and writing the JSON file. */
export interface AnnotationFile {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

/** The project's current text, file by file. */
export interface ProjectText {
  contentOf(path: string): string | undefined;
  paths(): string[];
  subscribe(listener: () => void): () => void;
}

const SAVE_DELAY_MS = 800;

function parse(json: string | null): StoredAnnotation[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    const list: unknown[] = Array.isArray(data?.annotations)
      ? data.annotations
      : [];
    return list.filter(
      (a): a is StoredAnnotation =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as StoredAnnotation).id === "string" &&
        typeof (a as StoredAnnotation).path === "string" &&
        Number.isInteger((a as StoredAnnotation).from) &&
        Number.isInteger((a as StoredAnnotation).to) &&
        isAnnotationColor((a as StoredAnnotation).color),
    );
  } catch {
    return [];
  }
}

/** Annotations of a project that isn't shared. */
export class LocalAnnotations implements AnnotationSource {
  /** Annotations whose words couldn't be found are kept, just not shown. */
  private lost = new Set<string>();
  private lastText = new Map<string, string>();
  /** Files that vanished with annotations on them, kept in `lastText` in case
   *  they turn out to have been renamed. */
  private missingPaths = new Set<string>();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;

  private constructor(
    private items: StoredAnnotation[],
    private readonly file: AnnotationFile,
    private readonly text: ProjectText,
  ) {
    for (const item of items) {
      const content = text.contentOf(item.path);
      if (content === undefined) continue;
      const found = reanchor(content, item.from, item.to, item.quote);
      if (found) Object.assign(item, found);
      else this.lost.add(item.id);
    }
    for (const path of text.paths()) {
      const content = text.contentOf(path);
      if (content !== undefined) this.lastText.set(path, content);
    }
    this.unsubscribe = text.subscribe(() => this.followText());
  }

  static async load(file: AnnotationFile, text: ProjectText) {
    return new LocalAnnotations(parse(await file.read()), file, text);
  }

  /** Everything, in stored form, e.g. to move into a shared project. */
  all(): StoredAnnotation[] {
    return this.items.filter((a) => !this.lost.has(a.id));
  }

  rangesFor(path: string): Annotation[] {
    return this.items
      .filter((a) => a.path === path && !this.lost.has(a.id) && a.from < a.to)
      .map(({ id, from, to, color, resolved, comments }) => ({
        id,
        from,
        to,
        color,
        resolved,
        comments: [...comments],
      }));
  }

  add(
    path: string,
    from: number,
    to: number,
    color: AnnotationColor,
    note?: { author: Author; text: string },
  ) {
    const content = this.text.contentOf(path);
    if (content === undefined || from >= to) return null;
    const id = newAnnotationId();
    this.items.push({
      id,
      path,
      from,
      to,
      quote: quoteOf(content, from, to),
      color,
      resolved: false,
      comments: note ? [comment(note.author, note.text)] : [],
    });
    this.changed();
    return id;
  }

  setColor(id: string, color: AnnotationColor) {
    this.update(id, (a) => {
      a.color = color;
    });
  }

  addComment(id: string, author: Author, text: string) {
    this.update(id, (a) => {
      a.comments = [...a.comments, comment(author, text)];
    });
  }

  editComment(id: string, commentId: string, text: string) {
    this.update(id, (a) => {
      a.comments = a.comments.map((c) =>
        c.id === commentId ? { ...c, text, edited: Date.now() } : c,
      );
    });
  }

  deleteComment(id: string, commentId: string) {
    this.update(id, (a) => {
      a.comments = a.comments.filter((c) => c.id !== commentId);
    });
  }

  setResolved(id: string, resolved: boolean) {
    this.update(id, (a) => {
      a.resolved = resolved;
    });
  }

  remove(id: string) {
    this.items = this.items.filter((a) => a.id !== id);
    this.changed();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes pending changes now. */
  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    for (const item of this.items) {
      const content = this.text.contentOf(item.path);
      if (content !== undefined && !this.lost.has(item.id)) {
        item.quote = quoteOf(content, item.from, item.to);
      }
    }
    await this.file.write(
      JSON.stringify({ version: 1, annotations: this.items }, null, 2),
    );
  }

  destroy() {
    this.unsubscribe();
    if (this.saveTimer) void this.flush();
    this.listeners.clear();
  }

  private update(id: string, change: (a: StoredAnnotation) => void) {
    const item = this.items.find((a) => a.id === id);
    if (!item) return;
    change(item);
    this.changed();
  }

  private changed() {
    for (const listener of this.listeners) listener();
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush().catch((err) =>
        console.warn("[annotations] Couldn't save:", err),
      );
    }, SAVE_DELAY_MS);
  }

  /** Moves annotations along with edits, and with files that were renamed. */
  private followText() {
    const current = new Map<string, string>();
    for (const path of this.text.paths()) {
      const content = this.text.contentOf(path);
      if (content !== undefined) current.set(path, content);
    }
    let moved = false;
    const missing = new Set<string>();
    for (const [path, before] of this.lastText) {
      const after = current.get(path);
      const mine = this.items.filter((a) => a.path === path);
      if (mine.length === 0) continue;
      if (after === undefined) {
        // Renamed: the same text under a path that wasn't there before.
        const renamed = [...current].find(
          ([other, content]) =>
            !this.lastText.has(other) &&
            !this.missingPaths.has(other) &&
            content === before,
        );
        if (renamed) {
          for (const a of mine) a.path = renamed[0];
          moved = true;
        } else {
          // Maybe it reappears under a new name in a later step.
          current.set(path, before);
          missing.add(path);
        }
        continue;
      }
      const change = textDiff(before, after);
      if (!change) continue;
      for (const a of mine) {
        a.from = mapPosition(a.from, change, 1);
        a.to = mapPosition(a.to, change, -1);
      }
      moved = true;
    }
    this.lastText = current;
    this.missingPaths = missing;
    if (moved) this.changed();
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
