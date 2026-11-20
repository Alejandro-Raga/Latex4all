import type * as Y from "yjs";
import {
  createDirectory,
  trashFileFromDisk,
  join,
  renameFileOnDisk,
  writeTexFileContent,
} from "@/lib/tauri/fs";
import { downloadBlob, uploadBlob } from "@/lib/tauri/collab";
import { type ProjectFile, useDocumentStore } from "@/stores/document-store";
import type { LocalFile, Workspace } from "./project-sync";

function parentOf(path: string) {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

/**
 * A compiled PDF sitting next to its .tex file changes on every compile and
 * anyone can rebuild it, so it isn't shared.
 */
export function isCompiledOutput(file: ProjectFile, texStems: Set<string>) {
  return (
    file.type === "pdf" &&
    texStems.has(file.relativePath.replace(/\.pdf$/i, ""))
  );
}

/** The open project, as the sync sees it: the document store plus the disk. */
/** Each file's name for peer-to-peer (by its relay id), so it can be had
 * from the others and the hub when the relay can't give it. */
export function p2pBlobs(doc: Y.Doc) {
  return doc.getMap<string>("p2pBlobs");
}

export function documentStoreWorkspace(
  projectRoot: string,
  link: string,
  doc?: Y.Doc,
): Workspace {
  const cache = new WeakMap<ProjectFile, LocalFile>();
  let lastSeen: LocalFile[] = [];
  const absolute = (path: string) => join(projectRoot, ...path.split("/"));
  const ensureParent = async (path: string) => {
    const parent = parentOf(path);
    if (parent) await createDirectory(await absolute(parent));
  };
  // Unsaved edits go to disk before a file is moved or deleted under them,
  // or they'd be saved back to where it used to be.
  const saveFirst = () => useDocumentStore.getState().saveAllFiles();

  return {
    available() {
      return useDocumentStore.getState().projectRoot === projectRoot;
    },

    files() {
      // Another project's files (mid-switch): never this one's. What was
      // last seen of this project stands, so nothing looks changed or gone.
      if (useDocumentStore.getState().projectRoot !== projectRoot) {
        return lastSeen;
      }
      const files = useDocumentStore.getState().files;
      const texStems = new Set(
        files
          .filter((f) => f.type === "tex")
          .map((f) => f.relativePath.replace(/\.tex$/i, "")),
      );
      const result: LocalFile[] = [];
      for (const file of files) {
        const shareable = !isCompiledOutput(file, texStems);
        let local = cache.get(file);
        if (local && local.shareable !== shareable) local = undefined;
        if (!local) {
          const isText =
            file.content !== undefined &&
            file.type !== "image" &&
            file.type !== "pdf";
          local = {
            path: file.relativePath,
            kind: isText ? "text" : "blob",
            content: isText && !file.unreadable ? file.content : undefined,
            unreadable: file.unreadable,
            size: file.fileSize ?? file.content?.length ?? 0,
            dirty: file.isDirty,
            shareable,
          };
          cache.set(file, local);
        }
        result.push(local);
      }
      lastSeen = result;
      return result;
    },

    subscribe(listener) {
      return useDocumentStore.subscribe((state, prev) => {
        // Only this project's own changes: not another project's files
        // arriving as the app switches to it.
        if (
          state.files !== prev.files &&
          state.projectRoot === projectRoot &&
          prev.projectRoot === projectRoot
        )
          listener();
      });
    },

    setText(path, content) {
      // Another project open now: its file of the same name isn't this one.
      if (useDocumentStore.getState().projectRoot !== projectRoot) return;
      useDocumentStore.getState().updateFileContent(path, content);
    },

    async writeText(path, content) {
      await ensureParent(path);
      await writeTexFileContent(await absolute(path), content);
    },

    async upload(path) {
      const { blobId, size, p2p } = await uploadBlob(link, projectRoot, path);
      if (doc && p2p && p2pBlobs(doc).get(blobId) !== p2p) {
        p2pBlobs(doc).set(blobId, p2p);
      }
      return { blobId, size };
    },

    async download(path, blobId) {
      const known = doc ? p2pBlobs(doc).get(blobId) : undefined;
      const p2p = await downloadBlob(link, projectRoot, path, blobId, known);
      if (doc && p2p && !known) p2pBlobs(doc).set(blobId, p2p);
    },

    async move(from, to) {
      await saveFirst();
      await ensureParent(to);
      await renameFileOnDisk(await absolute(from), await absolute(to));
    },

    async remove(path) {
      await saveFirst();
      await trashFileFromDisk(await absolute(path));
    },

    refresh() {
      return useDocumentStore.getState().refreshFiles();
    },
  };
}
