/**
 * A passage of your own writing filed under an idea or a topic, from the
 * editor or the compiled PDF: quoted under its project's heading, with a
 * link that opens the project at that file and line.
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
import { safeNoteName } from "./paper-note";
import { findNote } from "./vault-index";

export interface OwnPassage {
  projectRoot: string;
  /** Relative to the project, as the editor names it (unknown: none). */
  file?: string;
  /** 1-based. */
  line?: number;
  text: string;
}

/** LaTeX source as prose: no comments, labels or markup around words. */
export function latexAsProse(source: string): string {
  return source
    .split("\n")
    .map((l) => l.replace(/(^|[^\\])%.*$/, "$1"))
    .join("\n")
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(
      /\\(?:emph|textbf|textit|textsc|texttt|underline|textup)\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\\w*cite\w*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g, "($1)")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``|''/g, '"')
    .replace(/~/g, " ")
    .replace(/\\([%&$#_])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A short, steady name for a passage, so it's filed only once. */
function passageId(p: OwnPassage): string {
  let h = 2166136261;
  for (const ch of `${p.file ?? ""}\n${p.text}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const projectName = (root: string) =>
  root
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || root;

/** The passage as it's written in the note. */
export function ownPassageMarkdown(p: OwnPassage): string {
  const link = `${latex4allLink({ project: p.projectRoot, file: p.file, line: p.line })}&passage=${passageId(p)}`;
  const label = p.file
    ? `${p.file}${p.line ? `, line ${p.line}` : ""}`
    : projectName(p.projectRoot);
  const quote = p.text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
  return `${quote}\n> — [${label}](${link})`;
}

/**
 * Files a passage of the project's own text under an idea or topic (the
 * note made if it's new). Returns the note's name.
 */
export async function addOwnPassage(
  group: PassageGroup,
  name: string,
  passage: OwnPassage,
): Promise<string> {
  await useVaultStore.getState().ensureVault();
  const { source, index } = useVaultStore.getState();
  if (!source || !index) throw new Error("Connect your vault first.");
  const noteName = safeNoteName(name);
  if (!noteName) throw new Error("Give it a name.");
  const project = projectName(passage.projectRoot);
  // Under the project's own note, when the vault has one.
  const heading = findNote(index, project) ? `[[${project}]]` : project;
  const from = {
    heading,
    headingKey: `### ${heading}`,
    literature: null,
  };
  const marker = `passage=${passageId(passage)}`;
  const markdown = ownPassageMarkdown(passage);
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
