/**
 * Renaming and deleting notes in the vault without leaving broken links
 * behind, and keeping a project's note with its project when the project
 * is renamed or moved.
 */
import { readProjectId } from "@/lib/project-meta";
import { readLink } from "@/lib/tauri/collab";
import { useVaultStore } from "@/stores/vault-store";
import { kindFolder } from "./kind-folders";
import { textField } from "./parse";
import { findNote, type NoteKind } from "./vault-index";
import { projectNotePath } from "./project-note";
import { NoteExistsError } from "./load";
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

/**
 * A project's id for its vault note: a shared project's own, so every
 * computer sharing it agrees, else one kept in the project.
 */
export async function projectNoteId(root: string): Promise<string | null> {
  const shared = await readLink(root).catch(() => null);
  if (shared?.projectId) return shared.projectId;
  return readProjectId(root).catch(() => null);
}

/**
 * Where a project's note is: the note carrying its id, wherever it is and
 * whatever it's called (another computer may have renamed it), else an
 * older one at the name this computer would give it.
 */
export function projectNoteFor(id: string | null, root: string): string {
  const { index, projectsFolder } = useVaultStore.getState();
  if (id) {
    const mine = index?.list.find(
      (n) => textField(n.frontmatter, "latex4all_project") === id,
    );
    if (mine) return mine.path;
  }
  return projectNotePath(projectsFolder, folderName(root));
}

/**
 * Sets what a note is; a type of the user's with a folder also moves the
 * note into that folder (its name, and so every link to it, stays).
 * Returns where the note went, if it moved.
 */
export async function chooseNoteKind(
  name: string,
  kind: NoteKind | null,
): Promise<string | null> {
  const vault = useVaultStore.getState();
  vault.setNoteKind(name, kind);
  const note = vault.index ? findNote(vault.index, name) : undefined;
  const folder = kindFolder(kind);
  if (!folder || !note) return null;
  const dir = note.path.split("/").slice(0, -1).join("/");
  if (dir.toLowerCase() === folder.toLowerCase()) return null;
  const file = note.path.split("/").pop() ?? `${name}.md`;
  const target = folder ? `${folder}/${file}` : file;
  await renameNote(note.path, target);
  return folder;
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
  const { source, index } = useVaultStore.getState();
  if (!source) return;
  const path = projectNoteFor(await projectNoteId(root), root);
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
  const newName = folderName(newRoot);
  await vault.ensureVault();
  const { source, projectsFolder } = useVaultStore.getState();
  if (!source) return;
  // Found by the project's id, so it's this project's note, whatever it's
  // called now; or, for a note from before ids, at the old name.
  const oldPath = projectNoteFor(await projectNoteId(newRoot), oldRoot);
  const newPath = projectNotePath(projectsFolder, newName);
  if (oldPath.toLowerCase() === newPath.toLowerCase()) return;
  const had = await source.readNote(oldPath).catch(() => null);
  const taken = await source.readNote(newPath).catch(() => null);
  // A note already there under the new name is someone else's: this one
  // keeps its name rather than failing the rename.
  if (!had || taken) return;
  try {
    await renameNote(oldPath, newPath);
  } catch (err) {
    if (!(err instanceof NoteExistsError)) throw err;
  }
}
