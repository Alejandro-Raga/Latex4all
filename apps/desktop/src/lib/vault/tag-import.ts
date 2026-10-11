/**
 * The tag manager's work: Zotero's tags as you made them (its automatic ones
 * left out), what each is paired with in the vault, importing chosen tags as
 * notes of a type, and keeping paired notes up to date. Only the vault is
 * written; Zotero is read. See zotero-tag-notes.ts for the notes themselves.
 */
import { zoteroFetch } from "@/lib/zotero-api";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { kindFolder } from "./kind-folders";
import { chooseNoteKind } from "./note-changes";
import type { VaultIndex, VaultNote } from "./vault-index";
import {
  fetchTagMembers,
  newTagNote,
  outsideTagSection,
  pairedTag,
  TAG_BEGIN,
  type TagMembers,
  type TagType,
  tagSection,
  withField,
  withTagSection,
} from "./zotero-tag-notes";

export interface ZoteroTag {
  tag: string;
  /** Items carrying it: papers, highlights and notes. */
  count: number;
}

/** Zotero's tags as you made them, and how many automatic ones were left out. */
export async function listZoteroTags(): Promise<{
  tags: ZoteroTag[];
  automatic: number;
}> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) throw new Error("Connect Zotero first.");
  const tags: ZoteroTag[] = [];
  let automatic = 0;
  for (let start = 0; ; start += 100) {
    const page = (await (
      await zoteroFetch(
        apiKey,
        `/users/${userID}/tags?limit=100&start=${start}`,
      )
    ).json()) as { tag: string; meta?: { type?: number; numItems?: number } }[];
    for (const t of page) {
      if (t.meta?.type === 1) automatic++;
      else tags.push({ tag: t.tag, count: t.meta?.numItems ?? 0 });
    }
    if (page.length < 100) break;
  }
  tags.sort((a, b) => a.tag.localeCompare(b.tag));
  return { tags, automatic };
}

/**
 * What a tag is paired with in the vault now. A note of the same type and
 * name that isn't paired yet (made by "Add to idea", or by a Zotero sync) is
 * paired on import: its section only adds what the note doesn't show, so
 * nothing is written twice.
 */
export type TagStatus =
  | { state: "linked"; note: VaultNote }
  | { state: "free" };

export function tagStatus(tag: string, index: VaultIndex): TagStatus {
  const linked = index.list.find((n) => pairedTag(n) === tag);
  return linked ? { state: "linked", note: linked } : { state: "free" };
}

export interface ImportChoice {
  tag: string;
  type: TagType;
  name: string;
}

/** What an import will do, before it does it. */
export interface ImportPreview {
  choice: ImportChoice;
  /** A note of that type and name is there already: it's paired, not made. */
  existing: VaultNote | null;
  members: TagMembers;
}

export async function previewImport(
  choices: ImportChoice[],
): Promise<ImportPreview[]> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) throw new Error("Connect Zotero first.");
  await useVaultStore.getState().ensureVault();
  const index = useVaultStore.getState().index;
  if (!index) throw new Error("Connect your vault first.");
  const mirror = useZoteroLibrary.getState().mirror;
  const out: ImportPreview[] = [];
  for (const choice of choices) {
    const existing =
      index.list.find((n) => pairedTag(n) === choice.tag) ??
      index.list.find(
        (n) =>
          n.kind === choice.type.kind &&
          n.name.toLowerCase() === choice.name.toLowerCase(),
      ) ??
      null;
    out.push({
      choice,
      existing,
      members: await fetchTagMembers(apiKey, userID, choice.tag, mirror),
    });
  }
  return out;
}

/** Imports what was previewed: makes or pairs each note, and fills its section. */
export async function runImport(
  previews: ImportPreview[],
  onProgress?: (done: number) => void,
): Promise<string[]> {
  const vault = useVaultStore.getState();
  const { source } = vault;
  if (!source) throw new Error("Connect your vault first.");
  const mirror = useZoteroLibrary.getState().mirror;
  const today = new Date().toISOString().slice(0, 10);
  const made: string[] = [];
  for (const [i, { choice, existing, members }] of previews.entries()) {
    const index = useVaultStore.getState().index as VaultIndex;
    let path: string;
    let text: string;
    let version: string | null | undefined;
    if (existing) {
      path = existing.path;
      const read = await source.readNote(path);
      text = withField(read.text, "zotero_tag", choice.tag);
      version = read.version;
    } else {
      const folder = kindFolder(choice.type.kind);
      path = folder ? `${folder}/${choice.name}.md` : `${choice.name}.md`;
      const custom = useVaultStore
        .getState()
        .noteTypes[vaultKey()]?.find((t) => t.id === choice.type.kind);
      text = newTagNote(
        {
          kind: choice.type.kind,
          label: choice.type.label,
          obsidianTag: custom?.tag,
        },
        choice.name,
        choice.tag,
        today,
      );
      version = undefined;
    }
    const section = tagSection(
      choice.tag,
      members,
      index,
      mirror,
      outsideTagSection(text),
    );
    text = withTagSection(text, section);
    if (existing) await source.writeNote(path, text, version);
    else await source.createNote(path, text);
    useVaultStore.getState().noteWritten(path, text);
    // A type of your own with no folder or tag to find it by: chosen by hand.
    if (
      !existing &&
      choice.type.kind !== "topic" &&
      choice.type.kind !== "idea"
    ) {
      await chooseNoteKind(choice.name, choice.type.kind).catch(() => null);
    }
    made.push(choice.name);
    onProgress?.(i + 1);
  }
  return made;
}

function vaultKey() {
  const s = useVaultStore.getState();
  return s.mode === "server" ? "server" : (s.vaultPath ?? "");
}

let refreshing = false;

/**
 * Brings every note the tag manager made or paired up to date with Zotero:
 * its section, and nothing else. Writes only the notes whose section
 * changed. Returns how many it wrote.
 */
export async function refreshPairedNotes(): Promise<number> {
  if (refreshing) return 0;
  const { apiKey, userID } = useZoteroStore.getState();
  const { source, index } = useVaultStore.getState();
  if (!apiKey || !userID || !source || !index) return 0;
  refreshing = true;
  let written = 0;
  try {
    const mirror = useZoteroLibrary.getState().mirror;
    for (const note of index.list) {
      const tag = pairedTag(note);
      if (!tag || !note.body.includes(TAG_BEGIN)) continue;
      const members = await fetchTagMembers(apiKey, userID, tag, mirror);
      const read = await source.readNote(note.path);
      const now = useVaultStore.getState().index ?? index;
      const next = withTagSection(
        read.text,
        tagSection(tag, members, now, mirror, outsideTagSection(read.text)),
      );
      if (next === read.text) continue;
      await source.writeNote(note.path, next, read.version);
      useVaultStore.getState().noteWritten(note.path, next);
      written++;
    }
  } finally {
    refreshing = false;
  }
  return written;
}
