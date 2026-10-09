/**
 * A copy of the Zotero library's structure kept on this computer: every
 * item's title, creators, date and collections, where its PDF is, and the
 * collections themselves. No files. It's there the moment the app opens, so
 * browsing and searching don't wait for Zotero, and it's brought up to date
 * with only what changed since (Zotero's library versions).
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import {
  fetchCollections,
  parsePublicationYear,
  type ZoteroCollection,
  type ZoteroItemSummary,
  zoteroFetch,
} from "./zotero-api";
import { type ZoteroSource, withZoteroSource } from "./zotero-source";
import { useSettingsStore } from "@/stores/settings-store";

export interface LibraryPdf {
  key: string;
  filename: string;
  /** Changes when the file does; names the cached copy. */
  md5: string | null;
  /** Stored in Zotero (not a link to a file on someone's disk). */
  downloadable: boolean;
}

export interface LibraryItem extends ZoteroItemSummary {
  collections: string[];
  /** Zotero's BibTeX, kept while the database fallback is on (see zotero-db.ts). */
  bibtex?: string;
}

interface Attachment extends LibraryPdf {
  parent: string;
}

export interface LibraryMirror {
  format: 2;
  userID: string;
  /** zotero.org's library version this copy is up to date with. */
  version: number;
  /** The same in the Zotero app's own numbering, which is unrelated. */
  localVersion?: number;
  items: Record<string, LibraryItem>;
  attachments: Record<string, Attachment>;
  collections: ZoteroCollection[];
}

export function emptyMirror(userID: string): LibraryMirror {
  return {
    format: 2,
    userID,
    version: 0,
    items: {},
    attachments: {},
    collections: [],
  };
}

/** An item as the Zotero API returns it (the parts used here). */
export interface ApiItem {
  key: string;
  bibtex?: string;
  data: {
    itemType: string;
    parentItem?: string;
    title?: string;
    creators?: { lastName?: string; name?: string }[];
    date?: string;
    collections?: string[];
    contentType?: string;
    filename?: string;
    linkMode?: string;
    md5?: string | null;
    deleted?: boolean | number;
  };
}

/** Folds changed items into the copy (new, edited, moved or trashed). */
export function applyItems(mirror: LibraryMirror, changed: ApiItem[]) {
  for (const { key, data, bibtex } of changed) {
    delete mirror.items[key];
    delete mirror.attachments[key];
    if (data.deleted) continue; // in the trash
    if (data.itemType === "attachment") {
      if (data.parentItem && data.contentType === "application/pdf") {
        mirror.attachments[key] = {
          key,
          parent: data.parentItem,
          filename: data.filename || "document.pdf",
          md5: data.md5 ?? null,
          downloadable:
            data.linkMode === "imported_file" ||
            data.linkMode === "imported_url",
        };
      }
      continue;
    }
    if (data.itemType === "note" || data.itemType === "annotation") continue;
    if (data.parentItem) continue;
    const date = data.date ?? "";
    const year = parsePublicationYear(date);
    mirror.items[key] = {
      key,
      title: data.title || "Untitled",
      creators: (data.creators ?? [])
        .map((c) => c.lastName ?? c.name ?? "")
        .filter(Boolean)
        .join(", "),
      year: year === null ? "" : String(year),
      date,
      itemType: data.itemType,
      collections: data.collections ?? [],
      ...(bibtex?.trim() ? { bibtex: bibtex.trim() } : {}),
    };
  }
}

export function applyDeleted(mirror: LibraryMirror, keys: string[]) {
  for (const key of keys) {
    delete mirror.items[key];
    delete mirror.attachments[key];
  }
}

/** Items in a collection (directly, as Zotero lists them), or all of them. */
export function itemsIn(
  mirror: LibraryMirror,
  collectionKey: string | null,
): LibraryItem[] {
  const all = Object.values(mirror.items);
  return collectionKey
    ? all.filter((i) => i.collections.includes(collectionKey))
    : all;
}

/** The item's PDF: a stored one before a linked one, then by name. */
export function pdfOf(
  mirror: LibraryMirror,
  itemKey: string,
): LibraryPdf | null {
  const pdfs = Object.values(mirror.attachments).filter(
    (a) => a.parent === itemKey,
  );
  pdfs.sort(
    (a, b) =>
      Number(b.downloadable) - Number(a.downloadable) ||
      a.filename.localeCompare(b.filename),
  );
  const [pdf] = pdfs;
  return pdf
    ? {
        key: pdf.key,
        filename: pdf.filename,
        md5: pdf.md5,
        downloadable: pdf.downloadable,
      }
    : null;
}

// ─── Zotero ───

