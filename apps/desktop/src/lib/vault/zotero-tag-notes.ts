/**
 * Zotero tags as vault notes (the tag manager). A note paired with a Zotero
 * tag records it exactly, `zotero_tag: "…"`, so names that can't be file
 * names still find their tag, and renaming the note in Obsidian doesn't make
 * a new one. The Zotero sync (zotero-sync/) fills it, between the
 * `%% begin zotero %%` markers, with what Zotero has under the tag. Notes
 * paired by an earlier Latex4All had their own markers (TAG_BEGIN, TAG_END);
 * the sync moves them to its own.
 */
import type { LibraryMirror } from "@/lib/zotero-library";
import { zoteroFetch } from "@/lib/zotero-api";
import { BEGIN, END, safeNoteName } from "./paper-note";
import { topicId } from "./topics";
import {
  BUILT_IN_ZOTERO_TAGS,
  type CustomNoteType,
  type VaultNote,
} from "./vault-index";

export const TAG_BEGIN = "%% begin latex4all tag %%";
export const TAG_END = "%% end latex4all tag %%";

/** A note type that pairs with Zotero tags: its kind and tag word. */
export interface TagType {
  kind: string;
  label: string;
  word: string;
}

/** The types with a Zotero tag word: ideas, topics, and your own that have one. */
export function tagTypes(custom: CustomNoteType[]): TagType[] {
  return [
    { kind: "topic", label: "Topic", word: BUILT_IN_ZOTERO_TAGS.topic },
    { kind: "idea", label: "Idea", word: BUILT_IN_ZOTERO_TAGS.idea },
    ...custom
      .filter((t) => t.zoteroTag?.trim())
      .map((t) => ({
        kind: t.id,
        label: t.label,
        word: (t.zoteroTag as string).trim(),
      })),
  ];
}

/** A tag in the "word: name" form of one of these types, read apart. */
export function parseTag(
  tag: string,
  types: TagType[],
): { type: TagType; name: string } | null {
  const m = tag.match(/^\s*([^:/]+?)\s*[:/]\s*(.+?)\s*$/);
  if (!m) return null;
  const type = types.find((t) => t.word.toLowerCase() === m[1].toLowerCase());
  return type ? { type, name: m[2] } : null;
}

/** Large enough that importing it is worth a second thought. */
export const BIG_TAG = 40;

/** A highlight under the tag, with its paper and PDF. */
export interface TagPassage {
  paper: string;
  attachment: string;
  key: string;
  text: string;
  comment: string;
  page: string;
  pageIndex: number | null;
}

export interface TagMembers {
  /** Zotero keys of the papers under the tag (or with a highlight under it). */
  papers: string[];
  passages: TagPassage[];
}

interface ApiItem {
  key: string;
  data: {
    itemType: string;
    parentItem?: string;
    annotationType?: string;
    annotationText?: string;
    annotationComment?: string;
    annotationPageLabel?: string;
    annotationPosition?: string;
  };
}

/** What Zotero has under a tag: the papers, and the highlights. */
export async function fetchTagMembers(
  apiKey: string,
  userID: string,
  tag: string,
  mirror: LibraryMirror | null,
): Promise<TagMembers> {
  const items: ApiItem[] = [];
  for (let start = 0; ; start += 100) {
    const params = new URLSearchParams({
      tag,
      limit: "100",
      start: String(start),
    });
    const page = (await (
      await zoteroFetch(apiKey, `/users/${userID}/items?${params}`)
    ).json()) as ApiItem[];
    items.push(...page);
    if (page.length < 100) break;
  }
  // A highlight's paper is its PDF's parent.
  const parentOf = async (key: string): Promise<string | null> => {
    const known = mirror?.attachments[key]?.parent;
    if (known) return known;
    try {
      const item = (await (
        await zoteroFetch(apiKey, `/users/${userID}/items/${key}`)
      ).json()) as ApiItem;
      return item.data.parentItem ?? null;
    } catch {
      return null;
    }
  };
  const papers = new Set<string>();
  const passages: TagPassage[] = [];
  for (const item of items) {
    const d = item.data;
    if (d.itemType === "annotation") {
      const attachment = d.parentItem;
      const paper = attachment ? await parentOf(attachment) : null;
      if (!attachment || !paper) continue;
      papers.add(paper);
      if (!d.annotationText?.trim()) continue;
      let pageIndex: number | null = null;
      try {
        pageIndex = JSON.parse(d.annotationPosition ?? "{}").pageIndex ?? null;
      } catch {
        pageIndex = null;
      }
      passages.push({
        paper,
        attachment,
        key: item.key,
        text: d.annotationText,
        comment: d.annotationComment ?? "",
        page:
          d.annotationPageLabel ??
          (pageIndex !== null ? String(pageIndex + 1) : ""),
        pageIndex,
      });
    } else if (d.itemType === "note" || d.itemType === "attachment") {
      if (d.parentItem) papers.add(d.parentItem);
    } else {
      papers.add(item.key);
    }
  }
  return { papers: [...papers], passages };
}

/** A frontmatter field removed, the rest of the note as it was. */
export function withoutField(text: string, key: string): string {
  if (!text.startsWith("---\n")) return text;
  const close = text.indexOf("\n---", 4);
  if (close < 0) return text;
  const head = text
    .slice(4, close)
    .split("\n")
    .filter((l) => !l.startsWith(`${key}:`))
    .join("\n");
  return `---\n${head}${text.slice(close)}`;
}

/** A frontmatter field set (or added), the rest of the note as it was. */
export function withField(text: string, key: string, value: string): string {
  const line = `${key}: ${JSON.stringify(value)}`;
  if (!text.startsWith("---\n")) return `---\n${line}\n---\n${text}`;
  const close = text.indexOf("\n---", 4);
  if (close < 0) return `---\n${line}\n---\n${text}`;
  const head = text.slice(4, close);
  const re = new RegExp(`^${key}:.*$`, "m");
  const next = re.test(head) ? head.replace(re, line) : `${head}\n${line}`;
  return `---\n${next}${text.slice(close)}`;
}

/** The Zotero tag a note is paired with, if any. */
export function pairedTag(n: VaultNote): string | null {
  const v = n.frontmatter.zotero_tag;
  return typeof v === "string" && v.trim() ? v : null;
}

/** A new note for a tag, of a type. */
export function newTagNote(
  type: { kind: string; label: string; obsidianTag?: string },
  name: string,
  tag: string,
  today: string,
): string {
  const kindTag =
    type.kind === "topic" || type.kind === "idea"
      ? type.kind
      : type.obsidianTag?.replace(/^#/, "") || null;
  const front = [
    "---",
    ...(kindTag ? ["tags:", `- ${kindTag}`] : []),
    `created: '${today}'`,
    ...(type.kind === "topic" || type.kind === "idea"
      ? [`zotero_${type.kind}: ${topicId(name)}`]
      : []),
    `zotero_tag: ${JSON.stringify(tag)}`,
    "---",
  ];
  const own =
    type.kind === "topic"
      ? "## Definition"
      : type.kind === "idea"
        ? "## The idea"
        : `## About this ${type.label.toLowerCase()}`;
  return [...front, own, "", "", BEGIN, END, "", "## My notes", "", ""].join(
    "\n",
  );
}

/** The note name a tag gets: its name part for a typed tag, else the tag. */
export function noteNameFor(tag: string, types: TagType[]): string {
  return safeNoteName(parseTag(tag, types)?.name ?? tag) || "Untitled";
}
