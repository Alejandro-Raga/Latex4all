/**
 * Literature notes for Zotero papers, written by Latex4All in the same shape
 * as the Zotero → Obsidian sync writes them: owned frontmatter keys, the
 * paper's details and highlights between the `%% begin zotero %%` markers,
 * and a "My notes" section that is never touched. So a note looks the same
 * however it was added, and either side can refresh it later.
 */

export const BEGIN = "%% begin zotero %%";
export const END = "%% end zotero %%";

/** Frontmatter keys the note's Zotero part owns; the rest are the user's. */
const OWNED_KEYS = [
  "title",
  "authors",
  "year",
  "publication",
  "doi",
  "url",
  "item_type",
  "citekey",
  "zotero_key",
  "zotero_tags",
  "aliases",
];

const COLORS: Record<string, string> = {
  "#ffd400": "yellow",
  "#ff6666": "red",
  "#5fb236": "green",
  "#2ea8e5": "blue",
  "#a28ae5": "purple",
  "#e56eee": "magenta",
  "#f19837": "orange",
  "#aaaaaa": "gray",
};

/** A Zotero item's fields, as the web API returns them (those used here). */
export interface PaperFields {
  itemType: string;
  title?: string;
  creators?: {
    creatorType?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
  }[];
  date?: string;
  publicationTitle?: string;
  bookTitle?: string;
  proceedingsTitle?: string;
  websiteTitle?: string;
  publisher?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  tags?: { tag: string; type?: number }[];
}

export interface PaperAnnotation {
  key: string;
  type: string;
  text?: string;
  comment?: string;
  color?: string;
  pageLabel?: string;
  pageIndex?: number;
  sortIndex?: string;
}

export interface PaperData {
  key: string;
  fields: PaperFields;
  /** The PDF the highlights are on. */
  pdfKey: string | null;
  annotations: PaperAnnotation[];
}

const AUTHOR_TYPES = new Set([
  "author",
  "editor",
  "presenter",
  "inventor",
  "programmer",
  undefined,
]);

export function paperAuthors(f: PaperFields): string[] {
  return (f.creators ?? [])
    .filter((c) => AUTHOR_TYPES.has(c.creatorType))
    .map((c) =>
      (c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).trim(),
    )
    .filter(Boolean);
}

export const paperYear = (f: PaperFields) =>
  f.date?.match(/\b(\d{4})\b/)?.[1] ?? "";

const titleOf = (f: PaperFields) => (f.title || "Untitled").trim();

function publicationOf(f: PaperFields) {
  return (
    f.publicationTitle ||
    f.bookTitle ||
    f.proceedingsTitle ||
    f.websiteTitle ||
    f.publisher ||
    ""
  );
}

/** A file name Obsidian can link to: no characters it or the disk refuse. */
export function safeNoteName(text: string, limit = 90) {
  let name = text
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  if (name.length > limit) name = name.slice(0, limit).replace(/\s+\S*$/, "");
  return name;
}

const LIGATURES: Record<string, string> = {
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "st",
  "\ufb06": "st",
};

/**
 * A highlight's text as written, without what the PDF's layout adds: soft
 * hyphens, words split at line ends ("incen- tives", but not "pre- and"),
 * ligatures, doubled spaces. As the vault's Zotero sync does.
 */
