/**
 * Renaming and deleting notes in the vault without leaving broken links
 * behind, and keeping a project's note with its project when the project
 * is renamed or moved.
 */
import { useVaultStore } from "@/stores/vault-store";
import { projectNotePath } from "./project-note";
import { renameLinks } from "./rename-links";

const folderName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const noteNameOf = (path: string) =>
  (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/**
 * Moves a note to `newPath`, and points every link to it at its new name.
 * Returns how many other notes were updated.
 */
export async function renameNote(oldPath: string, newPath: string) {
  const vault = useVaultStore.getState();
  await vault.ensureVault();
  const { source, index, noteWritten } = useVaultStore.getState();
  if (!source) throw new Error("No vault is open.");
  const from = noteNameOf(oldPath);
  const to = noteNameOf(newPath);

  const { text } = await source.readNote(oldPath);
  await source.createNote(newPath, renameLinks(text, from, to));
  noteWritten(newPath, renameLinks(text, from, to));

  let updated = 0;
  if (from.toLowerCase() !== to.toLowerCase()) {
    for (const note of index?.list ?? []) {
      if (note.path === oldPath) continue;
      const links = note.links.some(
        (l) =>
          l.target.replace(/\.md$/i, "").toLowerCase() === from.toLowerCase(),
      );
      const embeds = note.embeds.some(
        (e) => e.replace(/\.md$/i, "").toLowerCase() === from.toLowerCase(),
      );
      if (!links && !embeds) continue;
      const current = await source.readNote(note.path);
      const next = renameLinks(current.text, from, to);
      if (next === current.text) continue;
      await source.writeNote(note.path, next, current.version);
      noteWritten(note.path, next);
      updated++;
    }
  }
  await deleteNote(oldPath);
  return updated;
}

/** Deletes a note from the vault. */
export async function deleteNote(path: string) {
  const { source } = useVaultStore.getState();
  if (!source) throw new Error("No vault is open.");
  await source.deleteNote(path);
  useVaultStore.getState().noteDeleted(path);
}

/**
 * Stops keeping a project's note, and offers to delete the note too (it
 * stays, as it was, if you'd rather keep it).
 */
export async function unlinkProject(root: string) {
  const vault = useVaultStore.getState();
  vault.linkProject(root, false);
  const { source, projectsFolder, index } = useVaultStore.getState();
  if (!source) return;
  const path = projectNotePath(projectsFolder, folderName(root));
  const note = index?.list.find((n) => n.path === path);
  if (!note) return;
  const links = note.incoming.length;
  const also = window.confirm(
    `Also delete “${note.name}” from the vault?${
      links ? ` ${links} note${links === 1 ? " links" : "s link"} to it.` : ""
    }`,
  );
  if (also) await deleteNote(path);
}

/**
 * A project moved or was renamed (its folder, from `oldRoot` to `newRoot`):
 * it stays linked to the vault, and its note takes the new name, with the
 * links to it following. Its content catches up at the next sync.
 */
export async function relinkProject(oldRoot: string, newRoot: string) {
  const vault = useVaultStore.getState();
  if (!vault.linkedProjects[oldRoot]) return;
  vault.linkProject(oldRoot, false);
  vault.linkProject(newRoot, true);
  const oldName = folderName(oldRoot);
  const newName = folderName(newRoot);
  if (oldName === newName) return;
  await vault.ensureVault();
  const { source, projectsFolder } = useVaultStore.getState();
  if (!source) return;
  const oldPath = projectNotePath(projectsFolder, oldName);
  const newPath = projectNotePath(projectsFolder, newName);
  const had = await source.readNote(oldPath).catch(() => null);
  const taken = await source.readNote(newPath).catch(() => null);
  if (had && !taken) await renameNote(oldPath, newPath);
}
