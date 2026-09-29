import { configDir, join } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { parseNote, type ParsedNote } from "./parse";

export interface KnownVault {
  path: string;
  name: string;
}

/** Vaults Obsidian has opened on this computer, most recent first. */
export async function findObsidianVaults(): Promise<KnownVault[]> {
  try {
    const file = await join(await configDir(), "obsidian", "obsidian.json");
    if (!(await exists(file))) return [];
    const config = JSON.parse(await readTextFile(file)) as {
      vaults?: Record<string, { path: string; ts?: number; open?: boolean }>;
    };
    return Object.values(config.vaults ?? {})
      .sort(
        (a, b) => Number(b.open) - Number(a.open) || (b.ts ?? 0) - (a.ts ?? 0),
      )
      .map((v) => ({
        path: v.path,
        name: v.path.split(/[\\/]/).filter(Boolean).pop() ?? v.path,
      }));
  } catch {
    return [];
  }
}

export interface LoadedVault {
  notes: ParsedNote[];
  /** Other files (images, PDFs) by lower-cased name, for `![[...]]` embeds. */
  attachments: Map<string, string>;
}

/** The templates folder set in Obsidian's Templates plugin, or `Templates`. */
async function templatesFolder(root: string): Promise<string> {
  try {
    const file = await join(root, ".obsidian", "templates.json");
    if (!(await exists(file))) return "Templates";
    const { folder } = JSON.parse(await readTextFile(file)) as {
      folder?: string;
    };
    return folder?.replace(/^\/+|\/+$/g, "") || "Templates";
  } catch {
    return "Templates";
  }
}

/**
 * Every note and attachment in the vault, skipping Obsidian's own folders
 * and its templates, which aren't notes.
 */
export async function loadVault(root: string): Promise<LoadedVault> {
  const notes: ParsedNote[] = [];
  const attachments = new Map<string, string>();
  const templates = await templatesFolder(root);
  const walk = async (dir: string, rel: string) => {
    for (const entry of await readDir(dir)) {
      if (entry.name.startsWith(".")) continue;
      const path = await join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory && relPath === templates) continue;
      if (entry.isDirectory) {
        await walk(path, relPath);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        notes.push(parseNote(relPath, await readTextFile(path)));
      } else if (entry.isFile) {
        const key = entry.name.toLowerCase();
        if (!attachments.has(key)) attachments.set(key, relPath);
      }
    }
  };
  await walk(root, "");
  return { notes, attachments };
}
