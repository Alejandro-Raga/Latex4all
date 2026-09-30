/**
 * Puts Zotero papers in the vault as literature notes (see paper-note.ts),
 * in the folder the vault already keeps its paper notes in, and tags them in
 * Zotero so any Zotero → Obsidian sync keeps them up to date.
 */
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import {
  addZoteroTag,
  extractCitekey,
  fetchItemBibtex,
  zoteroFetch,
} from "../zotero-api";
import { noteForCitekey } from "./cite-link";
import { NoteExistsError } from "./load";
import {
  type PaperAnnotation,
  type PaperData,
  type PaperFields,
  paperNoteText,
  paperYear,
  safeNoteName,
} from "./paper-note";
import type { VaultIndex } from "./vault-index";

const DEFAULT_PAPERS_FOLDER = "Papers";

/**
 * Where paper notes go: the folder set in Settings, or the one holding most
 * of the vault's paper notes now, or "Papers".
 */
export function papersFolderOf(index: VaultIndex | null, chosen: string) {
  if (chosen) return chosen;
  const counts = new Map<string, number>();
  for (const n of index?.list ?? []) {
    if (n.kind !== "paper") continue;
    const dir = n.path.split("/").slice(0, -1).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best = DEFAULT_PAPERS_FOLDER;
  let most = 0;
  for (const [dir, count] of counts) {
    if (count > most) {
      best = dir;
      most = count;
    }
  }
  return best;
}

/** A paper's fields, its PDF and the highlights on it, from Zotero. */
export async function fetchPaperData(
  apiKey: string,
  userID: string,
  itemKey: string,
): Promise<PaperData> {
  const item = (await (
    await zoteroFetch(apiKey, `/users/${userID}/items/${itemKey}?format=json`)
  ).json()) as { data: PaperFields };
  const children = (await (
    await zoteroFetch(
      apiKey,
      `/users/${userID}/items/${itemKey}/children?format=json&limit=100`,
    )
  ).json()) as {
    key: string;
    data: { itemType: string; contentType?: string; linkMode?: string };
  }[];
  const pdfs = children.filter(
    (c) =>
      c.data.itemType === "attachment" &&
      c.data.contentType === "application/pdf",
  );
  const pdf =
    pdfs.find((c) => c.data.linkMode?.startsWith("imported")) ?? pdfs[0];
  const annotations: PaperAnnotation[] = [];
  if (pdf) {
    for (let start = 0; ; start += 100) {
      const page = (await (
        await zoteroFetch(
          apiKey,
          `/users/${userID}/items/${pdf.key}/children?format=json&limit=100&start=${start}`,
        )
      ).json()) as {
        key: string;
        data: {
          itemType: string;
          annotationType?: string;
          annotationText?: string;
          annotationComment?: string;
          annotationColor?: string;
          annotationPageLabel?: string;
          annotationPosition?: string;
          annotationSortIndex?: string;
        };
      }[];
      for (const { key, data: d } of page) {
        if (d.itemType !== "annotation") continue;
        let pageIndex: number | undefined;
        try {
          pageIndex = JSON.parse(d.annotationPosition ?? "{}").pageIndex;
        } catch {
          pageIndex = undefined;
        }
        annotations.push({
          key,
          type: d.annotationType ?? "highlight",
          text: d.annotationText,
          comment: d.annotationComment,
          color: d.annotationColor,
          pageLabel: d.annotationPageLabel,
          pageIndex,
          sortIndex: d.annotationSortIndex,
        });
      }
      if (page.length < 100) break;
    }
  }
  return {
    key: itemKey,
    fields: item.data,
    pdfKey: pdf?.key ?? null,
    annotations,
  };
}

export type AddPaperResult =
  | { status: "created" | "updated"; name: string }
  /** A note of its own (another plugin's): left as it is. */
  | { status: "exists"; name: string };

/**
 * Adds a Zotero paper to the vault, or refreshes its note. `citekey` names
 * the note (the key the project cites it by); without one, Zotero's own.
 */
export async function addPaperToVault(
  itemKey: string,
  citekey?: string,
): Promise<AddPaperResult> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) throw new Error("Connect Zotero first.");
  const vault = useVaultStore.getState();
  await vault.ensureVault();
  const { source, index, papersFolder, paperTag } = useVaultStore.getState();
  if (!source) throw new Error("Connect your vault first.");

  const paper = await fetchPaperData(apiKey, userID, itemKey);
  const found =
    index?.list.find((n) => n.zoteroKey === itemKey) ??
    (citekey && index
      ? noteForCitekey(index, citekey, new Map([[citekey, itemKey]]))
      : undefined);
  const key =
    citekey ??
    found?.citekey ??
    (await fetchItemBibtex(apiKey, userID, itemKey)
      .then(extractCitekey)
      .catch(() => "")) ??
    "";
  const name = safeNoteName(
    key ||
      `${paper.fields.creators?.[0]?.lastName ?? "Anon"}${paperYear(paper.fields)}`,
  );

  const write = async (
    path: string,
    existing: { text: string; version: string | null } | null,
  ) => {
    const text = paperNoteText(paper, key || name, existing?.text ?? null);
    if (text === null) return null;
    if (existing) {
      if (text !== existing.text) {
        await source.writeNote(path, text, existing.version);
        useVaultStore.getState().noteWritten(path, text);
      }
    } else {
      await source.createNote(path, text);
      useVaultStore.getState().noteWritten(path, text);
    }
    return text;
  };

  let result: AddPaperResult;
  if (found) {
    const existing = await source.readNote(found.path);
    result = (await write(found.path, existing))
      ? { status: "updated", name: found.name }
      : { status: "exists", name: found.name };
  } else {
    const folder = papersFolderOf(index, papersFolder);
    const path = folder ? `${folder}/${name}.md` : `${name}.md`;
    try {
      await write(path, null);
      result = { status: "created", name };
    } catch (err) {
      if (!(err instanceof NoteExistsError)) throw err;
      const existing = await source.readNote(path);
      result = (await write(path, existing))
        ? { status: "updated", name }
        : { status: "exists", name };
    }
  }

  // So a Zotero → Obsidian sync, if there is one, keeps the note current.
  await addZoteroTag(apiKey, userID, itemKey, paperTag || "obsidian").catch(
    () => {},
  );
  return result;
}
