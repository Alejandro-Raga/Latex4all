import type * as Y from "yjs";
import {
  LOCAL,
  REMOTE,
  type SharedFile,
  addBlobFile,
  addTextFile,
  applyTextChange,
  filesMap,
  layout,
  textHash,
} from "./project-doc";
import type { Author } from "@/lib/annotations/types";
import { noteDifferences } from "./concurrent-edits";
import { identityOf, isDifferentDocument } from "./document-identity";
import { isUnder, rejoined, neverShared } from "./sync-choices";

/**
 * Each LaTeX file's identity (class and title, see document-identity) as
 * the project's owner last had it, by file id: what tells a damaged file
 * from the right one on every computer.
 */
export function identitiesMap(doc: Y.Doc) {
  return doc.getMap<string>("identities");
}

/**
 * Paths compared as one: an accented name can be stored two ways (macOS
 * often decomposes "ó" into "o" and an accent, Windows doesn't), and the
 * same file must never look like two, one of them "deleted".
 */
const same = (path: string) => path.normalize("NFC");

class PathMap<V> extends Map<string, V> {
  override get(path: string) {
    return super.get(same(path));
  }
  override has(path: string) {
    return super.has(same(path));
  }
  override set(path: string, value: V) {
    return super.set(same(path), value);
  }
  override delete(path: string) {
    return super.delete(same(path));
  }
}