/** Everything changed since `since` (all of it from 0), annotations aside. */
async function fetchChanges(
  apiKey: string,
  userID: string,
  since: number,
  source: ZoteroSource,
) {
  const items: ApiItem[] = [];
  let version = since;
  for (let start = 0; ; start += 100) {
    const params = new URLSearchParams({
      format: "json",
      // BibTeX too when it's kept for the database fallback.
      ...(useSettingsStore.getState().zoteroDatabaseFallback
        ? { include: "data,bibtex" }
        : {}),
      since: String(since),
      // Annotations are many and not needed to browse or search.
      itemType: "-annotation",
      includeTrashed: "1",
      limit: "100",
      start: String(start),
    });
    const response = await zoteroFetch(
      apiKey,
      `/users/${userID}/items?${params}`,
      undefined,
      source,
    );
    version = Number(response.headers.get("Last-Modified-Version") ?? version);
    const page = (await response.json()) as ApiItem[];
    items.push(...page);
    if (page.length < 100) break;
  }
  return { items, version };
}

async function fetchDeleted(
  apiKey: string,
  userID: string,
  since: number,
  source: ZoteroSource,
) {
  const response = await zoteroFetch(
    apiKey,
    `/users/${userID}/deleted?since=${since}`,
    undefined,
    source,
  );
  const body = (await response.json()) as { items?: string[] };
  return body.items ?? [];
}

/**
 * Brings the copy up to date with Zotero: changes since its version, or the
 * whole library the first time. Returns whether anything changed.
 */
export async function syncMirror(
  mirror: LibraryMirror,
  apiKey: string,
  userID: string,
): Promise<boolean> {
  return withZoteroSource((source) => syncFrom(mirror, apiKey, userID, source));
}

async function syncFrom(
  mirror: LibraryMirror,
  apiKey: string,
  userID: string,
  source: ZoteroSource,
): Promise<boolean> {
  const since =
    (source === "local" ? mirror.localVersion : mirror.version) ?? 0;
  const { items, version } = await fetchChanges(apiKey, userID, since, source);
  if (since > 0 && version === since && items.length === 0) return false;
  if (since === 0) {
    // The whole library: what isn't in it any more goes.
    mirror.items = {};
    mirror.attachments = {};
  }
  applyItems(mirror, items);
  if (since > 0)
    applyDeleted(mirror, await fetchDeleted(apiKey, userID, since, source));
  mirror.collections = await fetchCollections(apiKey, userID, source);
  if (source === "local") mirror.localVersion = version;
  else mirror.version = version;
  return true;
}

// ─── On disk ───

async function mirrorPath(userID: string) {
  const dir = await join(await appDataDir(), "zotero");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, `library-${userID}.json`);
}

export async function loadMirror(userID: string): Promise<LibraryMirror> {
  try {
    const path = await mirrorPath(userID);
    if (!(await exists(path))) return emptyMirror(userID);
    const mirror = JSON.parse(await readTextFile(path)) as LibraryMirror;
    // An older copy (without item types) is fetched again in full.
    return mirror.format === 2 && mirror.userID === userID
      ? mirror
      : emptyMirror(userID);
  } catch {
    return emptyMirror(userID);
  }
}

export async function saveMirror(mirror: LibraryMirror) {
  try {
    await writeTextFile(
      await mirrorPath(mirror.userID),
      JSON.stringify(mirror),
    );
  } catch {
    // Kept in memory for this session; the next save tries again.
  }
}

// ─── Store ───

interface LibraryState {
  mirror: LibraryMirror | null;
  /** Reading the copy from disk, or fetching the library the first time. */
  loading: boolean;
  syncing: boolean;
  /** Last sync failed (offline, say); the copy is still usable. */
  error: string | null;
  /** Loads the copy (once) and brings it up to date in the background. */
  ensure: (apiKey: string, userID: string) => Promise<void>;
  sync: (apiKey: string, userID: string) => Promise<void>;
  /** Fetches the whole library again (to keep BibTeX for the fallback). */
  refetch: (apiKey: string, userID: string) => Promise<void>;
  forget: () => void;
}

let loadedFor: string | null = null;
let syncedThisSession = false;

export const useZoteroLibrary = create<LibraryState>((set, get) => ({
  mirror: null,
  loading: false,
  syncing: false,
  error: null,

  ensure: async (apiKey, userID) => {
    if (loadedFor !== userID) {
      loadedFor = userID;
      syncedThisSession = false;
      set({ loading: true, mirror: null, error: null });
      const mirror = await loadMirror(userID);
      set({ mirror, loading: Object.keys(mirror.items).length === 0 });
    }
    if (!syncedThisSession) {
      syncedThisSession = true;
      await get().sync(apiKey, userID);
    }
  },

  sync: async (apiKey, userID) => {
    if (get().syncing) return;
    const current = get().mirror ?? emptyMirror(userID);
    // Work on a copy, so a half-finished sync never shows.
    const next: LibraryMirror = structuredClone(current);
    set({ syncing: true });
    try {
      const changed = await syncMirror(next, apiKey, userID);
      if (changed) {
        set({ mirror: next });
        await saveMirror(next);
      }
      set({ error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ syncing: false, loading: false });
    }
  },

  refetch: async (apiKey, userID) => {
    const mirror = get().mirror;
    if (mirror) set({ mirror: { ...mirror, version: 0, localVersion: 0 } });
    await get().sync(apiKey, userID);
  },

  forget: () => {
    loadedFor = null;
    syncedThisSession = false;
    set({ mirror: null, loading: false, syncing: false, error: null });
  },
}));