export function cleanHighlight(text: string): string {
  return text
    .replace(/\u00ad\s*/g, "")
    .replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c)
    .replace(/([a-z])- (?!(?:and|or|to|nor|as|vs)\b)([a-z])/g, "$1$2")
    .replace(/([A-Z0-9])- ([A-Za-z0-9])/g, "$1-$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

function pageLink(pdfKey: string, a: PaperAnnotation) {
  const page = a.pageIndex !== undefined ? `page=${a.pageIndex + 1}&` : "";
  const label = a.pageLabel ? `p. ${a.pageLabel}` : "open";
  return `[${label}](zotero://open-pdf/library/items/${pdfKey}?${page}annotation=${a.key})`;
}

function annotationBlock(pdfKey: string, a: PaperAnnotation) {
  const color = COLORS[(a.color ?? "").toLowerCase()] ?? "";
  const tag = color ? ` #hl/${color}` : "";
  const block = `^${a.key.toLowerCase()}`;
  const link = pageLink(pdfKey, a);
  const lines: string[] = [];
  if ((a.type === "highlight" || a.type === "underline") && a.text) {
    // Obsidian finds a quote's block id only on a line of its own.
    lines.push(quote(cleanHighlight(a.text)), `> — ${link}${tag}`, "", block);
  } else if (a.type === "note") {
    lines.push(`📝 ${link}${tag} ${block}`);
  } else {
    lines.push(`*(${a.type} annotation)* ${link}${tag} ${block}`);
  }
  if (a.comment?.trim()) lines.push("", a.comment.trim());
  return lines.join("\n");
}

/** The note's Zotero part: title, details, links, abstract, highlights. */
export function paperBody(paper: PaperData): string {
  const f = paper.fields;
  const pub = publicationOf(f);
  const meta = [paperAuthors(f).join(", "), paperYear(f), pub ? `*${pub}*` : ""]
    .filter(Boolean)
    .join(" · ");
  const links = [`[Zotero](zotero://select/library/items/${paper.key})`];
  if (paper.pdfKey) {
    links.push(`[Open PDF](zotero://open-pdf/library/items/${paper.pdfKey})`);
  }
  if (f.DOI) links.push(`[DOI](https://doi.org/${f.DOI})`);
  else if (f.url) links.push(`[Web](${f.url})`);

  const out = [`# ${titleOf(f)}`, ""];
  if (meta) out.push(meta, "");
  out.push(links.join(" · "), "");
  // "topic: <name>" tags file the paper under a topic note, as the sync does.
  const topics = (f.tags ?? [])
    .filter((t) => t.type !== 1)
    .map((t) => t.tag.match(/^\s*#?topics?\s*[:/]\s*(.+?)\s*$/i)?.[1])
    .map((t) => (t ? safeNoteName(t) : ""))
    .filter(Boolean);
  if (topics.length) {
    out.push(`Topics: ${topics.map((t) => `[[${t}]]`).join(" · ")}`, "");
  }
  if (f.abstractNote?.trim())
    out.push("## Abstract", "", quote(f.abstractNote), "");
  const annotations = [...paper.annotations].sort((a, b) =>
    (a.sortIndex ?? "").localeCompare(b.sortIndex ?? ""),
  );
  if (paper.pdfKey && annotations.length) {
    out.push("## Highlights", "");
    for (const a of annotations) out.push(annotationBlock(paper.pdfKey, a), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// ─── Frontmatter ───

const PLAIN = /^[A-Za-z0-9_À-ɏ][^:#\n]*$/;
const RESERVED = /^(true|false|yes|no|null|~|[-+]?\d[\d._eE+-]*)$/i;

function scalar(value: string | number): string {
  if (typeof value === "number") return String(value);
  return PLAIN.test(value) && !RESERVED.test(value) && value === value.trim()
    ? value
    : JSON.stringify(value);
}

function yamlEntries(fm: [string, string | number | string[]][]): string {
  const out: string[] = [];
  for (const [key, value] of fm) {
    if (Array.isArray(value)) {
      out.push(`${key}:`, ...value.map((v) => `- ${scalar(v)}`));
    } else {
      out.push(`${key}: ${scalar(value)}`);
    }
  }
  return out.join("\n");
}

function ownedFrontmatter(paper: PaperData, citekey: string) {
  const f = paper.fields;
  const year = paperYear(f);
  const tags = (f.tags ?? []).map((t) => t.tag);
  const entries: [string, string | number | string[] | null][] = [
    ["title", titleOf(f)],
    ["authors", paperAuthors(f)],
    ["year", year ? Number(year) : null],
    ["publication", f.publicationTitle || f.bookTitle || null],
    ["doi", f.DOI || null],
    ["url", f.url || null],
    ["item_type", f.itemType],
    ["citekey", citekey],
    ["zotero_key", paper.key],
    ["zotero_tags", tags],
    ["aliases", [titleOf(f)]],
  ];
  return entries.filter(
    (e): e is [string, string | number | string[]] =>
      e[1] !== null &&
      e[1] !== "" &&
      !(Array.isArray(e[1]) && e[1].length === 0),
  );
}

/** Top-level frontmatter entries as text blocks, keyed by their key. */
function frontmatterBlocks(yaml: string): { key: string; text: string }[] {
  const blocks: { key: string; text: string }[] = [];
  for (const line of yaml.split("\n")) {
    const key = line.match(/^([^\s#-][^:]*):/)?.[1];
    if (key !== undefined) blocks.push({ key: key.trim(), text: line });
    else if (blocks.length) blocks[blocks.length - 1].text += `\n${line}`;
    else if (line.trim()) blocks.push({ key: "", text: line });
  }
  return blocks;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** True when a note is one of these (has the markers). */
export const isPaperNote = (text: string) =>
  text.includes(BEGIN) && text.includes(END);

/**
 * The note for a paper: new, or `existing` with its Zotero part and owned
 * keys brought up to date and everything else kept. Null when `existing`
 * isn't one of these notes (no markers): it belongs to someone else.
 */
export function paperNoteText(
  paper: PaperData,
  citekey: string,
  existing: string | null,
): string | null {
  const body = paperBody(paper);
  const owned = yamlEntries(ownedFrontmatter(paper, citekey));
  if (existing === null) {
    return `---\n${owned}\ntags:\n- paper\nstatus: to-process\n---\n${BEGIN}\n${body}${END}\n\n## My notes\n\n`;
  }
  if (!isPaperNote(existing)) return null;
  const m = existing.match(FRONTMATTER);
  const kept = m
    ? frontmatterBlocks(m[1])
        .filter((b) => !OWNED_KEYS.includes(b.key))
        .map((b) => b.text)
        .join("\n")
    : "";
  const rest = m ? existing.slice(m[0].length) : existing;
  const [pre, tail] = [
    rest.slice(0, rest.indexOf(BEGIN)),
    rest.slice(rest.indexOf(BEGIN)),
  ];
  const post = tail.slice(tail.indexOf(END) + END.length);
  const fm = kept ? `${owned}\n${kept}` : owned;
  return `---\n${fm}\n---\n${pre}${BEGIN}\n${body}${END}${post}`;
}
