/**
 * Zotero tags as vault notes (the tag manager). A note paired with a Zotero
 * tag records it exactly, `zotero_tag: "…"`, so names that can't be file
 * names still find their tag, and renaming the note in Obsidian doesn't make
 * a new one. What Zotero has under the tag — the papers, and the highlights
 * — goes into the note's own section, between Latex4All's markers:
 *
 *   %% begin latex4all tag %% … %% end latex4all tag %%
 *
 * only what the rest of the note doesn't show already. So a passage added
 * with "Add to idea", or written by a Zotero-to-Obsidian sync in its own
 * section, isn't repeated, and nothing outside the markers is touched.
 * Zotero itself is only read. Papers without a note are listed, not given
 * notes of their own, so a tag on hundreds of papers doesn't make hundreds of
 * notes. The text depends only on what Zotero has, so two computers write the
 * same note.
 */
import type { LibraryMirror } from "@/lib/zotero-library";
import { zoteroFetch } from "@/lib/zotero-api";
import { safeNoteName } from "./paper-note";
import { topicId } from "./topics";
import {
  BUILT_IN_ZOTERO_TAGS,
  type CustomNoteType,
  type VaultIndex,
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

/** Tags that say where a paper stands rather than what it's about. */
const STATUS =
  /^(read|unread|to ?read|re-?read|reading|must read|done|todo|to do|obsidian|favou?rites?|important|print|skim(med)?|from:.*)$/i;
export const looksLikeStatus = (tag: string) => STATUS.test(tag.trim());

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

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/**
 * The note's own section for the tag: the papers and highlights Zotero has
 * under it that the rest of the note (`elsewhere`) doesn't show already.
 */
export function tagSection(
  tag: string,
  members: TagMembers,
  index: VaultIndex,
  mirror: LibraryMirror | null,
  elsewhere: string,
): string {
  const noteOf = new Map(
    index.list
      .filter((n) => n.kind === "paper" && n.zoteroKey)
      .map((n) => [n.zoteroKey as string, n]),
  );
  const shown = (paper: string) => {
    const note = noteOf.get(paper);
    return (
      elsewhere.includes(`items/${paper}`) ||
      (note !== undefined && elsewhere.includes(`[[${note.name}`))
    );
  };
  const info = (paper: string) => {
    const item = mirror?.items[paper];
    const note = noteOf.get(paper);
    return {
      note,
      title: note?.title ?? item?.title ?? "Untitled",
      year: note?.year ?? item?.year ?? "",
    };
  };
  const order = (a: string, b: string) => {
    const x = info(a);
    const y = info(b);
    return (
      (x.year || "9999").localeCompare(y.year || "9999") ||
      x.title.localeCompare(y.title) ||
      a.localeCompare(b)
    );
  };

  const literature = members.papers
    .filter((p) => !shown(p))
    .sort(order)
    .map((p) => {
      const { note, title, year } = info(p);
      const when = year ? ` (${year})` : "";
      return note
        ? `- [[${note.name}]]${note.title !== note.name ? ` ${note.title}` : ""}${when}`
        : `- ${title}${when} · [Zotero](zotero://select/library/items/${p})`;
    });

  const passages = members.passages.filter(
    (p) => !elsewhere.includes(`annotation=${p.key}`),
  );
  const byPaper = new Map<string, TagPassage[]>();
  for (const p of passages)
    byPaper.set(p.paper, [...(byPaper.get(p.paper) ?? []), p]);
  const blocks: string[] = [];
  for (const paper of [...byPaper.keys()].sort(order)) {
    const { note, title } = info(paper);
    blocks.push(
      note ? `### [[${note.name}]] ${note.title}` : `### ${title}`,
      "",
    );
    const list = (byPaper.get(paper) ?? []).sort(
      (a, b) =>
        (a.pageIndex ?? 0) - (b.pageIndex ?? 0) || a.key.localeCompare(b.key),
    );
    for (const p of list) {
      const query = `${p.pageIndex !== null ? `page=${p.pageIndex + 1}&` : ""}annotation=${p.key}`;
      const pdf = `[PDF](zotero://open-pdf/library/items/${p.attachment}?${query})`;
      const where = note
        ? `[[${note.name}#^${p.key.toLowerCase()}|${note.name}${p.page ? `, p. ${p.page}` : ""}]] · ${pdf}`
        : `${p.page ? `p. ${p.page} · ` : ""}${pdf}`;
      blocks.push(quote(p.text), `> — ${where}`);
      if (p.comment.trim()) blocks.push("", p.comment.trim());
      blocks.push("");
    }
  }

  const out = [TAG_BEGIN];
  if (literature.length || blocks.length) {
    out.push(`*From Zotero, tagged “${tag}”:*`, "");
    if (literature.length) out.push("## Literature", "", ...literature, "");
    if (blocks.length) out.push("## Passages", "", ...blocks);
  }
  out.push(TAG_END);
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The note with its section replaced, or added before "## My notes" (or at the end). */
export function withTagSection(text: string, section: string): string {
  const begin = text.indexOf(TAG_BEGIN);
  const end = text.indexOf(TAG_END, begin + 1);
  if (begin >= 0 && end > begin) {
    return text.slice(0, begin) + section + text.slice(end + TAG_END.length);
  }
  const mine = text.search(/^## My notes\s*$/m);
  if (mine >= 0) {
    return `${text.slice(0, mine)}${section}\n\n${text.slice(mine)}`;
  }
  return `${text.replace(/\s*$/, "")}\n\n${section}\n`;
}

/** The note without its section: what it shows besides. */
export function outsideTagSection(text: string): string {
  const begin = text.indexOf(TAG_BEGIN);
  const end = text.indexOf(TAG_END, begin + 1);
  return begin >= 0 && end > begin
    ? text.slice(0, begin) + text.slice(end + TAG_END.length)
    : text;
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
  return [
    ...front,
    own,
    "",
    "",
    TAG_BEGIN,
    TAG_END,
    "",
    "## My notes",
    "",
    "",
  ].join("\n");
}

/** The note name a tag gets: its name part for a typed tag, else the tag. */
export function noteNameFor(tag: string, types: TagType[]): string {
  return safeNoteName(parseTag(tag, types)?.name ?? tag) || "Untitled";
}
