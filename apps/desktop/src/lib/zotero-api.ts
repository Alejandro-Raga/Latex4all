import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

const ZOTERO_BASE = "https://api.zotero.org";

export interface ZoteroCredentials {
  apiKey: string;
  userID: string;
  username: string;
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parentKey: string | false;
  itemCount: number;
}

/** Result of importing a collection */
export interface CollectionImportResult {
  bibtex: string;
  libraryVersion: number;
  keyMap: Record<string, string>;
  totalItems: number;
}

/** Result of an incremental sync */
export interface CollectionSyncResult {
  updatedEntries: { key: string; citekey: string; bibtex: string }[];
  deletedKeys: string[];
  libraryVersion: number;
}

// ─── OAuth Flow (via Tauri Rust backend) ───

export async function startOAuth(): Promise<void> {
  const result = await invoke<{ authorize_url: string }>("zotero_start_oauth");
  await open(result.authorize_url);
}

export async function completeOAuth(): Promise<ZoteroCredentials> {
  const result = await invoke<{
    api_key: string;
    user_id: string;
    username: string;
  }>("zotero_complete_oauth");
  return {
    apiKey: result.api_key,
    userID: result.user_id,
    username: result.username,
  };
}

export async function cancelOAuth(): Promise<void> {
  await invoke("zotero_cancel_oauth");
}

// ─── Zotero Web API v3 ───

async function zoteroFetch(
  apiKey: string,
  path: string,
  headers?: Record<string, string>,
): Promise<Response> {
  const response = await fetch(`${ZOTERO_BASE}${path}`, {
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": "3",
      ...headers,
    },
  });
  if (!response.ok) {
    if (response.status === 304) return response;
    if (response.status === 403) throw new Error("Invalid or expired API key");
    throw new Error(`Zotero API error: ${response.status}`);
  }
  return response;
}

/** The citation key of a BibTeX entry — the `foo` in `@article{foo, ...}`. */
export function extractCitekey(bibtex: string): string {
  const match = bibtex.match(/@\w+\{([^,\s]+)/);
  return match ? match[1] : "";
}

export async function validateApiKey(
  apiKey: string,
): Promise<ZoteroCredentials> {
  const response = await zoteroFetch(apiKey, "/keys/current");
  const data = await response.json();
  return {
    apiKey,
    userID: String(data.userID),
    username: data.username ?? "",
  };
}

// ─── Collections ───

export async function fetchCollections(
  apiKey: string,
  userID: string,
): Promise<ZoteroCollection[]> {
  const result: ZoteroCollection[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      format: "json",
      limit: String(limit),
      start: String(start),
    });
    const response = await zoteroFetch(
      apiKey,
      `/users/${userID}/collections?${params}`,
    );
    const data = (await response.json()) as {
      key: string;
      data: { key: string; name: string; parentCollection: string | false };
      meta: { numItems: number };
    }[];
    if (data.length === 0) break;

    for (const c of data) {
      result.push({
        key: c.key,
        name: c.data.name,
        parentKey: c.data.parentCollection,
        itemCount: c.meta.numItems,
      });
    }

    if (data.length < limit) break;
    start += limit;
  }

  return result;
}

// ─── Collection Import (full download) ───

/**
 * Fetches all items (with bibtex) across one or more "items/top" endpoints,
 * deduplicating by item key (an item can belong to more than one collection
 * in a subtree, e.g. both a parent and a child collection).
 */
