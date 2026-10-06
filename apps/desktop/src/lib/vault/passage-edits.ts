/**
 * A highlight filed under ideas and topics, changed afterwards: its passage
 * in those notes goes with it when it's deleted, and shows its new note.
 */
import { useVaultStore } from "@/stores/vault-store";

/**
 * Where a highlight's passage is in a note: the quote, its link line (which
 * names the highlight) and the note under it, as lines [start, end).
 */
export function passageLines(
  lines: string[],
  annotationKey: string,
  comment?: string,
): [number, number] | null {
  const link = lines.findIndex(
    (l) => l.startsWith(">") && l.includes(`annotation=${annotationKey}`),
  );
  if (link < 0) return null;
  let start = link;
  while (start > 0 && lines[start - 1].startsWith(">")) start--;
  let end = link + 1;
  // Its note, a paragraph after a blank line, when it's the one it had.
  const note = comment?.trim();
  if (note && lines[end] === "") {
    const count = note.split("\n").length;
    if (lines.slice(end + 1, end + 1 + count).join("\n") === note) {
      end += 1 + count;
    }
  }
  return [start, end];
}

/** The note's text without the highlight's passage. */
export function withoutPassage(
  text: string,
  annotationKey: string,
  comment?: string,
): string {
  const lines = text.split("\n");
  const at = passageLines(lines, annotationKey, comment);
  if (!at) return text;
  lines.splice(at[0], at[1] - at[0]);
  // The blank lines on either side become one.
  if (lines[at[0] - 1] === "" && lines[at[0]] === "") lines.splice(at[0], 1);
  return lines.join("\n");
}

/** The note's text with the passage's note changed (or added, or gone). */
export function withPassageComment(
  text: string,
  annotationKey: string,
  oldComment: string | undefined,
  newComment: string,
): string {
  const lines = text.split("\n");
  const at = passageLines(lines, annotationKey, oldComment);
  if (!at) return text;
  const link = lines.findIndex(
    (l) => l.startsWith(">") && l.includes(`annotation=${annotationKey}`),
  );
  const note = newComment.trim();
  lines.splice(
    link + 1,
    at[1] - link - 1,
    ...(note ? ["", ...note.split("\n")] : []),
  );
  return lines.join("\n");
}

/** Applies a change to every vault note holding the highlight's passage. */
async function eachNoteWith(
  annotationKey: string,
  change: (text: string) => string,
): Promise<string[]> {
  const { source, index, noteWritten } = useVaultStore.getState();
  if (!source || !index) return [];
  const changed: string[] = [];
  for (const note of index.list) {
    if (!note.body.includes(`annotation=${annotationKey}`)) continue;
    const { text, version } = await source.readNote(note.path);
    const next = change(text);
    if (next === text) continue;
    await source.writeNote(note.path, next, version);
    noteWritten(note.path, next);
    changed.push(note.name);
  }
  return changed;
}

/** Takes a deleted highlight's passage out of the ideas and topics. */
export function removePassageEverywhere(
  annotationKey: string,
  comment?: string,
): Promise<string[]> {
  return eachNoteWith(annotationKey, (text) =>
    withoutPassage(text, annotationKey, comment),
  );
}

/** Shows a highlight's new note under its passage wherever it's filed. */
export function updatePassageComment(
  annotationKey: string,
  oldComment: string | undefined,
  newComment: string,
): Promise<string[]> {
  return eachNoteWith(annotationKey, (text) =>
    withPassageComment(text, annotationKey, oldComment, newComment),
  );
}
