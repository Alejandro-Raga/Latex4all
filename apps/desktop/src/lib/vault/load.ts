import { configDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { parseNote, type ParsedNote } from "./parse";
import { WebdavVault, type WebdavStatus } from "./webdav";

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
  /** A version per note path (server ETag), to catch saves that would clash. */
  versions: Map<string, string | null>;
  /** Notes in Obsidian's templates folder, usable for new notes. */
  templates: string[];
  /** Folder Obsidian puts new notes in, if it's set to a fixed one. */
  newNoteFolder: string | null;
}

export class NoteExistsError extends Error {
  constructor(path: string) {
    super(`There's already a note at ${path}.`);
  }
}

/** Where the vault's files live: a folder on this computer, or a server. */
export interface VaultSource {
  readonly kind: "local" | "server";
  /** Name to show for the vault. */
  readonly label: string;
  load(): Promise<LoadedVault>;
  readAttachment(path: string): Promise<Uint8Array>;
  readNote(path: string): Promise<{ text: string; version: string | null }>;
  /**
   * Saves a note. With a `version`, fails with WebdavConflictError when the
   * note changed elsewhere since that version was read.
   */
  writeNote(
    path: string,
    text: string,
    version?: string | null,
  ): Promise<string | null>;
  /** Creates a note, failing if one already exists at `path`. */
  createNote(path: string, text: string): Promise<void>;
}

const DEFAULT_TEMPLATES = "Templates";

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

