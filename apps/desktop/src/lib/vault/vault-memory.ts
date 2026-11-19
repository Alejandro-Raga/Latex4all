/**
 * Which note the vault opens on, by where it's shown (Settings → General
 * things open): the Library's vault and each project's keep their own
 * place, so opening a project doesn't move the Library's, and the reverse.
 *
 * - The Library's vault: within a session, where you left it; after a
 *   restart, the note you were reading or the vault's main page.
 * - A project's vault, on opening the project: its note (the main page if
 *   it has none), the last note read there, or the main page.
 */

import { loadPlace } from "@/lib/place-memory";
import { useSettingsStore } from "@/stores/settings-store";
import { useVaultStore } from "@/stores/vault-store";
import { useDocumentStore } from "@/stores/document-store";
import { projectNoteFor, projectNoteId } from "./note-changes";

/** The Library's note this session (undefined: not been there yet). */
let libraryNote: string | null | undefined;
/** Each project's note this session. */
const projectNotes = new Map<string, string | null>();
/** Where the vault is shown now, once its note is settled: notes opened
 * are remembered for it only then (not the last place's, on arriving). */
let settled: string | null = null;

/** Where the Library's vault opens, now that it's shown. */
export async function enterLibraryVault() {
  settled = null;
  const memory = useSettingsStore.getState().memory;
  if (libraryNote === undefined) {
    libraryNote =
      memory.vaultLibrary === "last"
        ? ((await loadPlace()).note ?? null)
        : null;
  }
  setCurrent(libraryNote);
  settled = "library";
}

/** Where a project's vault opens, now that the project is open. */
/** Returns whether the project has a note (when that decided), so the panel
 * can show the whole vault for one that hasn't. */
export async function enterProjectVault(
  root: string,
): Promise<boolean | undefined> {
  settled = null;
  const memory = useSettingsStore.getState().memory;
  let found: boolean | undefined;
  if (projectNotes.has(root)) {
    // Back in it this session: where it was.
    setCurrent(projectNotes.get(root) ?? null);
  } else if (memory.vaultProject === "home") {
    setCurrent(null);
  } else if (memory.vaultProject === "project") {
    const id = await projectNoteId(root).catch(() => null);
    // Another project opened meanwhile: its own arrival decides.
    if (useDocumentStore.getState().projectRoot !== root) return undefined;
    const path = projectNoteFor(id, root);
    const note = useVaultStore
      .getState()
      .index?.list.find((n) => n.path === path);
    setCurrent(note ? note.name : null);
    found = Boolean(note);
  }
  settled = `project:${root}`;
  return found;
}

/** The note open now, remembered for where it's shown. */
export function noteShown(where: { library: true } | { project: string }) {
  const key = "library" in where ? "library" : `project:${where.project}`;
  if (settled !== key) return;
  const { current } = useVaultStore.getState();
  if ("library" in where) libraryNote = current;
  else projectNotes.set(where.project, current);
}

function setCurrent(name: string | null) {
  if (useVaultStore.getState().current === name) return;
  useVaultStore.setState({ current: name });
}
