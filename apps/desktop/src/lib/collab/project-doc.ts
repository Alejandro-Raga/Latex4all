import * as Y from "yjs";

/**
 * The shape of a shared project's Yjs document.
 *
 *   meta:  { name }
 *   files: fileId → { path, kind: "text", text: Y.Text }
 *                 | { path, kind: "blob", blobId, size }
 *
 * Files are keyed by a stable id rather than their path, so renaming or
 * moving one while someone else edits it keeps both changes. Binary files
 * (images, PDFs) live on the relay; the document only says which version.
 */

/** Changes that came from the relay. */
export const REMOTE = Symbol("collab-remote");
/** The saved document being read back from disk. */
export const LOADED = Symbol("collab-loaded");
/** Changes made to the document by the sync itself, from local files. */
export const LOCAL = Symbol("collab-local");

export type SharedFile =
  | { fileId: string; path: string; kind: "text"; text: Y.Text }
  | {
      fileId: string;
      path: string;
      kind: "blob";
      blobId: string;
      size: number;
    };

export function filesMap(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>("files");
}

export function metaMap(doc: Y.Doc) {
  return doc.getMap<string>("meta");
}

export function newFileId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function addTextFile(doc: Y.Doc, path: string, content: string) {
  const entry = new Y.Map<unknown>();
  entry.set("path", path);
  entry.set("kind", "text");
  entry.set("text", new Y.Text(content));
  const fileId = newFileId();
  filesMap(doc).set(fileId, entry);
  return fileId;
}

export function addBlobFile(
  doc: Y.Doc,
  path: string,
  blobId: string,
  size: number,
) {
  const entry = new Y.Map<unknown>();
  entry.set("path", path);
  entry.set("kind", "blob");
  entry.set("blobId", blobId);
  entry.set("size", size);
  const fileId = newFileId();
  filesMap(doc).set(fileId, entry);
  return fileId;
}

function readEntry(fileId: string, entry: Y.Map<unknown>): SharedFile | null {
  const path = entry.get("path");
  if (typeof path !== "string" || !path) return null;
  if (entry.get("kind") === "text") {
    const text = entry.get("text");
    return text instanceof Y.Text ? { fileId, path, kind: "text", text } : null;
  }
  const blobId = entry.get("blobId");
  const size = entry.get("size");
  return typeof blobId === "string" && typeof size === "number"
    ? { fileId, path, kind: "blob", blobId, size }
    : null;
}

/** `figures/plot.png` → `figures/plot (2).png` */
export function numberedPath(path: string, n: number) {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const hasExtension = dot > slash + 1;
  return hasExtension
    ? `${path.slice(0, dot)} (${n})${path.slice(dot)}`
    : `${path} (${n})`;
}

/**
 * Where each file goes on disk. Two people can create a file at the same path
 * while offline; every device settles that the same way, without changing the
 * document: the lowest id keeps the path and the others are numbered.
 */
export function layout(doc: Y.Doc): Map<string, SharedFile> {
  const files = [...filesMap(doc).entries()]
    .map(([fileId, entry]) => readEntry(fileId, entry))
    .filter((file): file is SharedFile => file !== null)
    .sort((a, b) => (a.fileId < b.fileId ? -1 : 1));
  const taken = new Set(files.map((f) => f.path));
  const placed = new Map<string, SharedFile>();
  for (const file of files) {
    let path = file.path;
    if (placed.has(path)) {
      let n = 2;
      while (taken.has(numberedPath(file.path, n))) n++;
      path = numberedPath(file.path, n);
      taken.add(path);
    }
    placed.set(path, { ...file, path });
  }
  return placed;
}

export function liveBlobs(doc: Y.Doc) {
  const ids = new Set<string>();
  for (const file of layout(doc).values()) {
    if (file.kind === "blob") ids.add(file.blobId);
  }
  return [...ids];
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Makes `ytext` read `next` by replacing only the part that differs, so
 * someone else's edit elsewhere in the file, and their cursor, survive.
 */
export function applyTextChange(ytext: Y.Text, next: string) {
  const current = ytext.toString();
  if (current === next) return;
  const max = Math.min(current.length, next.length);
  let start = 0;
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  // Never split an emoji or other surrogate pair across the boundary.
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < max - start &&
    current.charCodeAt(current.length - 1 - end) ===
      next.charCodeAt(next.length - 1 - end)
  ) {
    end++;
  }
  if (end > 0 && isLowSurrogate(current.charCodeAt(current.length - end))) {
    end--;
  }
  const deleteCount = current.length - start - end;
  const insert = next.slice(start, next.length - end);
  if (deleteCount > 0) ytext.delete(start, deleteCount);
  if (insert) ytext.insert(start, insert);
}

/** A quick fingerprint of a file's text, to tell whether it changed on disk. */
export function textHash(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