async function fetchItemsFromPaths(
  apiKey: string,
  basePaths: string[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionImportResult> {
  const bibtexByKey = new Map<string, string>();
  const keyMap: Record<string, string> = {};
  let libraryVersion = 0;
  let grandTotal = 0;
  let grandLoaded = 0;

  for (const basePath of basePaths) {
    let start = 0;
    const limit = 100;
    let total = 0;

    while (true) {
      const params = new URLSearchParams({
        format: "json",
        include: "bibtex",
        limit: String(limit),
        start: String(start),
      });
      const response = await zoteroFetch(apiKey, `${basePath}?${params}`);

      if (start === 0) {
        total = Number(response.headers.get("Total-Results") ?? 0);
        grandTotal += total;
      }
      const version = Number(
        response.headers.get("Last-Modified-Version") ?? 0,
      );
      if (version > libraryVersion) libraryVersion = version;

      const items = (await response.json()) as {
        key: string;
        bibtex?: string;
      }[];
      if (items.length === 0) break;

      for (const item of items) {
        const bibtex = item.bibtex ?? "";
        if (!bibtex.trim()) continue;
        if (!bibtexByKey.has(item.key)) {
          const citekey = extractCitekey(bibtex);
          if (citekey) keyMap[item.key] = citekey;
          bibtexByKey.set(item.key, bibtex);
        }
      }

      start += limit;
      grandLoaded += items.length;
      onProgress?.(Math.min(grandLoaded, grandTotal), grandTotal);
      if (start >= total) break;
    }
  }

  return {
    bibtex: Array.from(bibtexByKey.values()).join("\n\n"),
    libraryVersion,
    keyMap,
    totalItems: bibtexByKey.size,
  };
}

/**
 * Import all items from one or more collections (e.g. a collection plus all
 * of its nested subcollections). Pass collectionKeys = null to import the
 * entire "My Library" (all top-level items across the whole library).
 */
export async function importCollection(
  apiKey: string,
  userID: string,
  collectionKeys: string[] | null,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionImportResult> {
  const basePaths = collectionKeys
    ? collectionKeys.map(
        (key) => `/users/${userID}/collections/${key}/items/top`,
      )
    : [`/users/${userID}/items/top`];

  return fetchItemsFromPaths(apiKey, basePaths, onProgress);
}

// ─── Incremental Sync ───

/**
 * Sync changes for one or more collections (a collection plus its
 * subcollections) since lastVersion. collectionKeys = null syncs the entire
 * library.
 *
 * Note: Zotero's `since` param works at the library level (not per-collection),
 * so for collection sync we re-fetch all collection items and diff locally.
 */
export async function syncCollection(
  apiKey: string,
  userID: string,
  collectionKeys: string[] | null,
  lastVersion: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionSyncResult> {
  // For "My Library" (all items), we can use the `since` param
  if (!collectionKeys) {
    return syncFullLibrary(apiKey, userID, lastVersion, onProgress);
  }

  // For a specific collection subtree, re-fetch all items and diff against keyMap
  // (Zotero API doesn't support `since` scoped to a collection)
  const result = await importCollection(
    apiKey,
    userID,
    collectionKeys,
    onProgress,
  );

  return {
    updatedEntries: Object.entries(result.keyMap).map(([key, citekey]) => {
      // Extract the bibtex for this citekey from the full bibtex string
      const bibtexEntries = result.bibtex.split(/\n(?=@)/);
      const entry =
        bibtexEntries.find((e) => extractCitekey(e) === citekey) ?? "";
      return { key, citekey, bibtex: entry };
    }),
    deletedKeys: [],
    libraryVersion: result.libraryVersion,
  };
}

async function syncFullLibrary(
  apiKey: string,
  userID: string,
  lastVersion: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionSyncResult> {
  const updatedEntries: CollectionSyncResult["updatedEntries"] = [];
  let start = 0;
  const limit = 100;
  let total = 0;
  let newVersion = lastVersion;

  while (true) {
    const params = new URLSearchParams({
      since: String(lastVersion),
      format: "json",
      include: "bibtex",
      limit: String(limit),
      start: String(start),
    });
    const response = await zoteroFetch(
      apiKey,
      `/users/${userID}/items/top?${params}`,
    );

    if (start === 0) {
      total = Number(response.headers.get("Total-Results") ?? 0);
      newVersion = Number(
        response.headers.get("Last-Modified-Version") ?? lastVersion,
      );
    }

    const items = (await response.json()) as { key: string; bibtex?: string }[];
    if (items.length === 0) break;

    for (const item of items) {
      const bibtex = item.bibtex ?? "";
      if (!bibtex.trim()) continue;
      const citekey = extractCitekey(bibtex);
      updatedEntries.push({ key: item.key, citekey, bibtex });
    }

    start += limit;
    onProgress?.(Math.min(start, total), total);
    if (start >= total) break;
  }

  // Fetch deleted items
  const deletedResponse = await zoteroFetch(
    apiKey,
    `/users/${userID}/deleted?since=${lastVersion}`,
  );
  const deleted = (await deletedResponse.json()) as { items?: string[] };
  const deletedKeys = deleted.items ?? [];

  if (!newVersion || newVersion === lastVersion) {
    newVersion = Number(
      deletedResponse.headers.get("Last-Modified-Version") ?? lastVersion,
    );
  }

  return { updatedEntries, deletedKeys, libraryVersion: newVersion };
}

// ─── Library Browsing (read-only, for the Quick Reference panel) ───

export interface ZoteroItemSummary {
  key: string;
  title: string;
  creators: string;
  year: string;
}

/** Top-level items (not attachments/notes) in a collection, or the whole library when collectionKey is null. */
export async function fetchLibraryItems(
  apiKey: string,
  userID: string,
  collectionKey: string | null,
): Promise<ZoteroItemSummary[]> {
  const basePath = collectionKey
    ? `/users/${userID}/collections/${collectionKey}/items/top`
    : `/users/${userID}/items/top`;

  const result: ZoteroItemSummary[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      format: "json",
      limit: String(limit),
      start: String(start),
    });
    const response = await zoteroFetch(apiKey, `${basePath}?${params}`);
    const items = (await response.json()) as {
      key: string;
      data: {
        itemType: string;
        title?: string;
        creators?: { lastName?: string; name?: string }[];
        date?: string;
      };
    }[];
    if (items.length === 0) break;

    for (const item of items) {
      if (
        item.data.itemType === "attachment" ||
        item.data.itemType === "note"
      ) {
        continue;
      }
      const creators = (item.data.creators ?? [])
        .map((c) => c.lastName ?? c.name ?? "")
        .filter(Boolean)
        .join(", ");
      result.push({
        key: item.key,
        title: item.data.title || "Untitled",
        creators,
        year: item.data.date ? item.data.date.slice(0, 4) : "",
      });
    }

    if (items.length < limit) break;
    start += limit;
  }

  return result;
}

/**
 * BibTeX for one item, rendered by Zotero's own translator — the same source
 * as a whole-collection import, so an entry added this way is byte-identical
 * to one that would arrive via sync.
 */
export async function fetchItemBibtex(
  apiKey: string,
  userID: string,
  itemKey: string,
): Promise<string> {
  const params = new URLSearchParams({ format: "json", include: "bibtex" });
  const response = await zoteroFetch(
    apiKey,
    `/users/${userID}/items/${itemKey}?${params}`,
  );
  const item = (await response.json()) as { bibtex?: string };
  return (item.bibtex ?? "").trim();
}

/** The first PDF attachment directly under an item, if any. */
export interface ZoteroAttachmentInfo {
  key: string;
  filename: string;
  /**
   * Only "imported_file"/"imported_url" attachments are stored in Zotero's
   * cloud and fetchable via the /file endpoint. "linked_file" attachments
   * just point at a path on the machine that added them, and "linked_url"
   * attachments point at an external URL — neither has bytes Zotero can serve.
   */
  downloadable: boolean;
}

export async function findPdfAttachment(
  apiKey: string,
  userID: string,
  itemKey: string,
): Promise<ZoteroAttachmentInfo | null> {
  const response = await zoteroFetch(
    apiKey,
    `/users/${userID}/items/${itemKey}/children?format=json`,
  );
  const children = (await response.json()) as {
    key: string;
    data: {
      itemType: string;
      contentType?: string;
      filename?: string;
      linkMode?: string;
    };
  }[];
  const pdf = children.find(
    (c) =>
      c.data.itemType === "attachment" &&
      c.data.contentType === "application/pdf",
  );
  if (!pdf) return null;
  return {
    key: pdf.key,
    filename: pdf.data.filename || "document.pdf",
    downloadable:
      pdf.data.linkMode === "imported_file" ||
      pdf.data.linkMode === "imported_url",
  };
}

/** Downloads an attachment's file bytes (follows Zotero's redirect to its storage backend). */
/**
 * Downloads via the Rust backend rather than the webview's fetch(): the /file
 * endpoint redirects to Zotero's storage backend, which is either not covered
 * by — or inconsistently subject to — the webview's CSP connect-src. Rust-side
 * HTTP isn't CSP-governed at all, so this sidesteps the problem entirely.
 */
export async function downloadAttachmentFile(
  apiKey: string,
  userID: string,
  attachmentKey: string,
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("zotero_download_attachment", {
    apiKey,
    userId: userID,
    attachmentKey,
  });
  return new Uint8Array(bytes);
}

export interface ZoteroAnnotation {
  pageIndex: number;
  rects: [number, number, number, number][];
  color: string;
  type: "highlight" | "underline";
}

/** Highlight/underline annotations on a PDF attachment (a "child of a child" —
 * they're nested under the attachment, not the parent bibliographic item). */
export async function fetchAnnotations(
  apiKey: string,
  userID: string,
  attachmentKey: string,
): Promise<ZoteroAnnotation[]> {
  const result: ZoteroAnnotation[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      format: "json",
      limit: String(limit),
      start: String(start),
    });
    const response = await zoteroFetch(
      apiKey,
      `/users/${userID}/items/${attachmentKey}/children?${params}`,
    );
    const children = (await response.json()) as {
      data: {
        itemType: string;
        annotationType?: string;
        annotationColor?: string;
        annotationPosition?: string;
      };
    }[];
    if (children.length === 0) break;

    for (const child of children) {
      if (child.data.itemType !== "annotation") continue;
      const type = child.data.annotationType;
      if (type !== "highlight" && type !== "underline") continue;
      if (!child.data.annotationPosition) continue;
      try {
        const position = JSON.parse(child.data.annotationPosition) as {
          pageIndex: number;
          rects: [number, number, number, number][];
        };
        if (!Array.isArray(position.rects) || position.rects.length === 0) {
          continue;
        }
        result.push({
          pageIndex: position.pageIndex,
          rects: position.rects,
          color: child.data.annotationColor || "#ffd400",
          type,
        });
      } catch {
        // Malformed annotationPosition JSON — skip just this one annotation.
      }
    }

    if (children.length < limit) break;
    start += limit;
  }

  return result;
}
