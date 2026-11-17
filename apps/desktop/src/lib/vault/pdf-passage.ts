/**
 * A highlight in a PDF on this computer (a project's draft, not in Zotero)
 * quoted in a vault note: under the PDF's name, with its page, its comment,
 * and a link that opens the PDF at that highlight.
 */
import { latex4allLink } from "@/lib/deep-link";
import { useVaultStore } from "@/stores/vault-store";
import {
  newGroupNote,
  type PassageGroup,
  withPassageFrom,
} from "./add-passage";
import { kindFolder } from "./kind-folders";
import { NoteExistsError } from "./load";
import { cleanHighlight, safeNoteName } from "./paper-note";
import { findNote } from "./vault-index";

export interface PdfPassage {
  /** The PDF's full path. */
  path: string;
  /** The highlight's own key (local-…). */
  key: string;
  text: string;
  comment?: string;
  /** 1-based. */
  page?: number;
}

const split = (path: string) => {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { folder: path.slice(0, at), file: path.slice(at + 1) };
};

/** The PDF's name as the note shows it. */
export const pdfTitle = (path: string) =>
  split(path).file.replace(/\.pdf$/i, "");

/** The passage as written in the note: quote, link back, comment. */
export function pdfPassageMarkdown(p: PdfPassage): string {
  const { folder, file } = split(p.path);
  const link = latex4allLink({
    project: folder,
    file,
    page: p.page,
    annotation: p.key,
  });
  const label = `${pdfTitle(p.path)}${p.page ? `, p. ${p.page}` : ""}`;
  const quote = cleanHighlight(p.text)
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
  const lines = [`${quote}\n> — [${label}](${link})`];
  if (p.comment?.trim()) lines.push("", p.comment.trim());
  return lines.join("\n");
}

/**
 * Quotes the highlight in a note (made, as an idea or topic, if it's new).
 * Returns the note's name.
 */
export async function addPdfPassage(
  group: PassageGroup,
  name: string,
  passage: PdfPassage,
): Promise<string> {
  await useVaultStore.getState().ensureVault();
  const { source, index } = useVaultStore.getState();
  if (!source || !index) throw new Error("Connect your vault first.");
  const noteName = safeNoteName(name);
  if (!noteName) throw new Error("Give it a name.");
  const heading = pdfTitle(passage.path);
  const from = { heading, headingKey: `### ${heading}`, literature: null };
  const marker = `annotation=${passage.key}`;
  const markdown = pdfPassageMarkdown(passage);
  const write = async (
    path: string,
    current: { text: string; version: unknown },
  ) => {
    const next = withPassageFrom(current.text, from, marker, markdown);
    if (next !== current.text) {
      await source.writeNote(path, next, current.version as never);
      useVaultStore.getState().noteWritten(path, next);
    }
  };
  const existing = findNote(index, noteName);
  if (existing) {
    await write(existing.path, await source.readNote(existing.path));
    return existing.name;
  }
  const folder = kindFolder(group);
  const path = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;
  const text = withPassageFrom(
    newGroupNote(group, noteName, new Date().toISOString().slice(0, 10)),
    from,
    marker,
    markdown,
  );
  try {
    await source.createNote(path, text);
    useVaultStore.getState().noteWritten(path, text);
  } catch (err) {
    if (!(err instanceof NoteExistsError)) throw err;
    await write(path, await source.readNote(path));
  }
  return noteName;
}

/** Into a note that exists already, of any type. */
export function addPdfPassageToNote(
  name: string,
  passage: PdfPassage,
): Promise<string> {
  return addPdfPassage("idea", name, passage);
}
