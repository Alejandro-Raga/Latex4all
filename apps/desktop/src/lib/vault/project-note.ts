import type { Annotation } from "@/lib/annotations/types";
import { latex4allLink } from "@/lib/deep-link";
import { noteForCitekey } from "./cite-link";
import type { VaultIndex } from "./vault-index";

/**
 * A Latex4All project as a note in the Obsidian vault: the papers it cites
 * (linked to their notes, so the project sits in the graph beside them), its
 * outline, and the highlights and notes made on it. The part between the
 * markers is rewritten on each update; anything else in the note is the
 * user's and left alone.
 */

export const BEGIN = "%% begin latex4all %%";
export const END = "%% end latex4all %%";

/** Frontmatter keys Latex4All keeps current; the rest are the user's. */
const OWNED_KEYS = [
  "type",
  "project",
  "latex4all_project",
  "latex4all_updated",
];

export interface ProjectNoteInput {
  name: string;
  /** Project folder on this computer. */
  root: string;
  /**
   * The project's id (a shared project's own, the same on every computer):
   * how its note is found again whatever either is called.
   */
  id?: string;
  type: string | null;
  /** The project's LaTeX files, main file first. */
  texFiles: { path: string; content: string }[];
  annotations: { path: string; annotation: Annotation }[];
  index: VaultIndex | null;
  /** Zotero item keys by the citation keys the project's .bib files use. */
  itemKeyByCitekey: Map<string, string>;
  now?: Date;
}

const CITE_RE =
  /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g;
const HEADING_RE =
  /\\(chapter|section|subsection)\*?\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;

/** LaTeX with comments removed, so commented-out citations don't count. */
const uncommented = (tex: string) => tex.replace(/(^|[^\\])%[^\n]*/g, "$1");

