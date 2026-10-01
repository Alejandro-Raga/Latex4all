import { parseBibRecords, zoteroItemFromBib } from "@/lib/bib-to-zotero";
import { createZoteroItems } from "@/lib/zotero-api";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { useDocumentStore } from "@/stores/document-store";
import { useZoteroStore } from "@/stores/zotero-store";

export interface UploadResult {
  /** Citation key → the new Zotero item's key. */
  added: Map<string, string>;
  /** Citation key → why it couldn't go in. */
  failed: Map<string, string>;
}

/**
 * Puts the papers behind these citation keys into your Zotero library, from
 * the project's .bib entries: for references a collaborator added that you
 * don't have. Each goes into the collection its .bib is synced with, if
 * any, and keeps the citation key the text uses.
 */
export async function addCitekeysToZotero(
  keys: string[],
): Promise<UploadResult> {
  const { apiKey, userID, syncedCollections } = useZoteroStore.getState();
  const { files, projectRoot } = useDocumentStore.getState();
  const added = new Map<string, string>();
  const failed = new Map<string, string>();
  if (!apiKey || !userID) {
    for (const key of keys) failed.set(key, "Zotero isn't connected");
    return { added, failed };
  }

  const synced = Object.entries(
    (projectRoot && syncedCollections[projectRoot]) || {},
  );
  const found = new Map<
    string,
    { item: Record<string, unknown>; bibFile: string }
  >();
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".bib")) continue;
    for (const record of parseBibRecords(f.content ?? "")) {
      if (!keys.includes(record.key) || found.has(record.key)) continue;
      const item = zoteroItemFromBib(record);
      // Into the collection this .bib is kept in step with, if any.
      const collection = synced.find(
        ([, info]) => info.bibFileName === f.name && info.collectionKey,
      )?.[1].collectionKey;
      if (collection) item.collections = [collection];
      found.set(record.key, { item, bibFile: f.name });
    }
  }
  for (const key of keys) {
    if (!found.has(key)) failed.set(key, "not in the bibliography");
  }
  const wanted = [...found.keys()];
  if (!wanted.length) return { added, failed };

  const results = await createZoteroItems(
    apiKey,
    userID,
    wanted.map((k) => (found.get(k) as { item: Record<string, unknown> }).item),
  );
  results.forEach((r, i) => {
    if ("key" in r) added.set(wanted[i], r.key);
    else failed.set(wanted[i], r.error);
  });

  // A synced .bib keeps these under the key the text already uses, rather
  // than the one Zotero would make (see bib-sync.ts).
  if (projectRoot && added.size) {
    useZoteroStore.setState((s) => {
      const project = { ...(s.syncedCollections[projectRoot] ?? {}) };
      for (const [sk, info] of Object.entries(project)) {
        const keyMap = { ...info.keyMap };
        for (const [citekey, itemKey] of added) {
          if (found.get(citekey)?.bibFile === info.bibFileName) {
            keyMap[itemKey] = citekey;
          }
        }
        project[sk] = { ...info, keyMap };
      }
      return {
        syncedCollections: { ...s.syncedCollections, [projectRoot]: project },
      };
    });
  }
  void useZoteroLibrary.getState().sync(apiKey, userID);
  return { added, failed };
}
