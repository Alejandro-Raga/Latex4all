/** Making a vault note of a given type, from anywhere in the app. */
import { useVaultStore } from "@/stores/vault-store";
import { newGroupNote, type PassageGroup } from "./add-passage";
import { kindFolder } from "./kind-folders";
import type { NoteKind } from "./vault-index";

/** The kind a template is for, going by its file name ("Idea template"). */
export function kindFromTemplate(path: string): NoteKind | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  for (const kind of ["idea", "topic", "project", "paper"] as const) {
    if (name.includes(kind)) return kind;
  }
  return null;
}

/**
 * A new note of `kind` titled `title`: in that kind's folder (else where new
 * notes go), from the vault's template for it, else a topic's or idea's
 * usual sections. Returns its name.
 */
export async function createNoteOfKind(
  kind: NoteKind,
  title: string,
): Promise<string> {
  const vault = useVaultStore.getState();
  await vault.ensureVault();
  const { templates, lastNoteFolder, newNoteFolder, createNote, setNoteKind } =
    useVaultStore.getState();
  const folder = kindFolder(kind) ?? lastNoteFolder ?? newNoteFolder ?? "";
  const template = templates.find((t) => kindFromTemplate(t) === kind) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const name = await createNote(
    folder,
    title,
    template,
    kind === "topic" || kind === "idea"
      ? (n) => newGroupNote(kind as PassageGroup, n, today)
      : undefined,
  );
  if (kind !== "note" && !template) setNoteKind(name, kind);
  return name;
}