/** Citation keys in order of first use. */
export function citedKeys(texFiles: { content: string }[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const { content } of texFiles) {
    for (const m of uncommented(content).matchAll(CITE_RE)) {
      for (const raw of m[1].split(",")) {
        const key = raw.trim();
        if (key && key !== "*" && !seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
  }
  return keys;
}

export interface CitePlace {
  file: string;
  /** 1-based. */
  line: number;
}

/** Where each key is cited: file and line, in order through the files. */
export function citeLocations(
  texFiles: { path: string; content: string }[],
): Map<string, CitePlace[]> {
  const places = new Map<string, CitePlace[]>();
  for (const { path, content } of texFiles) {
    // Comments go but their newlines stay, so line numbers still hold.
    const text = uncommented(content);
    for (const m of text.matchAll(CITE_RE)) {
      const line = lineAt(text, m.index ?? 0);
      for (const raw of m[1].split(",")) {
        const key = raw.trim();
        if (!key || key === "*") continue;
        const list = places.get(key) ?? [];
        const last = list[list.length - 1];
        if (!last || last.file !== path || last.line !== line) {
          list.push({ file: path, line });
        }
        places.set(key, list);
      }
    }
  }
  return places;
}

/** A heading's title as plain text: commands dropped, their text kept. */
function plainTitle(title: string): string {
  return title
    .replace(/\\[A-Za-z]+\*?\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[A-Za-z]+\*?/g, "")
    .replace(/[{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function outline(texFiles: { content: string }[]): string[] {
  const lines: string[] = [];
  const hasChapters = texFiles.some((f) =>
    /\\chapter\*?\s*[[{]/.test(f.content),
  );
  for (const { content } of texFiles) {
    for (const m of uncommented(content).matchAll(HEADING_RE)) {
      const level = {
        chapter: 0,
        section: hasChapters ? 1 : 0,
        subsection: hasChapters ? 2 : 1,
      }[m[1] as "chapter" | "section" | "subsection"];
      if (level > 1) continue;
      const title = plainTitle(m[2]);
      if (title) lines.push(`${"  ".repeat(level)}- ${title}`);
    }
  }
  return lines;
}

const lineAt = (text: string, offset: number) =>
  text.slice(0, offset).split("\n").length;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function quote(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 400 ? `${compact.slice(0, 399)}…` : compact;
}

/** The generated part of the note (between the markers). */
export function projectNoteBody(input: ProjectNoteInput): string {
  const out: string[] = [
    `[Open in Latex4All](${latex4allLink({ project: input.root })})`,
    "",
  ];

  const keys = citedKeys(input.texFiles);
  if (keys.length > 0) {
    const linked: string[] = [];
    const missing: string[] = [];
    for (const key of keys) {
      const note = input.index
        ? noteForCitekey(input.index, key, input.itemKeyByCitekey)
        : undefined;
      if (note && !linked.includes(`[[${note.name}]]`)) {
        linked.push(`[[${note.name}]]`);
      } else if (!note) {
        missing.push(`\`${key}\``);
      }
    }
    out.push("## Cites", "");
    if (linked.length) out.push(linked.join(" · "), "");
    if (missing.length) out.push(`Not in the vault: ${missing.join(", ")}`, "");
  }

  const heads = outline(input.texFiles);
  if (heads.length > 0) out.push("## Outline", "", ...heads, "");

  const contents = new Map(input.texFiles.map((f) => [f.path, f.content]));
  const open = input.annotations.filter(
    ({ annotation: a }) => !a.resolved && !a.suggestion,
  );
  const resolved = input.annotations.filter(
    ({ annotation: a }) => a.resolved && !a.suggestion,
  ).length;
  if (open.length > 0 || resolved > 0) {
    out.push("## Highlights and notes", "");
    const order = [...contents.keys()];
    open.sort(
      (a, b) =>
        order.indexOf(a.path) - order.indexOf(b.path) ||
        a.annotation.from - b.annotation.from,
    );
    for (const { path, annotation: a } of open) {
      const text = contents.get(path);
      const line = text ? lineAt(text, a.from) : undefined;
      const place = line ? `${path}:${line}` : path;
      const where = `[${place}](${latex4allLink({ project: input.root, file: path, line })})`;
      const tag = a.color && a.color !== "none" ? ` #hl/${a.color}` : "";
      const excerpt = text ? quote(text.slice(a.from, a.to)) : "";
      if (excerpt) out.push(`> ${excerpt}`, `> — ${where}${tag}`);
      else out.push(`*${where}*${tag}`);
      for (const c of a.comments) {
        out.push(
          "",
          `**${c.author || "Someone"}** (${day(c.at)}): ${c.text.trim()}`,
        );
      }
      out.push("");
    }
    if (resolved > 0) {
      out.push(
        `*${resolved} resolved ${resolved === 1 ? "note" : "notes"} not shown.*`,
        "",
      );
    }
  }

  if (out.length === 2) out.push("*Nothing cited or noted yet.*", "");
  return `${out.join("\n").trim()}\n`;
}

function owned(input: ProjectNoteInput): Record<string, string> {
  return {
    ...(input.type ? { type: input.type } : {}),
    project: input.root,
    ...(input.id ? { latex4all_project: input.id } : {}),
    latex4all_updated: (input.now ?? new Date()).toISOString().slice(0, 10),
  };
}

const yamlValue = (v: string) =>
  /^[\w./ -]+$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * The whole note: a new one if `existing` is null, else `existing` with its
 * generated part and Latex4All's frontmatter keys replaced. Null when the
 * markers were taken out by hand, which means "leave this note alone".
 */
export function mergeProjectNote(
  existing: string | null,
  input: ProjectNoteInput,
): string | null {
  const body = projectNoteBody(input);
  const keys = owned(input);
  const ownedLines = Object.entries(keys).map(
    ([k, v]) => `${k}: ${yamlValue(v)}`,
  );

  if (existing === null) {
    return `---\n${[...ownedLines, "tags:", "- project"].join("\n")}\n---\n${BEGIN}\n${body}${END}\n\n## My notes\n\n`;
  }

  const m = existing.match(FRONTMATTER_RE);
  const rest = m ? existing.slice(m[0].length) : existing;
  const begin = rest.indexOf(BEGIN);
  const end = rest.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return null;

  // Keep the user's frontmatter lines, dropping only ours (scalars, one line).
  const theirs = (m ? m[1].split(/\r?\n/) : []).filter((line) => {
    const key = line.match(/^([^\s:#][^:]*):/)?.[1]?.trim();
    return !(key && OWNED_KEYS.includes(key));
  });
  const frontmatter = [...ownedLines, ...theirs].join("\n");
  return `---\n${frontmatter}\n---\n${rest.slice(0, begin)}${BEGIN}\n${body}${END}${rest.slice(end + END.length)}`;
}

/** Where a project's note goes in the vault. */
export function projectNotePath(folder: string, name: string): string {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Project";
  const dir = folder.replace(/^\/+|\/+$/g, "");
  return dir ? `${dir}/${clean}.md` : `${clean}.md`;
}
