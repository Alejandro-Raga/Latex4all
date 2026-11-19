/**
 * A shared project that isn't open, as the sync sees it: its folder on
 * disk, read the way opening it reads it (so a file is text or not the same
 * either way). For linked devices: a project shared from here sends its
 * files, and one fetched here gets them, without being opened.
 */

import type * as Y from "yjs";
import {
  createDirectory,
  trashFileFromDisk,
  join,
  LARGE_FILE_THRESHOLD,
  readTexFileContent,
  renameFileOnDisk,
  scanProjectFolder,
  writeTexFileContent,
} from "@/lib/tauri/fs";
import { downloadBlob, uploadBlob } from "@/lib/tauri/collab";
import type { LocalFile, Workspace } from "./project-sync";
import { p2pBlobs } from "./store-workspace";

function parentOf(path: string) {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

export function diskWorkspace(
  projectRoot: string,
  link: string,
  doc: Y.Doc,
): Workspace & { load(): Promise<void>; stop(): void } {
  let files: LocalFile[] = [];
  const listeners = new Set<() => void>();
  let live = true;
  const absolute = (path: string) => join(projectRoot, ...path.split("/"));
  const ensureParent = async (path: string) => {
    const parent = parentOf(path);
    if (parent) await createDirectory(await absolute(parent));
  };

  async function load() {
    const scan = await scanProjectFolder(projectRoot);
    const texStems = new Set(
      scan.files
        .filter((f) => f.type === "tex")
        .map((f) => f.relativePath.replace(/\.tex$/i, "")),
    );
    const next: LocalFile[] = [];
    for (const f of scan.files) {
      const isText =
        f.type === "tex" ||
        f.type === "bib" ||
        f.type === "style" ||
        (f.type === "other" && f.fileSize <= LARGE_FILE_THRESHOLD);
      // As opening does: a compiled PDF beside its .tex isn't shared.
      const shareable = !(
        f.type === "pdf" && texStems.has(f.relativePath.replace(/\.pdf$/i, ""))
      );
      if (isText) {
        let content: string;
        try {
          content = await readTexFileContent(f.absolutePath);
        } catch {
          // Unreadable now (a sync app has it): there, but not synced
          // until it can be read (never taken for deleted).
          next.push({
            path: f.relativePath,
            kind: "text",
            size: 0,
            dirty: false,
            shareable,
            unreadable: true,
          });
          continue;
        }
        next.push({
          path: f.relativePath,
          kind: "text",
          content,
          size: content.length,
          dirty: false,
          shareable,
        });
      } else {
        next.push({
          path: f.relativePath,
          kind: "blob",
          size: f.fileSize,
          dirty: false,
          shareable,
        });
      }
    }
    files = next;
    for (const l of listeners) l();
  }

  return {
    load,

    stop() {
      live = false;
      listeners.clear();
    },

    available() {
      return live;
    },

    files() {
      return files;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setText(path, content) {
      // Not open: straight to disk.
      void (async () => {
        await ensureParent(path);
        await writeTexFileContent(await absolute(path), content);
        files = files.map((f) =>
          f.path === path ? { ...f, content, size: content.length } : f,
        );
      })();
    },

    async writeText(path, content) {
      await ensureParent(path);
      await writeTexFileContent(await absolute(path), content);
    },

    async upload(path) {
      const { blobId, size, p2p } = await uploadBlob(link, projectRoot, path);
      if (p2p && p2pBlobs(doc).get(blobId) !== p2p) {
        p2pBlobs(doc).set(blobId, p2p);
      }
      return { blobId, size };
    },

    async download(path, blobId) {
      await ensureParent(path);
      const known = p2pBlobs(doc).get(blobId);
      const p2p = await downloadBlob(link, projectRoot, path, blobId, known);
      if (p2p && !known) p2pBlobs(doc).set(blobId, p2p);
    },

    async move(from, to) {
      await ensureParent(to);
      await renameFileOnDisk(await absolute(from), await absolute(to));
    },

    async remove(path) {
      await trashFileFromDisk(await absolute(path));
    },

    async refresh() {
      if (live) await load();
    },
  };
}
