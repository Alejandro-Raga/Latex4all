import type * as Y from "yjs";
import {
  LOCAL,
  type SharedFile,
  addBlobFile,
  addTextFile,
  applyTextChange,
  filesMap,
  layout,
  textHash,
} from "./project-doc";

/** A file in the open project, as the sync sees it. */
export interface LocalFile {
  path: string;
  /** "text" if its content is loaded and editable, otherwise "blob". */
  kind: "text" | "blob";
  content?: string;
  size: number;
  /** Has edits not yet saved to disk. */
  dirty: boolean;
  /** False for files that exist but aren't shared, like compiled PDFs. */
  shareable?: boolean;
}

/** The open project's files, and the ways the sync may change them. */
export interface Workspace {
  /** False once this project is no longer the one open: whatever `files`
   *  says then is about some other state, and nothing may be read into it. */
  available(): boolean;
  /** An unchanged file should come back as the same object, which is how
   *  typing in one file avoids re-reading every other. */
  files(): LocalFile[];
  subscribe(listener: () => void): () => void;
  /** Replaces the content of a loaded text file (saved by autosave). */
  setText(path: string, content: string): void;
  writeText(path: string, content: string): Promise<void>;
  upload(path: string): Promise<{ blobId: string; size: number }>;
  download(path: string, blobId: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Re-reads the folder after the sync changed it. */
  refresh(): Promise<void>;
}

/** What this device last had on disk for a shared file. */
export interface KnownFile {
  path: string;
  blobId?: string;
  size?: number;
  /** Of the text as last saved to disk. */
  hash?: string;
}

export type Known = Record<string, KnownFile>;

interface Hooks {
  /** Files were added, removed or moved, so open editors may need to rebind. */
  onLayoutChanged?: () => void;
  onError?: (message: string) => void;
}

function conflictPath(path: string, taken: (path: string) => boolean) {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, extension] =
    dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  let candidate = `${stem} (conflicted copy)${extension}`;
  for (let n = 2; taken(candidate); n++) {
    candidate = `${stem} (conflicted copy ${n})${extension}`;
  }
  return candidate;
}

/**
 * Keeps a project's files and its shared document in step, both ways.
 *
 * `known` is this device's record of which version of each shared file it
 * last had on disk. It is what tells the two sides apart: a file on disk that
 * isn't known was added here; a known file missing from disk was deleted
 * here; a known file missing from the document was deleted by someone else.
 * It's saved with the document, so this still holds across restarts.
 *
 * Text content syncs as it's typed; everything else is settled by
 * `reconcile`, which runs whenever either side's set of files changes.
 */
export class ProjectSync {
  private readonly known: Map<string, KnownFile>;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private seen = new Map<string, LocalFile>();
  private lastFilesSignature = "";
  private lastLayoutSignature = "";
  /** Files that failed to upload; retried once they change. */
  private failedUploads = new Set<string>();
  private cleanup: Array<() => void> = [];

  constructor(
    private readonly doc: Y.Doc,
    private readonly workspace: Workspace,
    known: Known,
    private readonly hooks: Hooks = {},
  ) {
    this.known = new Map(Object.entries(known));
  }

  /**
   * Settles anything that changed while the project was closed, then keeps
   * both sides in step until `stop`.
   */
  async start() {
    await this.run({ opening: true });

    const files = filesMap(this.doc);
    const onDoc = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
      let structural = false;
      const texts = new Set<string>();
      for (const event of events) {
        const [fileId, key] = event.path;
        if (event.target === files) structural = true;
        else if (key === "text" && typeof fileId === "string") {
          texts.add(fileId);
        } else structural = true;
      }
      if (texts.size > 0) this.pullText(texts);
      if (structural) {
        this.checkLayout();
        this.schedule();
      }
    };
    files.observeDeep(onDoc);
    this.cleanup.push(() => files.unobserveDeep(onDoc));

