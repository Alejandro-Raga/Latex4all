/**
 * The vault's own note types, kept in the vault itself so every computer
 * using it has the same ones: a small note, "Latex4All/Note types.md", that
 * Latex4All writes when the types change and reads when the vault loads. A
 * plain folder rather than a hidden one, since sync apps may skip those. It
 * isn't listed among the vault's notes.
 */
import type { CustomNoteType } from "./vault-index";

export const NOTE_TYPES_PATH = "Latex4All/Note types.md";
export const LATEX4ALL_FOLDER = "Latex4All/";

/** Whether a vault path is Latex4All's own, not a note of yours. */
export const isOwnFile = (path: string) => path.startsWith(LATEX4ALL_FOLDER);

export function noteTypesFile(types: CustomNoteType[]): string {
  const clean = types.map(({ id, label, color, folder, tag, zoteroTag }) => ({
    id,
    label,
    color,
    ...(folder ? { folder } : {}),
    ...(tag ? { tag } : {}),
    ...(zoteroTag ? { zoteroTag } : {}),
  }));
  return [
    "---",
    "latex4all: note-types",
    "---",
    "Your own note types, as Latex4All keeps them for this vault (Settings →",
    "Vault → Note types). Every computer using the vault reads them from here.",
    "",
    "```json",
    JSON.stringify(clean, null, 2),
    "```",
    "",
  ].join("\n");
}

/** The types in the file, or null when it isn't one Latex4All can read. */
export function readNoteTypesFile(text: string): CustomNoteType[] | null {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (t): t is CustomNoteType =>
        t &&
        typeof t.id === "string" &&
        typeof t.label === "string" &&
        typeof t.color === "string",
    );
  } catch {
    return null;
  }
}
