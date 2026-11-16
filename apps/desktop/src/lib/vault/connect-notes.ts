/**
 * Connects any two notes: each lists the other under "## Related", so the
 * link shows from both sides (and in Obsidian's backlinks and graph).
 */
import { useVaultStore } from "@/stores/vault-store";
import { findNote } from "./vault-index";

const RELATED = "## Related";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text links to `name` already, in any form. */
export function linksTo(text: string, name: string): boolean {
  return new RegExp(`\\[\\[${escapeRe(name)}(\\||#|\\]\\])`, "i").test(text);
}

/** The note's text with `[[name]]` listed under its Related heading. */
export function withRelated(text: string, name: string): string {
  if (linksTo(text, name)) return text;
  const line = `- [[${name}]]`;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === RELATED);
  if (at < 0) {
    const body = text.trimEnd();
    return `${body}${body ? "\n\n" : ""}${RELATED}\n\n${line}\n`;
  }
  // After the section's last item, or right under the heading.
  let last = -1;
  for (let i = at + 1; i < lines.length && !lines[i].startsWith("#"); i++) {
    if (lines[i].startsWith("- ")) last = i;
  }
  if (last >= 0) lines.splice(last + 1, 0, line);
  else lines.splice(at + 1, 0, "", line);
  return lines.join("\n");
}

/** Links two vault notes to each other. Returns the second note's name. */
export async function connectNotes(from: string, to: string): Promise<string> {
  await useVaultStore.getState().ensureVault();
  const { source, index, noteWritten } = useVaultStore.getState();
  if (!source || !index) throw new Error("Connect your vault first.");
  const a = findNote(index, from);
  const b = findNote(index, to);
  if (!a) throw new Error(`“${from}” isn't in the vault.`);
  if (!b) throw new Error(`“${to}” isn't in the vault.`);
  if (a.path === b.path) throw new Error("A note can't link to itself.");
  for (const [note, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const { text, version } = await source.readNote(note.path);
    const next = withRelated(text, other.name);
    if (next !== text) {
      await source.writeNote(note.path, next, version);
      noteWritten(note.path, next);
    }
  }
  return b.name;
}