    this.cleanup.push(
      this.workspace.subscribe(() => {
        if (!this.workspace.available()) return;
        this.pushText();
        if (this.filesSignature() !== this.lastFilesSignature) this.schedule();
      }),
    );
  }

  stop() {
    this.stopped = true;
    for (const fn of this.cleanup.splice(0)) fn();
  }

  /** Resolves once nothing is left to settle. */
  async idle() {
    while (this.running) await this.running;
  }

  knownFiles(): Known {
    return Object.fromEntries(this.known);
  }

  /** The shared text for a path on disk, if it has one. */
  textAt(path: string): { fileId: string; text: Y.Text } | null {
    const file = layout(this.doc).get(path);
    return file?.kind === "text"
      ? { fileId: file.fileId, text: file.text }
      : null;
  }

  private schedule() {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.run();
  }

  private run(options: { opening?: boolean } = {}) {
    this.running = (async () => {
      let opening = options.opening ?? false;
      do {
        this.again = false;
        try {
          await this.reconcile(opening);
        } catch (err) {
          this.hooks.onError?.(
            err instanceof Error ? err.message : String(err),
          );
        }
        opening = false;
      } while (this.again && !this.stopped);
      this.running = null;
    })();
    return this.running;
  }

  private filesSignature() {
    return this.workspace
      .files()
      .map((f) => `${f.path}|${f.kind}|${f.size}|${f.dirty}`)
      .sort()
      .join("\n");
  }

  private checkLayout() {
    const signature = [...layout(this.doc).values()]
      .map((f) => `${f.path}|${f.fileId}`)
      .sort()
      .join("\n");
    if (signature !== this.lastLayoutSignature) {
      this.lastLayoutSignature = signature;
      this.hooks.onLayoutChanged?.();
    }
  }

  private localFiles() {
    return new Map(this.workspace.files().map((f) => [f.path, f]));
  }

  private entry(fileId: string) {
    return filesMap(this.doc).get(fileId);
  }

  /** Someone else's typing, into the open project. */
  private pullText(fileIds: Set<string>) {
    const local = this.localFiles();
    for (const file of layout(this.doc).values()) {
      if (file.kind !== "text" || !fileIds.has(file.fileId)) continue;
      const mine = local.get(file.path);
      if (mine?.kind !== "text" || mine.content === undefined) continue;
      const text = file.text.toString();
      if (text !== mine.content) this.workspace.setText(file.path, text);
    }
  }

  /** Changes to files' text made here — Claude, Zotero, reloads from disk. */
  private pushText() {
    let placed: Map<string, SharedFile> | null = null;
    for (const file of this.workspace.files()) {
      if (this.seen.get(file.path) === file) continue;
      this.seen.set(file.path, file);
      if (file.kind !== "text" || file.content === undefined) continue;
      placed ??= layout(this.doc);
      const shared = placed.get(file.path);
      if (shared?.kind !== "text" || !this.known.has(shared.fileId)) continue;
      if (shared.text.toString() === file.content) continue;
      const content = file.content;
      this.doc.transact(() => applyTextChange(shared.text, content), LOCAL);
    }
  }

  private async reconcile(opening: boolean) {
    if (this.stopped || !this.workspace.available()) return;
    const placed = layout(this.doc);
    const byId = new Map([...placed.values()].map((f) => [f.fileId, f]));
    let local = this.localFiles();
    let wrote = false;
    const guard = async (what: string, action: () => Promise<void>) => {
      try {
        await action();
        wrote = true;
        return true;
      } catch (err) {
        this.hooks.onError?.(
          `${what}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    };
    const setAside = async (path: string) => {
      const aside = conflictPath(path, (p) => local.has(p) || placed.has(p));
      return guard(`Couldn't keep your copy of ${path}`, () =>
        this.workspace.move(path, aside),
      );
    };

    // 1. Bring the files on disk up to date with the document.
    for (const [fileId, known] of [...this.known]) {
      const shared = byId.get(fileId);
      if (!shared) {
        if (local.has(known.path)) {
          await guard(`Couldn't delete ${known.path}`, () =>
            this.workspace.remove(known.path),
          );
        }
        this.known.delete(fileId);
        continue;
      }
      if (shared.path !== known.path && local.has(known.path)) {
        if (local.has(shared.path) && !(await setAside(shared.path))) continue;
        const moved = await guard(`Couldn't move ${known.path}`, () =>
          this.workspace.move(known.path, shared.path),
        );
        if (!moved) continue;
      }
      known.path = shared.path;
      if (shared.kind === "blob" && known.blobId !== shared.blobId) {
        const downloaded = await guard(`Couldn't download ${shared.path}`, () =>
          this.workspace.download(shared.path, shared.blobId),
        );
        if (downloaded) {
          known.blobId = shared.blobId;
          known.size = shared.size;
        }
      }
    }
    for (const shared of placed.values()) {
      if (this.known.has(shared.fileId)) continue;
      const existing = local.get(shared.path);
      const text = shared.kind === "text" ? shared.text.toString() : "";
      const identical =
        existing &&
        (shared.kind === "text"
          ? existing.content === text
          : existing.size === shared.size);
      if (!identical) {
        if (existing && !(await setAside(shared.path))) continue;
        const written = await guard(`Couldn't get ${shared.path}`, () =>
          shared.kind === "text"
            ? this.workspace.writeText(shared.path, text)
            : this.workspace.download(shared.path, shared.blobId),
        );
        if (!written) continue;
      }
      this.known.set(
        shared.fileId,
        shared.kind === "text"
          ? { path: shared.path, hash: textHash(text) }
          : { path: shared.path, blobId: shared.blobId, size: shared.size },
      );
    }
    if (wrote) {
      await this.workspace.refresh();
      local = this.localFiles();
    }
    if (this.stopped || !this.workspace.available()) return;
    // Nothing on disk while files are known means the folder isn't loaded,
    // not that everything was deleted; never pass that on to everyone.
    if (local.size === 0 && this.known.size > 0) return;

    // 2. Bring the document up to date with the files on disk.
    const knownPaths = new Set([...this.known.values()].map((k) => k.path));
    const added = [...local.values()].filter((f) => !knownPaths.has(f.path));
    const missing = [...this.known].filter(([, k]) => !local.has(k.path));
    for (const [fileId, known] of missing) {
      const shared = byId.get(fileId);
      const entry = this.entry(fileId);
      if (!shared || !entry) continue;
      // Gone from one path and present at another with the same content:
      // moved or renamed, not deleted.
      const sharedText = shared.kind === "text" ? shared.text.toString() : null;
      const index = added.findIndex((f) =>
        sharedText !== null
          ? f.kind === "text" && f.content === sharedText
          : f.kind === "blob" && f.size === known.size,
      );
      if (index >= 0) {
        const [moved] = added.splice(index, 1);
        this.doc.transact(() => entry.set("path", moved.path), LOCAL);
        known.path = moved.path;
      } else {
        this.doc.transact(() => filesMap(this.doc).delete(fileId), LOCAL);
        this.known.delete(fileId);
      }
    }
    for (const file of added) {
      if (file.shareable === false) continue;
      if (file.kind === "text" && file.content !== undefined) {
        const content = file.content;
        let fileId = "";
        this.doc.transact(() => {
          fileId = addTextFile(this.doc, file.path, content);
        }, LOCAL);
        this.known.set(fileId, { path: file.path, hash: textHash(content) });
        continue;
      }
      const attempt = `${file.path}|${file.size}`;
      if (this.failedUploads.has(attempt)) continue;
      try {
        const { blobId, size } = await this.workspace.upload(file.path);
        if (this.stopped) return;
        let fileId = "";
        this.doc.transact(() => {
          fileId = addBlobFile(this.doc, file.path, blobId, size);
        }, LOCAL);
        this.known.set(fileId, { path: file.path, blobId, size });
      } catch (err) {
        this.failedUploads.add(attempt);
        this.hooks.onError?.(
          `Couldn't share ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 3. Changes to files already shared.
    for (const [fileId, known] of this.known) {
      const mine = local.get(known.path);
      const shared = byId.get(fileId);
      const entry = this.entry(fileId);
      if (!mine || !shared || !entry) continue;

      if (
        shared.kind === "blob" &&
        mine.kind === "blob" &&
        mine.size !== known.size
      ) {
        const attempt = `${mine.path}|${mine.size}`;
        if (this.failedUploads.has(attempt)) continue;
        try {
          const { blobId, size } = await this.workspace.upload(mine.path);
          if (this.stopped) return;
          this.doc.transact(() => {
            entry.set("blobId", blobId);
            entry.set("size", size);
          }, LOCAL);
          known.blobId = blobId;
          known.size = size;
        } catch (err) {
          this.failedUploads.add(attempt);
          this.hooks.onError?.(
            `Couldn't share ${mine.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        continue;
      }

      if (
        shared.kind !== "text" ||
        mine.kind !== "text" ||
        mine.content === undefined
      ) {
        continue;
      }
      const text = shared.text.toString();
      if (opening && mine.content !== text) {
        if (known.hash !== undefined && textHash(mine.content) === known.hash) {
          // The disk simply hadn't caught up with the document when the app
          // last closed; the document is newer.
          this.workspace.setText(known.path, text);
        } else {
          // Edited outside the app while it was closed.
          const content = mine.content;
          this.doc.transact(() => applyTextChange(shared.text, content), LOCAL);
        }
      }
      if (!mine.dirty) known.hash = textHash(mine.content);
    }

    this.lastFilesSignature = this.filesSignature();
    this.checkLayout();
  }
}