function byPath<V>(entries: Iterable<[string, V]>): PathMap<V> {
  const map = new PathMap<V>();
  for (const [k, v] of entries) map.set(k, v);
  return map;
}

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
  /** There, but couldn't be read just now (another program has it open):
   * nothing is synced until it can be, so it's never taken for emptied or
   * deleted. */
  unreadable?: boolean;
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
  /** A file went through after all (sent or received): its warning goes. */
  onSynced?: (path: string) => void;
  /**
   * Who's here, to sign differences between a file here and the shared one
   * met for the first time: with it, they're kept as conflict notes in the
   * file rather than as a "(conflicted copy)".
   */
  me?: () => Author;
  /** Where such differences were noted. */
  onDifferences?: (found: Array<{ path: string; from: number }>) => void;
  /**
   * Whether this computer is the project's owner: the one that shared it,
   * or added it to the library. Exactly one computer is. When a file's
   * shared copy and the one here are different documents, the owner's is
   * put back in the shared copy; anywhere else, neither is written.
   */
  owner?: () => boolean;
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
  /**
   * Uploads that failed, by path and size: when to try again. A file too
   * large or a full project stay failed until the file changes; anything
   * else (the relay or the connection briefly down) is tried again later,
   * waiting longer each time.
   */
  /** Since when many known files have been missing (see reconcile). */
  private manyMissingSince: number | null = null;
  private failedUploads = new Map<string, { retryAt: number; wait: number }>();
  /**
   * Images and other binary files left to download when opening: fetched
   * after, so what others wrote is applied without waiting on them.
   */
  private blobsLater = false;
  private cleanup: Array<() => void> = [];
  /**
   * Files and folders this computer leaves out (sync-choices.ts): nothing
   * about them is sent or taken, both ways.
   */
  private notSynced: string[];
  /**
   * Left out until just now. Their copy here was kept up to date some other
   * way meanwhile, so where it differs from the shared one, it's the one
   * kept, instead of being set aside as a conflicted copy.
   */
  private comingBack: string[] = [];
  /**
   * Each LaTeX file's text as last seen, by file id: what a change from
   * another computer is compared with (the editor may already show it).
   */
  private lastText = new Map<string, string>();
  /**
   * Files whose shared copy is a different document, refused here: held at
   * the version here until the right one comes back (the owner puts it
   * back), so no later change to the other document reaches this file.
   */
  private held = new Set<string>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly workspace: Workspace,
    known: Known,
    private readonly hooks: Hooks = {},
    notSynced: readonly string[] = [],
  ) {
    this.known = new Map(Object.entries(known));
    this.notSynced = [...notSynced];
  }

  /** Changes which files this computer leaves out of the sync. */
  setNotSynced(paths: readonly string[]) {
    const back = rejoined(this.notSynced, paths);
    this.comingBack = [...new Set([...this.comingBack, ...back])];
    this.notSynced = [...paths];
    this.lastLayoutSignature = "";
    this.checkLayout();
    this.schedule();
  }

  /** Whether this computer leaves `path` out of the sync. */
  isNotSynced(path: string) {
    return neverShared(path) || isUnder(path, this.notSynced);
  }

  /**
   * Settles anything that changed while the project was closed, then keeps
   * both sides in step until `stop`.
   */
  async start() {
    await this.run({ opening: true });
    // Now the downloads put off while opening, in the background.
    if (this.blobsLater) {
      this.blobsLater = false;
      this.schedule();
    }

    const files = filesMap(this.doc);
    this.rememberTexts();
    const onDoc = (
      events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
      transaction: Y.Transaction,
    ) => {
      let structural = false;
      const texts = new Set<string>();
      for (const event of events) {
        const [fileId, key] = event.path;
        if (event.target === files) structural = true;
        else if (key === "text" && typeof fileId === "string") {
          texts.add(fileId);
        } else structural = true;
      }
      if (texts.size > 0) {
        if (transaction.origin === REMOTE) {
          this.pullText(this.checkArrived(texts));
        } else {
          this.rememberTexts(texts);
          this.pullText(texts);
        }
      }
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

  /**
   * Copies a sync made by mistake ("paper (2).pdf", "refs (conflicted
   * copy).bib") that are, byte for byte, the file they copy: removed, here
   * and so for everyone. A copy that differs is someone's version, and
   * stays. Run once everything is in (a binary's id is its content's).
   */
  async dropIdenticalCopies(): Promise<string[]> {
    if (this.stopped || !this.workspace.available()) return [];
    const local = this.localFiles();
    const knownAt = byPath([...this.known.values()].map((k) => [k.path, k]));
    const removed: string[] = [];
    for (const file of local.values()) {
      const m = /^(.*) \((?:\d+|conflicted copy(?: \d+)?)\)(\.[^./]*)?$/.exec(
        file.path,
      );
      // (Copies are never shared, so only what's left out by choice is
      // passed over.)
      if (!m || file.dirty || isUnder(file.path, this.notSynced)) continue;
      const original = local.get(m[1] + (m[2] ?? ""));
      if (!original || original.kind !== file.kind) continue;
      const blobId = knownAt.get(file.path)?.blobId;
      const same =
        file.kind === "text"
          ? file.content !== undefined && file.content === original.content
          : file.size === original.size &&
            blobId !== undefined &&
            blobId === knownAt.get(original.path)?.blobId;
      if (!same) continue;
      try {
        await this.workspace.remove(file.path);
        removed.push(file.path);
      } catch {
        // Left for next time.
      }
    }
    if (removed.length) {
      await this.workspace.refresh();
      this.schedule();
    }
    return removed;
  }

  knownFiles(): Known {
    return Object.fromEntries(this.known);
  }

  /** The shared text for a path on disk, if it has one. */
  textAt(path: string): { fileId: string; text: Y.Text } | null {
    // Left out here: edited as a file of this computer's own.
    if (this.isNotSynced(path)) return null;
    const file = byPath(layout(this.doc)).get(path);
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
    const signature = [...byPath(layout(this.doc)).values()]
      .map((f) => `${f.path}|${f.fileId}`)
      .sort()
      .join("\n");
    if (signature !== this.lastLayoutSignature) {
      this.lastLayoutSignature = signature;
      this.hooks.onLayoutChanged?.();
    }
  }

  private localFiles() {
    return byPath(this.workspace.files().map((f) => [f.path, f]));
  }

  private mayRetry(attempt: string): boolean {
    const failed = this.failedUploads.get(attempt);
    return !failed || Date.now() >= failed.retryAt;
  }

  private uploadFailed(attempt: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const lasting = /too-large|quota/.test(message);
    const wait = Math.min(
      30 * 60e3,
      (this.failedUploads.get(attempt)?.wait ?? 30e3) * 2,
    );
    this.failedUploads.set(attempt, {
      retryAt: lasting ? Number.POSITIVE_INFINITY : Date.now() + wait,
      wait,
    });
    // Nothing else may change meanwhile to set it going again.
    if (!lasting) {
      const timer = setTimeout(() => {
        if (!this.stopped) this.schedule();
      }, wait + 50);
      this.cleanup.push(() => clearTimeout(timer));
    }
  }

  private entry(fileId: string) {
    return filesMap(this.doc).get(fileId);
  }

  /**
   * A file back in the sync whose copy here differs from the shared one:
   * this copy becomes the shared version, for everyone.
   */
  private async keepMine(shared: SharedFile, mine: LocalFile) {
    const entry = this.entry(shared.fileId);
    if (!entry) return true;
    if (shared.kind === "text") {
      if (mine.content === undefined) return false;
      const content = mine.content;
      this.doc.transact(() => applyTextChange(shared.text, content), LOCAL);
      this.known.set(shared.fileId, {
        path: shared.path,
        hash: textHash(content),
      });
      this.hooks.onSynced?.(shared.path);
      return true;
    }
    const attempt = `${mine.path}|${mine.size}`;
    if (!this.mayRetry(attempt)) return false;
    try {
      const { blobId, size } = await this.workspace.upload(mine.path);
      if (this.stopped) return false;
      this.doc.transact(() => {
        entry.set("blobId", blobId);
        entry.set("size", size);
      }, LOCAL);
      this.known.set(shared.fileId, { path: shared.path, blobId, size });
      this.hooks.onSynced?.(shared.path);
      return true;
    } catch (err) {
      this.uploadFailed(attempt, err);
      this.hooks.onError?.(
        `Couldn't share ${mine.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private isOwner() {
    return this.hooks.owner?.() ?? false;
  }

  /** Whether writing `next` over `current` for this file replaces one
   * document with another (see document-identity). */
  private foreign(
    fileId: string,
    next: string,
    current: string,
    /** False for a file here that never came from the shared copy (met for
     * the first time): it may be someone's only copy of their work, so the
     * owner's identity doesn't vouch for writing over it. */
    trustRecorded = true,
  ) {
    return isDifferentDocument(
      next,
      current,
      trustRecorded ? (identitiesMap(this.doc).get(fileId) ?? null) : null,
    );
  }

  /** The text of the shared LaTeX files (all, or these), as it is now. */
  private rememberTexts(only?: Set<string>) {
    for (const file of layout(this.doc).values()) {
      if (file.kind !== "text" || (only && !only.has(file.fileId))) continue;
      if (this.held.has(file.fileId)) continue;
      const text = file.text.toString();
      if (identityOf(text)) this.lastText.set(file.fileId, text);
      else this.lastText.delete(file.fileId);
    }
  }

  /**
   * Changes from other computers, checked as they arrive: one that turns a
   * LaTeX file into a different document (another project's, from a sync
   * gone wrong elsewhere) is undone by the owner, and written nowhere.
   * Returns the files whose change can go to disk.
   */
  private checkArrived(fileIds: Set<string>): Set<string> {
    const kept = new Set<string>();
    for (const file of layout(this.doc).values()) {
      if (file.kind !== "text" || !fileIds.has(file.fileId)) continue;
      const before = this.lastText.get(file.fileId);
      const now = file.text.toString();
      if (before === undefined || !this.foreign(file.fileId, now, before)) {
        if (identityOf(now)) this.lastText.set(file.fileId, now);
        this.held.delete(file.fileId);
        kept.add(file.fileId);
        continue;
      }
      if (this.isOwner()) {
        // After this change is done with, so it isn't changed under itself.
        const { text, path, fileId } = file;
        queueMicrotask(() => {
          if (this.stopped || text.toString() !== now) return;
          this.putBack(text, fileId, before);
          this.hooks.onError?.(
            `${path} came back from another computer as a different document. This computer's version was put back (X03)`,
          );
        });
      } else {
        this.hold(file.fileId, before);
        this.hooks.onError?.(
          `Didn't sync ${file.path}: its shared copy is a different document. Your copy here is untouched (X02)`,
        );
      }
    }
    return kept;
  }

  /** Refuses a file's shared copy here, keeping `mine` as what it's
   * compared with (see `held`). */
  private hold(fileId: string, mine: string) {
    this.held.add(fileId);
    this.lastText.set(fileId, mine);
  }

  /** Someone else's typing, into the open project. */
  private pullText(fileIds: Set<string>) {
    // Another project is open now: nothing of this one goes into it.
    if (this.stopped || !this.workspace.available()) return;
    const local = this.localFiles();
    for (const file of byPath(layout(this.doc)).values()) {
      if (file.kind !== "text" || !fileIds.has(file.fileId)) continue;
      if (this.isNotSynced(file.path) || this.held.has(file.fileId)) continue;
      const mine = local.get(file.path);
      if (mine?.kind !== "text" || mine.content === undefined) continue;
      const text = file.text.toString();
      if (text !== mine.content) this.workspace.setText(mine.path, text);
    }
  }

  /** Changes to files' text made here — Claude, Zotero, reloads from disk. */
  private pushText() {
    if (this.stopped || !this.workspace.available()) return;
    let placed: Map<string, SharedFile> | null = null;
    for (const file of this.workspace.files()) {
      if (this.seen.get(file.path) === file) continue;
      this.seen.set(file.path, file);
      if (file.kind !== "text" || file.content === undefined) continue;
      placed ??= byPath(layout(this.doc));
      const shared = placed.get(file.path);
      if (shared?.kind !== "text" || !this.known.has(shared.fileId)) continue;
      const current = shared.text.toString();
      if (current === file.content) continue;
      // A whole other document arriving in a file here isn't an edit: it
      // isn't sent (only the owner's own copy is taken as it is).
      if (
        !this.isOwner() &&
        this.foreign(shared.fileId, file.content, current)
      ) {
        this.hooks.onError?.(
          `Didn't share ${file.path}: it's a different document from its shared copy (X02)`,
        );
        continue;
      }
      const content = file.content;
      this.doc.transact(() => applyTextChange(shared.text, content), LOCAL);
      if (identityOf(content)) this.lastText.set(shared.fileId, content);
    }
  }

  private async reconcile(opening: boolean) {
    if (this.stopped || !this.workspace.available()) return;
    const placed = byPath(layout(this.doc));
    const byId = new Map([...placed.values()].map((f) => [f.fileId, f]));
    let local = this.localFiles();
    // A file already here keeps the name it has here (its accents stored as
    // this computer has them), so a write never makes a second copy.
    const here = (path: string) => local.get(path)?.path ?? path;
    // A file that can't be read now would look emptied or deleted: this
    // round waits for it.
    const blocked = [...local.values()].find((f) => f.unreadable);
    if (blocked) {
      this.hooks.onError?.(
        `Couldn't read ${blocked.path}: another program has it open`,
      );
      const timer = setTimeout(() => {
        if (!this.stopped) this.schedule();
      }, 30_000);
      this.cleanup.push(() => clearTimeout(timer));
      return;
    }
    let wrote = false;
    // Binary files put off until after opening: left alone this time round,
    // so an old copy on disk isn't taken for a change made here.
    const later = new Set<string>();
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
      // Left out here: no longer followed, so nothing done to it either way
      // (not even a deletion) reaches the other side.
      if (
        this.isNotSynced(known.path) ||
        (shared && this.isNotSynced(shared.path))
      ) {
        this.known.delete(fileId);
        continue;
      }
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
        if (opening) {
          this.blobsLater = true;
          later.add(fileId);
          later.add(same(shared.path));
          continue;
        }
        const downloaded = await guard(`Couldn't download ${shared.path}`, () =>
          this.workspace.download(here(shared.path), shared.blobId),
        );
        if (downloaded) {
          known.blobId = shared.blobId;
          known.size = shared.size;
          this.hooks.onSynced?.(shared.path);
        }
      }
    }
    let stillComingBack = false;
    const noted: Array<{ path: string; from: number }> = [];
    for (const shared of placed.values()) {
      if (this.known.has(shared.fileId)) continue;
      if (this.isNotSynced(shared.path)) continue;
      if (opening && shared.kind === "blob") {
        this.blobsLater = true;
        later.add(shared.path);
        continue;
      }
      const existing = local.get(shared.path);
      const text = shared.kind === "text" ? shared.text.toString() : "";
      const identical =
        existing &&
        (shared.kind === "text"
          ? existing.content === text
          : existing.size === shared.size);
      // A binary's size can't tell two versions apart, so this copy is sent
      // whatever it is (the same bytes come back as the same blob).
      if (
        existing &&
        existing.kind === shared.kind &&
        (!identical || shared.kind === "blob") &&
        isUnder(shared.path, this.comingBack)
      ) {
        const kept = await this.keepMine(shared, existing);
        if (this.stopped) return;
        if (!kept) stillComingBack = true;
        continue;
      }
      // A different document from the one here (another project's): never
      // merged into it, never set beside it. The owner's copy goes back into
      // the shared one; anywhere else both stay as they are.
      if (
        !identical &&
        existing?.kind === "text" &&
        existing.content !== undefined &&
        shared.kind === "text" &&
        this.foreign(shared.fileId, text, existing.content, false)
      ) {
        if (this.isOwner() && !existing.dirty) {
          this.putBack(shared.text, shared.fileId, existing.content);
          this.known.set(shared.fileId, {
            path: shared.path,
            hash: textHash(existing.content),
          });
          this.hooks.onError?.(
            `${shared.path}'s shared copy was a different document. This computer's version was put back (X03)`,
          );
        } else {
          this.hold(shared.fileId, existing.content);
          this.hooks.onError?.(
            `Didn't sync ${shared.path}: its shared copy is a different document. Your copy here is untouched (X02)`,
          );
        }
        continue;
      }
      // Text that differs: the shared version stays, and this one's
      // differences go on it as notes, rather than a whole copy beside it.
      const me = this.hooks.me;
      if (
        !identical &&
        me &&
        existing?.kind === "text" &&
        existing.content !== undefined &&
        !existing.dirty &&
        shared.kind === "text"
      ) {
        const found = noteDifferences(
          this.doc,
          shared.fileId,
          shared.text,
          existing.content,
          me(),
        );
        if (found !== null) {
          const written = await guard(`Couldn't get ${shared.path}`, () =>
            this.workspace.writeText(here(shared.path), text),
          );
          if (!written) continue;
          for (const from of found) noted.push({ path: shared.path, from });
          this.known.set(shared.fileId, {
            path: shared.path,
            hash: textHash(text),
          });
          this.hooks.onSynced?.(shared.path);
          continue;
        }
      }
      if (!identical) {
        if (existing && !(await setAside(shared.path))) continue;
        const written = await guard(`Couldn't get ${shared.path}`, () =>
          shared.kind === "text"
            ? this.workspace.writeText(here(shared.path), text)
            : this.workspace.download(here(shared.path), shared.blobId),
        );
        if (!written) continue;
        this.hooks.onSynced?.(shared.path);
      }
      this.known.set(
        shared.fileId,
        shared.kind === "text"
          ? { path: shared.path, hash: textHash(text) }
          : { path: shared.path, blobId: shared.blobId, size: shared.size },
      );
    }
    if (!stillComingBack) this.comingBack = [];
    if (noted.length) this.hooks.onDifferences?.(noted);
    if (wrote) {
      await this.workspace.refresh();
      local = this.localFiles();
    }
    if (this.stopped || !this.workspace.available()) return;
    // Nothing on disk while files are known means the folder isn't loaded,
    // not that everything was deleted; never pass that on to everyone.
    if (local.size === 0 && this.known.size > 0) return;

    // 2. Bring the document up to date with the files on disk.
    const knownPaths = new Set(
      [...this.known.values()].map((k) => same(k.path)),
    );
    // A file the shared copy already has at that path isn't new here, even
    // if it couldn't be settled this round (a failed write, a different
    // document): it's settled next round. Added again, it made a second
    // file of one name, which every other computer got as a "(conflicted
    // copy)".
    const added = [...local.values()].filter(
      (f) =>
        !knownPaths.has(same(f.path)) &&
        !placed.has(f.path) &&
        !later.has(same(f.path)) &&
        !this.isNotSynced(f.path),
    );
    const missing = [...this.known].filter(([, k]) => !local.has(k.path));
    // Many files gone at once is more likely a folder half loaded (a cloud
    // app catching up, a disk not there yet) than deletions: they're held
    // back, and sent only if still gone ten minutes on.
    const many = missing.length >= 5 && missing.length >= this.known.size / 3;
    if (!many) this.manyMissingSince = null;
    else {
      this.manyMissingSince ??= Date.now();
      if (Date.now() - this.manyMissingSince < 10 * 60e3) {
        this.hooks.onError?.(
          `${missing.length} files are missing from this folder. Their deletion isn't sent yet (R10)`,
        );
        const timer = setTimeout(() => {
          if (!this.stopped) this.schedule();
        }, 60_000);
        this.cleanup.push(() => clearTimeout(timer));
        missing.length = 0;
      }
    }
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
      if (!this.mayRetry(attempt)) continue;
      try {
        const { blobId, size } = await this.workspace.upload(file.path);
        if (this.stopped) return;
        let fileId = "";
        this.doc.transact(() => {
          fileId = addBlobFile(this.doc, file.path, blobId, size);
        }, LOCAL);
        this.known.set(fileId, { path: file.path, blobId, size });
        this.hooks.onSynced?.(file.path);
      } catch (err) {
        this.uploadFailed(attempt, err);
        this.hooks.onError?.(
          `Couldn't share ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 3. Changes to files already shared.
    for (const [fileId, known] of this.known) {
      if (later.has(fileId)) continue;
      const mine = local.get(known.path);
      const shared = byId.get(fileId);
      const entry = this.entry(fileId);
      if (!mine || !shared || !entry) continue;

      if (
        shared.kind === "blob" &&
        mine.kind === "blob" &&
        // 0: its size wasn't read, which isn't a change.
        mine.size > 0 &&
        mine.size !== known.size
      ) {
        const attempt = `${mine.path}|${mine.size}`;
        if (!this.mayRetry(attempt)) continue;
        try {
          const { blobId, size } = await this.workspace.upload(mine.path);
          if (this.stopped) return;
          this.doc.transact(() => {
            entry.set("blobId", blobId);
            entry.set("size", size);
          }, LOCAL);
          known.blobId = blobId;
          known.size = size;
          this.hooks.onSynced?.(mine.path);
        } catch (err) {
          this.uploadFailed(attempt, err);
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
        const content = mine.content;
        const diskUnchanged =
          known.hash !== undefined && textHash(content) === known.hash;
        // The shared copy became another document while this one was away,
        // or this file did: neither is written over the other, except that
        // the owner's copy goes back into the shared one.
        const different = diskUnchanged
          ? this.foreign(fileId, text, content)
          : this.foreign(fileId, content, text);
        if (different && !this.isOwner()) {
          this.hold(fileId, content);
          this.hooks.onError?.(
            `Didn't sync ${known.path}: its shared copy is a different document. Your copy here is untouched (X02)`,
          );
          continue;
        }
        if (diskUnchanged && !different) {
          // The disk simply hadn't caught up with the document when the app
          // last closed; the document is newer.
          this.workspace.setText(mine.path, text);
        } else if (!different) {
          // Edited outside the app while it was closed.
          this.doc.transact(() => applyTextChange(shared.text, content), LOCAL);
        } else {
          // The owner's copy, back over a different document.
          this.putBack(shared.text, fileId, content);
          this.hooks.onError?.(
            `${known.path}'s shared copy was a different document. This computer's version was put back (X03)`,
          );
        }
      }
      if (!mine.dirty) known.hash = textHash(mine.content);
    }

    this.dropNeverShared();
    if (this.isOwner()) this.recordIdentities(local);
    this.rememberTexts();
    this.lastFilesSignature = this.filesSignature();
    this.checkLayout();
  }

  /**
   * Files no computer shares (Git pointers, system clutter, conflict copies,
   * saves cut short), taken out of the shared copy if an earlier version
   * put them there. Each computer's own copy stays where it is: a path
   * never shared is never deleted for it (see step 1).
   */
  private dropNeverShared() {
    const files = filesMap(this.doc);
    const junk = [...files.entries()]
      .filter(([, entry]) => {
        const path = entry.get("path");
        return typeof path === "string" && neverShared(path);
      })
      .map(([fileId]) => fileId);
    if (junk.length === 0) return;
    this.doc.transact(() => {
      for (const fileId of junk) {
        files.delete(fileId);
        this.known.delete(fileId);
      }
    }, LOCAL);
  }

  /**
   * Puts the owner's version of a file back over a different document in
   * the shared copy, with its identity in the same change: the others then
   * take it as the right document, never as another one arriving.
   */
  private putBack(shared: Y.Text, fileId: string, content: string) {
    const identity = identityOf(content);
    this.doc.transact(() => {
      applyTextChange(shared, content);
      if (identity) identitiesMap(this.doc).set(fileId, identity);
    }, LOCAL);
    if (identity) this.lastText.set(fileId, content);
  }

  /** On the owner: what each LaTeX file is, for the others to check by. */
  private recordIdentities(local: Map<string, LocalFile>) {
    const identities = identitiesMap(this.doc);
    const updates: Array<[string, string]> = [];
    for (const [fileId, known] of this.known) {
      const mine = local.get(known.path);
      if (mine?.kind !== "text" || mine.content === undefined || mine.dirty) {
        continue;
      }
      const shared = this.entry(fileId)?.get("text") as Y.Text | undefined;
      // Only once the shared copy has this version: never an identity for
      // text the others don't have.
      if (!shared || shared.toString() !== mine.content) continue;
      const identity = identityOf(mine.content);
      if (identity && identities.get(fileId) !== identity) {
        updates.push([fileId, identity]);
      }
    }
    const stale = [...identities.keys()].filter((id) => !this.entry(id));
    if (updates.length === 0 && stale.length === 0) return;
    this.doc.transact(() => {
      for (const [fileId, identity] of updates)
        identities.set(fileId, identity);
      for (const fileId of stale) identities.delete(fileId);
    }, LOCAL);
  }
}
