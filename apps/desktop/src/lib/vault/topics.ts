/**
 * Topics: notes that gather the papers on a subject (as the Zotero sync
 * makes them from "topic: <name>" tags). Connecting a paper to one links the
 * paper note to the topic (a `topics:` property) and lists the paper in the
 * topic note, so the connection shows both ways, in the graph and backlinks.
 */
import { BEGIN, END, safeNoteName } from "./paper-note";
import type { VaultIndex, VaultNote } from "./vault-index";

const DEFAULT_TOPICS_FOLDER = "Topics";

/** The topic id the Zotero sync uses: letters and digits, lower case. */
export const topicId = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

export function isTopicNote(n: VaultNote): boolean {
  const tags = [n.frontmatter.tags, n.frontmatter.tag]
    .flat()
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase().replace(/^#/, ""));
  return (
    tags.includes("topic") ||
    "zotero_topic" in n.frontmatter ||
    n.path.split("/").slice(0, -1).includes(DEFAULT_TOPICS_FOLDER)
  );
}

export function topicNotes(index: VaultIndex): VaultNote[] {
  return index.list
    .filter(isTopicNote)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Topics a note already belongs to (it links to them). */
export function topicsOf(index: VaultIndex, note: VaultNote): Set<string> {
  const topics = new Set(topicNotes(index).map((t) => t.name));
  return new Set(note.outgoing.filter((n) => topics.has(n)));
}

/** Where topic notes live: where most of them are, or "Topics". */
export function topicsFolderOf(index: VaultIndex): string {
  const counts = new Map<string, number>();
  for (const n of topicNotes(index)) {
    const dir = n.path.split("/").slice(0, -1).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best = DEFAULT_TOPICS_FOLDER;
  let most = 0;
  for (const [dir, count] of counts) {
    if (count > most) {
      best = dir;
      most = count;
    }
  }
  return best;
}

/** A new topic note, shaped as the Zotero sync makes them. */
export function newTopicNote(name: string, paperLine: string, today: string) {
  return [
    "---",
    "tags:",
    "- topic",
    `created: '${today}'`,
    `zotero_topic: ${topicId(name)}`,
    "---",
    "## Definition",
    "",
    "",
    BEGIN,
    "## Literature",
    "",
    paperLine,
    END,
    "",
    "## My notes",
    "",
    "",
  ].join("\n");
}

/** The line a topic note lists a paper with. */
export function paperLine(paper: VaultNote) {
  const title = paper.title !== paper.name ? ` ${paper.title}` : "";
  const year = paper.year ? ` (${paper.year})` : "";
  return `- [[${paper.name}]]${title}${year}`;
}

/**
 * The topic note with the paper listed: in its Literature list when it has
 * the sync's markers, otherwise under a "Papers" heading at the end.
 * Unchanged when the paper is there already.
 */
export function withPaper(topicText: string, paper: VaultNote): string {
  const link = new RegExp(
    `\\[\\[${paper.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\||#|\\]\\])`,
    "i",
  );
  if (link.test(topicText)) return topicText;
  const line = paperLine(paper);
  const begin = topicText.indexOf(BEGIN);
  const end = topicText.indexOf(END, begin + 1);
  if (begin >= 0 && end > begin) {
    const block = topicText.slice(begin, end);
    const heading = block.indexOf("## Literature");
    let updated: string;
    if (heading >= 0) {
      // After the list's last item (or right under the heading).
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.startsWith("## Literature"));
      let last = at + 1;
      for (
        let i = at + 1;
        i < lines.length && !lines[i].startsWith("## ");
        i++
      ) {
        if (lines[i].startsWith("- ")) last = i + 1;
      }
      if (last === at + 1) {
        lines.splice(at + 1, 0, "", line);
      } else {
        lines.splice(last, 0, line);
      }
      updated = lines.join("\n");
    } else {
      updated = `${block.trimEnd()}\n## Literature\n\n${line}\n`;
    }
    return topicText.slice(0, begin) + updated + topicText.slice(end);
  }
  const papers = topicText.match(/^## Papers\n/m);
  if (papers?.index !== undefined) {
    const at = papers.index + papers[0].length;
    const rest = topicText.slice(at);
    const next = rest.search(/^## /m);
    const cut = next < 0 ? rest.length : next;
    const section = rest.slice(0, cut).trimEnd();
    return `${topicText.slice(0, at)}${section ? `${section}\n` : "\n"}${line}\n${next < 0 ? "" : `\n${rest.slice(cut)}`}`;
  }
  return `${topicText.trimEnd()}\n\n## Papers\n\n${line}\n`;
}

/**
 * The note with `[[topic]]` in its `topics:` property (added, or appended
 * to), leaving the rest of its frontmatter and text as they were.
 */
export function withTopicProperty(text: string, topic: string): string {
  const value = `"[[${topic}]]"`;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return `---\ntopics:\n- ${value}\n---\n${text}`;
  const lines = fm[1].split("\n");
  const at = lines.findIndex((l) => /^topics\s*:/.test(l));
  if (at < 0) {
    lines.push("topics:", `- ${value}`);
  } else {
    const inline = lines[at].match(/^topics\s*:\s*\[(.*)\]\s*$/);
    const single = lines[at].match(/^topics\s*:\s*(\S.*)$/);
    if (inline) {
      const items = inline[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      lines.splice(at, 1, "topics:", ...[...items, value].map((v) => `- ${v}`));
    } else if (single) {
      lines.splice(at, 1, "topics:", `- ${single[1].trim()}`, `- ${value}`);
    } else {
      let last = at;
      while (last + 1 < lines.length && /^\s*- /.test(lines[last + 1])) last++;
      lines.splice(last + 1, 0, `- ${value}`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n${text.slice(fm[0].length)}`;
}

export const topicFileName = (name: string) => safeNoteName(name);
