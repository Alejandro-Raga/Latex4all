/**
 * A highlight filed under an idea or a topic: the passage, word for word,
 * goes into that note, with its way back to the paper and the PDF. Written
 * the way the vault's Zotero sync writes them (`idea: <name>` / `topic:
 * <name>` tags, between the `%% begin zotero %%` markers), so a vault with
 * that sync and one without end up with the same note.
 */
import { addZoteroTag } from "@/lib/zotero-api";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { addPaperToVault } from "./add-paper";
import { kindFolder } from "./kind-folders";
import { NoteExistsError } from "./load";
import { BEGIN, cleanHighlight, END, safeNoteName } from "./paper-note";
import { paperLine, topicId } from "./topics";
import { findNote, type VaultNote } from "./vault-index";

export type PassageGroup = "idea" | "topic";

export interface Passage {
  /** The Zotero item (the paper) and its PDF attachment. */
  itemKey: string;
  attachmentKey: string;
  /** The highlight's own key. */
  annotationKey: string;
  text: string;
  comment?: string;
  pageLabel?: string;
  pageIndex?: number;
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/** The passage as the sync writes it: quote, links back, comment. */
export function passageMarkdown(paperName: string, p: Passage): string {
  const page =
    p.pageLabel || (p.pageIndex !== undefined ? String(p.pageIndex + 1) : "");
  const label = page ? `${paperName}, p. ${page}` : paperName;
  const query = `${p.pageIndex !== undefined ? `page=${p.pageIndex + 1}&` : ""}annotation=${p.annotationKey}`;
  const lines = [
    quote(cleanHighlight(p.text)),
    `> — [[${paperName}#^${p.annotationKey.toLowerCase()}|${label}]] · [PDF](zotero://open-pdf/library/items/${p.attachmentKey}?${query})`,
  ];
  if (p.comment?.trim()) lines.push("", p.comment.trim());
  return lines.join("\n");
}

/** A new idea or topic note, the sync's way. */
export function newGroupNote(
  group: PassageGroup,
  name: string,
  today: string,
): string {
  return [
    "---",
    "tags:",
    `- ${group}`,
    `created: '${today}'`,
    `zotero_${group}: ${topicId(name)}`,
    "---",
    group === "topic" ? "## Definition" : "## The idea",
    "",
    "",
    BEGIN,
    "## Literature",
    "",
    END,
    "",
    "## My notes",
    "",
    "",
  ].join("\n");
}

/**
 * The note with the paper in its Literature and the passage under the
 * paper's heading (once: a passage already there isn't added again).
 */
export function withPassage(
  noteText: string,
  paper: VaultNote,
  annotationKey: string,
  markdown: string,
): string {
  let text = noteText;
  if (!text.includes(BEGIN) || !text.includes(END)) {
    // A note written by hand: the list goes below what's there.
    text = `${text.replace(/\s*$/, "")}\n\n${BEGIN}\n## Literature\n\n${END}\n`;
  }
  const begin = text.indexOf(BEGIN) + BEGIN.length;
  const end = text.indexOf(END, begin);
  let block = text.slice(begin, end);
  if (block.includes(`annotation=${annotationKey}`)) return noteText;

  const link = `[[${paper.name}]]`;
  const literature = /## Literature\n/.exec(block);
  if (!block.includes(`- ${link}`)) {
    if (literature) {
      // At the end of the list: the line before the next heading or the end.
      const after = literature.index + literature[0].length;
      const next = block.slice(after).search(/\n## /);
      const at = next < 0 ? block.length : after + next;
      const list = block.slice(after, at).replace(/\s*$/, "");
      block = `${block.slice(0, after)}${list ? `${list}\n` : "\n"}${paperLine(paper)}\n${block.slice(at)}`;
    } else {
      block = `\n## Literature\n\n${paperLine(paper)}\n${block}`;
    }
  }
  if (!/## Passages\n/.test(block)) {
    block = `${block.replace(/\s*$/, "")}\n\n## Passages\n`;
  }
  const heading = `### ${link}`;
  const at = block.indexOf(heading);
  if (at < 0) {
    block = `${block.replace(/\s*$/, "")}\n\n${heading} ${paper.title}\n\n${markdown}\n`;
  } else {
    // Under its paper: before the next paper's heading, or the end.
    const lineEnd = block.indexOf("\n", at);
    const next = block.slice(lineEnd).search(/\n### /);
    const insertAt = next < 0 ? block.length : lineEnd + next;
    const before = block.slice(0, insertAt).replace(/\s*$/, "");
    block = `${before}\n\n${markdown}\n${block.slice(insertAt)}`;
  }
  if (!block.endsWith("\n")) block += "\n";
  return `${text.slice(0, begin)}${block.startsWith("\n") ? "" : "\n"}${block}${text.slice(end)}`;
}

/**
 * Files a highlight under an idea or a topic: tags it in Zotero (for a sync
 * to see), puts the paper in the vault (refreshing its note, so the link to
 * the highlight finds it), and adds the passage to the note, creating the
 * note if it's new. Returns the note's name.
 */
export async function addPassage(
  group: PassageGroup,
  name: string,
  passage: Passage,
): Promise<string> {
  const { apiKey, userID } = useZoteroStore.getState();
  const vault = useVaultStore.getState();
  await vault.ensureVault();
  const { source } = useVaultStore.getState();
  if (!source) throw new Error("Connect your vault first.");
  const noteName = safeNoteName(name);
  if (!noteName) throw new Error("Give it a name.");

  if (apiKey && userID) {
    await addZoteroTag(
      apiKey,
      userID,
      passage.annotationKey,
      `${group}: ${noteName}`,
    ).catch(() => {});
  }
  const { name: paperName } = await addPaperToVault(passage.itemKey);
  // The index already has the paper note just written (noteWritten).
  const index = useVaultStore.getState().index;
  const paper = index ? findNote(index, paperName) : undefined;
  if (!paper) throw new Error("The paper's note couldn't be found.");
  const markdown = passageMarkdown(paper.name, passage);

  const existing = index ? findNote(index, noteName) : undefined;
  if (existing) {
    const current = await source.readNote(existing.path);
    const next = withPassage(
      current.text,
      paper,
      passage.annotationKey,
      markdown,
    );
    if (next !== current.text) {
      await source.writeNote(existing.path, next, current.version);
      useVaultStore.getState().noteWritten(existing.path, next);
    }
    return existing.name;
  }
  const folder = kindFolder(group);
  const path = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;
  const today = new Date().toISOString().slice(0, 10);
  const text = withPassage(
    newGroupNote(group, noteName, today),
    paper,
    passage.annotationKey,
    markdown,
  );
  try {
    await source.createNote(path, text);
  } catch (err) {
    if (!(err instanceof NoteExistsError)) throw err;
    const current = await source.readNote(path);
    const next = withPassage(
      current.text,
      paper,
      passage.annotationKey,
      markdown,
    );
    await source.writeNote(path, next, current.version);
    useVaultStore.getState().noteWritten(path, next);
    return noteName;
  }
  useVaultStore.getState().noteWritten(path, text);
  return noteName;
}
