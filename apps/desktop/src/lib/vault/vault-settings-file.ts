/**
 * The vault's own settings, kept in the vault itself like its note types
 * (note-types-file.ts), so every computer using it writes the same notes:
 * the vault tag in Zotero, the papers folder, the folder of each kind, and
 * the Zotero tags the sync leaves alone.
 * A small note, "Latex4All/Vault settings.md"; not listed among the notes.
 */
import { LATEX4ALL_FOLDER } from "./note-types-file";

export const VAULT_SETTINGS_PATH = `${LATEX4ALL_FOLDER}Vault settings.md`;

export interface VaultSettings {
  paperTag: string;
  papersFolder: string;
  /** Folders picked for built-in kinds (topic, idea…). */
  kindFolders: Record<string, string>;
  /** Zotero tags the sync leaves alone. */
  ignoredTags: string[];
}

export function vaultSettingsFile(s: VaultSettings): string {
  return [
    "---",
    "latex4all: vault-settings",
    "---",
    "Settings of this vault, as Latex4All keeps them (the vault tag in Zotero",
    "and the folders of each kind of note). Every computer using the vault",
    "reads them from here.",
    "",
    "```json",
    JSON.stringify(s, null, 2),
    "```",
    "",
  ].join("\n");
}

/** The settings in the file, or null when it isn't one Latex4All can read. */
export function readVaultSettingsFile(text: string): VaultSettings | null {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]);
    if (!p || typeof p !== "object") return null;
    const folders =
      p.kindFolders && typeof p.kindFolders === "object" ? p.kindFolders : {};
    return {
      paperTag: typeof p.paperTag === "string" ? p.paperTag : "",
      papersFolder: typeof p.papersFolder === "string" ? p.papersFolder : "",
      ignoredTags: Array.isArray(p.ignoredTags)
        ? p.ignoredTags.filter((t: unknown) => typeof t === "string")
        : [],
      kindFolders: Object.fromEntries(
        Object.entries(folders).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      ),
    };
  } catch {
    return null;
  }
}
