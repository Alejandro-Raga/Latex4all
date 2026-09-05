import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  validateApiKey,
  fetchCollections,
  importCollection,
  syncCollection,
  startOAuth,
  completeOAuth,
  cancelOAuth,
  extractCitekey,
  fetchItemBibtex,
  type ZoteroCollection,
} from "@/lib/zotero-api";
import { collectSubtreeKeys } from "@/lib/zotero-collection-tree";
import { useDocumentStore } from "@/stores/document-store";
import { createFileOnDisk, readTexFileContent } from "@/lib/tauri/fs";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("zotero");

/** Default target when a project has no .bib file yet. */
export const DEFAULT_BIB_FILE_NAME = "references.bib";

/**
 * Outcome of adding one Zotero item to a .bib file. `duplicate` is a normal,
 * expected result — citing the same work twice is how bibliographies get used —
 * so it's reported rather than thrown.
 */
export type AddReferenceResult =
  | { status: "added"; citekey: string; fileName: string }
  | { status: "duplicate"; citekey: string; fileName: string }
  | { status: "error"; message: string };

/** Per-collection sync metadata (persisted) */
export interface CollectionSyncInfo {
  collectionKey: string | null; // null = "My Library"
  name: string;
  bibFileName: string;
  libraryVersion: number;
  keyMap: Record<string, string>;
}

/** Synced collections scoped per project path */
type ProjectSyncedCollections = Record<
  string,
  Record<string, CollectionSyncInfo>
>;

interface ZoteroState {
  // Persisted
  apiKey: string | null;
  userID: string | null;
  username: string | null;
  /** Synced collections keyed by projectPath → collectionKey */
  syncedCollections: ProjectSyncedCollections;

  // Transient
  isAuthenticated: boolean;
  isValidating: boolean;
  isSyncing: string | null; // collectionKey currently syncing, or null
  syncProgress: { loaded: number; total: number } | null;
  error: string | null;
  collections: ZoteroCollection[];
  isLoadingCollections: boolean;

  connectWithOAuth: () => Promise<boolean>;
  connectWithApiKey: (apiKey: string) => Promise<boolean>;
  cancelConnect: () => void;
  disconnect: () => void;
  revalidate: () => Promise<void>;
  loadCollections: () => Promise<void>;
  importCollectionToBib: (
    collectionKey: string | null,
    name: string,
  ) => Promise<void>;
  syncCollectionBib: (collectionKey: string | null) => Promise<void>;
  removeCollection: (collectionKey: string | null) => void;
  /**
   * Appends one item's BibTeX to a .bib file in the current project.
   * `targetFileId` names an existing file; `null` creates (or reuses)
   * `references.bib` at the project root.
   */
  addItemToBib: (
    itemKey: string,
    targetFileId: string | null,
  ) => Promise<AddReferenceResult>;
}

const MYLIB_KEY = "__my_library__";
function storeKey(collectionKey: string | null): string {
  return collectionKey ?? MYLIB_KEY;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/** Parse a .bib file into a map of citekey → full entry string */
function parseBibEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  const parts = content.split(/\n(?=@)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/@\w+\{([^,\s]+)/);
    if (match) {
      entries.set(match[1], trimmed);
    }
  }
  return entries;
}

