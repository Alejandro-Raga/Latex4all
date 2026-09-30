/**
 * Connects a note (a paper, usually) to a topic: the topic note lists it,
 * the note links to the topic, and in Zotero the paper gets the topic's tag,
 * so a Zotero → Obsidian sync agrees.
 */
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { addZoteroTag } from "../zotero-api";
import {
  newTopicNote,
  paperLine,
  topicFileName,
  topicId,
  topicNotes,
  topicsFolderOf,
  withPaper,
  withTopicProperty,
} from "./topics";
import { findNote } from "./vault-index";

/** Returns the topic's note name. */
export async function connectToTopic(
  noteName: string,
  topic: string,
): Promise<string> {
  await useVaultStore.getState().ensureVault();
  const { source, index, noteWritten } = useVaultStore.getState();
  if (!source || !index) throw new Error("Connect your vault first.");
  const note = findNote(index, noteName);
  if (!note) throw new Error(`“${noteName}” isn't in the vault.`);

  const id = topicId(topic);
  const existing = topicNotes(index).find(
    (t) =>
      t.name.toLowerCase() === topic.trim().toLowerCase() ||
      t.frontmatter.zotero_topic === id,
  );
  const name = existing?.name ?? topicFileName(topic);
  if (!name) throw new Error("Give the topic a name.");

  if (existing) {
    const { text, version } = await source.readNote(existing.path);
    const next = withPaper(text, note);
    if (next !== text) {
      await source.writeNote(existing.path, next, version);
      noteWritten(existing.path, next);
    }
  } else {
    const folder = topicsFolderOf(index);
    const path = folder ? `${folder}/${name}.md` : `${name}.md`;
    const today = new Date().toISOString().slice(0, 10);
    const text = newTopicNote(name, paperLine(note), today);
    await source.createNote(path, text);
    noteWritten(path, text);
  }

  const current = await source.readNote(note.path);
  const linked = withTopicProperty(current.text, name);
  if (!note.outgoing.includes(name) && linked !== current.text) {
    await source.writeNote(note.path, linked, current.version);
    noteWritten(note.path, linked);
  }

  const { apiKey, userID } = useZoteroStore.getState();
  if (note.zoteroKey && apiKey && userID) {
    await addZoteroTag(apiKey, userID, note.zoteroKey, `topic: ${name}`).catch(
      () => {},
    );
  }
  return name;
}
