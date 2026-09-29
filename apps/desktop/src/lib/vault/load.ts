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

/** The templates folder set in Obsidian's Templates plugin, or `Templates`. */
function templatesFrom(json: string | null): string {
  if (!json) return DEFAULT_TEMPLATES;
  try {
    const { folder } = JSON.parse(json) as { folder?: string };
    return folder?.replace(/^\/+|\/+$/g, "") || DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
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

  async load(): Promise<LoadedVault> {
    const notes: ParsedNote[] = [];
    const attachments = new Map<string, string>();
    const settings = await this.abs(".obsidian/templates.json");
    const templates = templatesFrom(
      (await exists(settings)) ? await readTextFile(settings) : null,
    );
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
    await walk(this.root, "");
    return { notes, attachments, versions: new Map() };
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

  async load(): Promise<LoadedVault> {
    const files: { path: string; etag: string | null }[] = [];
    const attachments = new Map<string, string>();
    let templates = DEFAULT_TEMPLATES;
    try {
      templates = templatesFrom(
        (await this.dav.readText(".obsidian/templates.json")).text,
      );
    } catch {
      // Not synced to the server; use the default.
    }

    let folders = [""];
    while (folders.length) {
      const listings = await Promise.all(folders.map((f) => this.dav.list(f)));
      folders = [];
      for (const entry of listings.flat()) {
        const name = folderName(entry.path);
        if (name.startsWith(".")) continue;
        if (entry.isFolder) {
          if (entry.path !== templates) folders.push(entry.path);
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
    return { notes, attachments, versions };
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
