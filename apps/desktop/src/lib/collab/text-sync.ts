import * as Y from "yjs";

/** The part of a project file the sync needs. */
export interface SyncableFile {
  id: string;
  relativePath: string;
  content?: string;
}

/** The part of the document store the sync needs. */
export interface SyncableStore {
  getState: () => {
    files: SyncableFile[];
    updateFileContent: (id: string, content: string) => void;
  };
  subscribe: (
    listener: (
      state: { files: SyncableFile[] },
      prev: { files: SyncableFile[] },
    ) => void,
  ) => () => void;
}

/** Edits that came from the store rather than from a bound editor. */
export const STORE_ORIGIN = Symbol("collab-store");

/** relativePath → the file's text, shared by everyone in the session. */
export function sharedFiles(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>("files");
}

/** Puts the host's loaded text files into the session. */
export function shareProjectText(doc: Y.Doc, files: SyncableFile[]) {
  const map = sharedFiles(doc);
  doc.transact(() => {
    for (const file of files) {
      if (file.content === undefined) continue;
      map.set(file.relativePath, new Y.Text(file.content));
    }
  });
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

/**
 * Keeps the store's file contents and the shared texts equal in both
 * directions. Edits typed into a bound editor reach the shared text through
 * y-codemirror first and arrive here as a shared-text change; everything else
 * that writes to the store (Claude, Zotero, toolbar inserts) is copied across
 * from the store side. Either way the store ends up with the text, so
 * autosave and compiling work unchanged.
 *
 * `onSharedFilesChanged` fires when files are added to or removed from the
 * session, which is when an open editor may need to bind or unbind.
 */
export function bindProjectText(
  doc: Y.Doc,
  store: SyncableStore,
  onSharedFilesChanged?: () => void,
): () => void {
  const map = sharedFiles(doc);
  let pulling = false;

  const pull = (path: string) => {
    const ytext = map.get(path);
    const file = store.getState().files.find((f) => f.relativePath === path);
    if (!ytext || !file || file.content === undefined) return;
    const text = ytext.toString();
    if (text === file.content) return;
    pulling = true;
    try {
      store.getState().updateFileContent(file.id, text);
    } finally {
      pulling = false;
    }
  };

  const observer = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    const paths = new Set<string>();
    let membershipChanged = false;
    for (const event of events) {
      if (event.target === map) {
        membershipChanged = true;
        for (const key of (event as Y.YMapEvent<Y.Text>).keysChanged) {
          paths.add(key);
        }
      } else if (typeof event.path[0] === "string") {
        paths.add(event.path[0]);
      }
    }
    for (const path of paths) pull(path);
    if (membershipChanged) onSharedFilesChanged?.();
  };

  const unsubscribe = store.subscribe((state, prev) => {
    if (pulling || state.files === prev.files) return;
    const before = new Map(prev.files.map((f) => [f.id, f.content]));
    for (const file of state.files) {
      if (file.content === undefined) continue;
      if (before.get(file.id) === file.content) continue;
      const ytext = map.get(file.relativePath);
      if (!ytext || ytext.toString() === file.content) continue;
      const content = file.content;
      doc.transact(() => applyTextChange(ytext, content), STORE_ORIGIN);
    }
  });

  map.observeDeep(observer);
  for (const path of map.keys()) pull(path);

  return () => {
    map.unobserveDeep(observer);
    unsubscribe();
  };
}