export const useZoteroStore = create<ZoteroState>()(
  persist(
    (set, get) => ({
      apiKey: null,
      userID: null,
      username: null,
      syncedCollections: {},

      isAuthenticated: false,
      isValidating: false,
      isSyncing: null,
      syncProgress: null,
      error: null,
      collections: [],
      isLoadingCollections: false,

      connectWithOAuth: async () => {
        log.info("Starting OAuth connection");
        set({ isValidating: true, error: null });
        try {
          await startOAuth();
          const creds = await completeOAuth();
          log.info(`OAuth connected as ${creds.username}`);
          set({
            apiKey: creds.apiKey,
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
            isValidating: false,
          });
          // Auto-load collections after connecting
          get().loadCollections();
          return true;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Connection failed",
            isValidating: false,
          });
          return false;
        }
      },

      connectWithApiKey: async (apiKey: string) => {
        set({ isValidating: true, error: null });
        try {
          const creds = await validateApiKey(apiKey);
          set({
            apiKey: creds.apiKey,
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
            isValidating: false,
          });
          get().loadCollections();
          return true;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Connection failed",
            isValidating: false,
          });
          return false;
        }
      },

      cancelConnect: () => {
        cancelOAuth().catch(() => {});
        set({ isValidating: false, error: null });
      },

      disconnect: () => {
        set({
          apiKey: null,
          userID: null,
          username: null,
          syncedCollections: {},
          isAuthenticated: false,
          error: null,
          collections: [],
        });
      },

      revalidate: async () => {
        const { apiKey } = get();
        if (!apiKey) return;
        try {
          const creds = await validateApiKey(apiKey);
          log.debug(`Revalidated as ${creds.username}`);
          set({
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
          });
          get().loadCollections();
        } catch (err) {
          log.warn("Revalidation failed", { error: String(err) });
          set({ isAuthenticated: false });
        }
      },

      loadCollections: async () => {
        const { apiKey, userID } = get();
        if (!apiKey || !userID) return;
        set({ isLoadingCollections: true });
        try {
          const collections = await fetchCollections(apiKey, userID);
          log.debug(`Loaded ${collections.length} collections`);
          set({ collections, isLoadingCollections: false });
        } catch (err) {
          log.error("Failed to load collections", { error: String(err) });
          set({ isLoadingCollections: false });
        }
      },

      importCollectionToBib: async (collectionKey, name) => {
        const { apiKey, userID, collections } = get();
        if (!apiKey || !userID) return;

        const docStore = useDocumentStore.getState();
        if (!docStore.projectRoot) return;
        const projectRoot = docStore.projectRoot;

        const sk = storeKey(collectionKey);
        set({ isSyncing: sk, syncProgress: null, error: null });

        try {
          // Pull the collection plus every subcollection nested under it,
          // so items filed only in subfolders aren't silently skipped.
          const collectionKeys = collectionKey
            ? collectSubtreeKeys(collections, collectionKey)
            : null;
          const result = await importCollection(
            apiKey,
            userID,
            collectionKeys,
            (loaded, total) => {
              set({ syncProgress: { loaded, total } });
            },
          );

          // Determine .bib file name
          const bibFileName = `${sanitizeFileName(name)}.bib`;

          // Check if this .bib file already exists in the project
          const existingFile = docStore.files.find(
            (f) => f.name === bibFileName,
          );
          if (existingFile) {
            docStore.updateFileContent(existingFile.id, result.bibtex);
          } else {
            const fullPath = await createFileOnDisk(
              projectRoot,
              bibFileName,
              result.bibtex,
            );
            docStore.addFile({
              name: bibFileName,
              relativePath: bibFileName,
              absolutePath: fullPath,
              type: "bib",
              content: result.bibtex,
            });
          }

          // Store sync info scoped to current project
          const syncInfo: CollectionSyncInfo = {
            collectionKey,
            name,
            bibFileName,
            libraryVersion: result.libraryVersion,
            keyMap: result.keyMap,
          };
          set((s) => {
            const projectColls = s.syncedCollections[projectRoot] ?? {};
            return {
              syncedCollections: {
                ...s.syncedCollections,
                [projectRoot]: { ...projectColls, [sk]: syncInfo },
              },
              isSyncing: null,
              syncProgress: null,
            };
          });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Import failed",
            isSyncing: null,
            syncProgress: null,
          });
        }
      },

      syncCollectionBib: async (collectionKey) => {
        const { apiKey, userID, syncedCollections, collections } = get();
        if (!apiKey || !userID) return;

        const docStore = useDocumentStore.getState();
        if (!docStore.projectRoot) return;
        const projectRoot = docStore.projectRoot;

        const sk = storeKey(collectionKey);
        const projectColls = syncedCollections[projectRoot] ?? {};
        const syncInfo = projectColls[sk];
        if (!syncInfo) return;

        const bibFile = docStore.files.find(
          (f) => f.name === syncInfo.bibFileName,
        );
        if (!bibFile) return;

        set({ isSyncing: sk, syncProgress: null, error: null });

        try {
          const collectionKeys = collectionKey
            ? collectSubtreeKeys(collections, collectionKey)
            : null;
          const result = await syncCollection(
            apiKey,
            userID,
            collectionKeys,
            syncInfo.libraryVersion,
            (loaded, total) => {
              set({ syncProgress: { loaded, total } });
            },
          );

          if (collectionKey) {
            // For specific collections, syncCollection returns a full re-import
            // Rebuild the .bib content from all entries
            const newKeyMap: Record<string, string> = {};
            const entries: string[] = [];
            for (const entry of result.updatedEntries) {
              if (entry.bibtex.trim()) {
                entries.push(entry.bibtex);
                newKeyMap[entry.key] = entry.citekey;
              }
            }
            const updatedContent = `${entries.join("\n\n")}\n`;
            docStore.updateFileContent(bibFile.id, updatedContent);

            set((s) => {
              const pColls = s.syncedCollections[projectRoot] ?? {};
              return {
                syncedCollections: {
                  ...s.syncedCollections,
                  [projectRoot]: {
                    ...pColls,
                    [sk]: {
                      ...syncInfo,
                      libraryVersion: result.libraryVersion,
                      keyMap: newKeyMap,
                    },
                  },
                },
                isSyncing: null,
                syncProgress: null,
              };
            });
          } else {
            // For "My Library", apply incremental diff
            const currentContent = bibFile.content ?? "";
            const entries = parseBibEntries(currentContent);
            const newKeyMap = { ...syncInfo.keyMap };

            for (const entry of result.updatedEntries) {
              const oldCitekey = newKeyMap[entry.key];
              if (oldCitekey && oldCitekey !== entry.citekey) {
                entries.delete(oldCitekey);
              }
              entries.set(entry.citekey, entry.bibtex);
              newKeyMap[entry.key] = entry.citekey;
            }

            for (const deletedKey of result.deletedKeys) {
              const citekey = newKeyMap[deletedKey];
              if (citekey) {
                entries.delete(citekey);
                delete newKeyMap[deletedKey];
              }
            }

            const updatedContent = `${Array.from(entries.values()).join("\n\n")}\n`;
            docStore.updateFileContent(bibFile.id, updatedContent);

            set((s) => {
              const pColls = s.syncedCollections[projectRoot] ?? {};
              return {
                syncedCollections: {
                  ...s.syncedCollections,
                  [projectRoot]: {
                    ...pColls,
                    [sk]: {
                      ...syncInfo,
                      libraryVersion: result.libraryVersion,
                      keyMap: newKeyMap,
                    },
                  },
                },
                isSyncing: null,
                syncProgress: null,
              };
            });
          }
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Sync failed",
            isSyncing: null,
            syncProgress: null,
          });
        }
      },

      addItemToBib: async (itemKey, targetFileId) => {
        const { apiKey, userID } = get();
        if (!apiKey || !userID) {
          return { status: "error", message: "Not connected to Zotero." };
        }

        const docStore = useDocumentStore.getState();
        const projectRoot = docStore.projectRoot;
        if (!projectRoot) {
          return { status: "error", message: "No project is open." };
        }

        let bibtex: string;
        try {
          bibtex = await fetchItemBibtex(apiKey, userID, itemKey);
        } catch (err) {
          return {
            status: "error",
            message:
              err instanceof Error ? err.message : "Zotero request failed",
          };
        }
        if (!bibtex) {
          // Notes and standalone attachments have no bibliographic form.
          return {
            status: "error",
            message: "Zotero has no BibTeX entry for this item.",
          };
        }

        const citekey = extractCitekey(bibtex);
        if (!citekey) {
          return {
            status: "error",
            message: "Could not read a citation key from Zotero's BibTeX.",
          };
        }

        // An explicit target must exist; only the implicit one is created.
        if (targetFileId) {
          const named = docStore.files.find((f) => f.id === targetFileId);
          if (!named) {
            return {
              status: "error",
              message: "That .bib file is no longer in the project.",
            };
          }
        }
        const target = targetFileId
          ? docStore.files.find((f) => f.id === targetFileId)
          : docStore.files.find((f) => f.name === DEFAULT_BIB_FILE_NAME);

        // No .bib file yet — start one rather than making the user create it.
        if (!target) {
          const fileName = DEFAULT_BIB_FILE_NAME;
          const content = `${bibtex}\n`;
          try {
            const absolutePath = await createFileOnDisk(
              projectRoot,
              fileName,
              content,
            );
            docStore.addFile({
              name: fileName,
              relativePath: fileName,
              absolutePath,
              type: "bib",
              content,
            });
          } catch (err) {
            log.error("Failed to create .bib file", { error: String(err) });
            return {
              status: "error",
              message:
                err instanceof Error
                  ? err.message
                  : "Could not create the .bib file",
            };
          }
          log.info(`Added ${citekey} to new ${fileName}`);
          return { status: "added", citekey, fileName };
        }

        // Prefer the editor's copy so unsaved edits aren't clobbered, and fall
        // back to disk for files whose content was never loaded.
        let current = target.content;
        if (current == null) {
          try {
            current = await readTexFileContent(target.absolutePath);
          } catch {
            current = "";
          }
        }

        if (parseBibEntries(current).has(citekey)) {
          return { status: "duplicate", citekey, fileName: target.name };
        }

        const separator = current.trim() ? "\n\n" : "";
        const updated = `${current.trimEnd()}${separator}${bibtex}\n`;
        docStore.updateFileContent(target.id, updated);
        // Autosave is on a 2s timer; a .bib the user just asked for should be
        // on disk before they trigger a compile.
        await docStore.saveFile(target.id);

        log.info(`Added ${citekey} to ${target.name}`);
        return { status: "added", citekey, fileName: target.name };
      },

      removeCollection: (collectionKey) => {
        const projectRoot = useDocumentStore.getState().projectRoot;
        if (!projectRoot) return;

        const sk = storeKey(collectionKey);
        set((s) => {
          const projectColls = s.syncedCollections[projectRoot] ?? {};
          const { [sk]: _, ...rest } = projectColls;
          return {
            syncedCollections: {
              ...s.syncedCollections,
              [projectRoot]: rest,
            },
          };
        });
      },
    }),
    {
      name: "latex4all-zotero",
      partialize: (state) => ({
        apiKey: state.apiKey,
        userID: state.userID,
        username: state.username,
        syncedCollections: state.syncedCollections,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.apiKey) {
          state.isAuthenticated = true;
        }
      },
    },
  ),
);