/** The templates folder set in Obsidian's Templates plugin, or `Templates`. */
function templatesFrom(json: string | null): string {
  if (!json) return DEFAULT_TEMPLATES;
  try {
    const { folder } = JSON.parse(json) as { folder?: string };
    return trimSlashes(folder ?? "") || DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

/** Where Obsidian's "Default location for new notes" points, when it's a folder. */
function newNoteFolderFrom(json: string | null): string | null {
  if (!json) return null;
  try {
    const app = JSON.parse(json) as {
      newFileLocation?: string;
      newFileFolderPath?: string;
    };
    return app.newFileLocation === "folder"
      ? trimSlashes(app.newFileFolderPath ?? "")
      : null;
  } catch {
    return null;
  }
}

/** A vault folder on this computer, as Obsidian keeps it. */
export class LocalVaultSource implements VaultSource {
  readonly kind = "local";
  readonly label: string;

  constructor(readonly root: string) {
    this.label = folderName(root);
  }

  private abs(path: string) {
    return join(this.root, ...path.split("/"));
  }

  private async obsidianSetting(file: string): Promise<string | null> {
    const path = await this.abs(`.obsidian/${file}`);
    return (await exists(path)) ? readTextFile(path) : null;
  }

  async load(): Promise<LoadedVault> {
    const notes: ParsedNote[] = [];
    const attachments = new Map<string, string>();
    const templates: string[] = [];
    const templatesFolder = templatesFrom(
      await this.obsidianSetting("templates.json"),
    );
    const walk = async (dir: string, rel: string) => {
      for (const entry of await readDir(dir)) {
        if (entry.name.startsWith(".")) continue;
        const path = await join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        const isNote = entry.isFile && entry.name.toLowerCase().endsWith(".md");
        if (entry.isDirectory) {
          await walk(path, relPath);
        } else if (isNote && relPath.startsWith(`${templatesFolder}/`)) {
          templates.push(relPath);
        } else if (isNote) {
          notes.push(parseNote(relPath, await readTextFile(path)));
        } else if (entry.isFile) {
          const key = entry.name.toLowerCase();
          if (!attachments.has(key)) attachments.set(key, relPath);
        }
      }
    };
    await walk(this.root, "");
    return {
      notes,
      attachments,
      versions: new Map(),
      templates: templates.sort(),
      newNoteFolder: newNoteFolderFrom(await this.obsidianSetting("app.json")),
    };
  }

  async readAttachment(path: string) {
    return readFile(await this.abs(path));
  }

  async readNote(path: string) {
    return { text: await readTextFile(await this.abs(path)), version: null };
  }

  async writeNote(path: string, text: string) {
    await writeTextFile(await this.abs(path), text);
    return null;
  }

  async createNote(path: string, text: string) {
    const abs = await this.abs(path);
    if (await exists(abs)) throw new NoteExistsError(path);
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await mkdir(await this.abs(parent), { recursive: true });
    await writeTextFile(abs, text);
  }
}

/** Notes already fetched from a server, reused while their ETag is unchanged. */
const serverCache = new Map<string, { etag: string; note: ParsedNote }>();

/** How many files to fetch from the server at once. */
const PARALLEL = 6;

/** A vault kept on a WebDAV server, read and written there directly. */
export class ServerVaultSource implements VaultSource {
  readonly kind = "server";
  readonly label: string;
  private dav: WebdavVault;

  constructor(readonly status: WebdavStatus) {
    this.dav = new WebdavVault(status);
    this.label = decodeURIComponent(folderName(new URL(status.url).pathname));
  }

  /** One of Obsidian's settings files, when it's synced to the server. */
  private async obsidianSetting(file: string): Promise<string | null> {
    try {
      return (await this.dav.readText(`.obsidian/${file}`)).text;
    } catch {
      return null;
    }
  }

  async load(): Promise<LoadedVault> {
    const files: { path: string; etag: string | null }[] = [];
    const attachments = new Map<string, string>();
    const templates: string[] = [];
    const [templatesJson, appJson] = await Promise.all([
      this.obsidianSetting("templates.json"),
      this.obsidianSetting("app.json"),
    ]);
    const templatesFolder = templatesFrom(templatesJson);

    let folders = [""];
    while (folders.length) {
      const listings = await Promise.all(folders.map((f) => this.dav.list(f)));
      folders = [];
      for (const entry of listings.flat()) {
        const name = folderName(entry.path);
        if (name.startsWith(".")) continue;
        if (entry.isFolder) {
          folders.push(entry.path);
        } else if (
          name.toLowerCase().endsWith(".md") &&
          entry.path.startsWith(`${templatesFolder}/`)
        ) {
          templates.push(entry.path);
        } else if (name.toLowerCase().endsWith(".md")) {
          files.push(entry);
        } else if (!attachments.has(name.toLowerCase())) {
          attachments.set(name.toLowerCase(), entry.path);
        }
      }
    }

    const notes: ParsedNote[] = [];
    const versions = new Map<string, string | null>();
    const queue = [...files];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const cached = serverCache.get(file.path);
        if (cached && file.etag && cached.etag === file.etag) {
          notes.push(cached.note);
          versions.set(file.path, file.etag);
          continue;
        }
        const { text, etag } = await this.dav.readText(file.path);
        const note = parseNote(file.path, text);
        const version = file.etag ?? etag;
        if (version) serverCache.set(file.path, { etag: version, note });
        notes.push(note);
        versions.set(file.path, version);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return {
      notes,
      attachments,
      versions,
      templates: templates.sort(),
      newNoteFolder: newNoteFolderFrom(appJson),
    };
  }

  readAttachment(path: string) {
    return this.dav.readBytes(path);
  }

  async readNote(path: string) {
    const { text, etag } = await this.dav.readText(path);
    return { text, version: etag };
  }

  async writeNote(path: string, text: string, version?: string | null) {
    const etag = await this.dav.writeText(path, text, version);
    serverCache.delete(path);
    return etag;
  }

  async createNote(path: string, text: string) {
    const parts = path.split("/");
    const parent = parts.slice(0, -1).join("/");
    const siblings = await this.dav.list(parent).catch(() => null);
    if (siblings === null && parent) await this.dav.makeFolder(parent);
    if (siblings?.some((e) => e.path.toLowerCase() === path.toLowerCase())) {
      throw new NoteExistsError(path);
    }
    await this.dav.writeText(path, text);
  }
}
