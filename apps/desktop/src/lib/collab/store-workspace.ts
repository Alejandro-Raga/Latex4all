import {
  createDirectory,
  deleteFileFromDisk,
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
function isCompiledOutput(file: ProjectFile, texStems: Set<string>) {
  return (
    file.type === "pdf" &&
    texStems.has(file.relativePath.replace(/\.pdf$/i, ""))
  );
}

/** The open project, as the sync sees it: the document store plus the disk. */
export function documentStoreWorkspace(
  projectRoot: string,
  link: string,
): Workspace {
  const cache = new WeakMap<ProjectFile, LocalFile>();
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
            content: isText ? file.content : undefined,
            size: file.fileSize ?? file.content?.length ?? 0,
            dirty: file.isDirty,
            shareable,
          };
          cache.set(file, local);
        }
        result.push(local);
      }
      return result;
    },

    subscribe(listener) {
      return useDocumentStore.subscribe((state, prev) => {
        if (state.files !== prev.files) listener();
      });
    },

    setText(path, content) {
      useDocumentStore.getState().updateFileContent(path, content);
    },

    async writeText(path, content) {
      await ensureParent(path);
      await writeTexFileContent(await absolute(path), content);
    },

    upload(path) {
      return uploadBlob(link, projectRoot, path);
    },

    async download(path, blobId) {
      await downloadBlob(link, projectRoot, path, blobId);
    },

    async move(from, to) {
      await saveFirst();
      await ensureParent(to);
      await renameFileOnDisk(await absolute(from), await absolute(to));
    },

    async remove(path) {
      await saveFirst();
      await deleteFileFromDisk(await absolute(path));
    },

    refresh() {
      return useDocumentStore.getState().refreshFiles();
    },
  };
}
