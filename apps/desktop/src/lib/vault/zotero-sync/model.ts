/**
 * The Zotero → Obsidian sync's model and rendering, ported from the Python
 * sync (zotero_obsidian.py) function for function, so both write the same
 * notes: paper notes, topic and idea notes, and idea notes from highlights.
 * Sorting, quoting and spacing follow Python's on purpose.
 */
import { htmlToMarkdown } from "./markdownify";
import { dumpYaml, loadYaml, type YamlValue } from "./pyyaml";

export type ItemData = Record<string, any>;
export interface Item {
  key: string;
  data: ItemData;
}
/** Every item of the library by key, in the order the sync met them. */
export type Cache = Map<string, Item>;

export const BEGIN = "%% begin zotero %%";
export const END = "%% end zotero %%";
export const OWNED_KEYS = [
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
const PAPER_TYPES_EXCLUDED = new Set(["note", "attachment", "annotation"]);
const READABLE_ATTACHMENTS = new Set([
  "application/pdf",
  "application/epub+zip",
  "text/html",
]);
export const IDEA_TAG = "idea";
export const IDEA_SETTLE_S = 60;
export const COLORS: Record<string, string> = {
  "#ffd400": "yellow",
  "#ff6666": "red",
  "#5fb236": "green",
  "#2ea8e5": "blue",
  "#a28ae5": "purple",
  "#e56eee": "magenta",
  "#f19837": "orange",
  "#aaaaaa": "gray",
};

/** A "word: name" tag pattern, as the sync's TOPIC_RE / IDEA_RE. */
export const groupPattern = (word: string) =>
  new RegExp(
    `^\\s*#?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\s*[:/]\\s*(.+?)\\s*$`,
    "i",
  );
export const TOPIC_RE = groupPattern("topic");
export const IDEA_RE = groupPattern("idea");

/** Python's string order (code points), not the locale's. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------ model

export function topLevelKey(item: Item, cache: Cache): string {
  let d = item.data;
  while (d.parentItem) {
    const parent = cache.get(d.parentItem);
    if (!parent) return d.parentItem;
    d = parent.data;
  }
  return d.key;
}

export function childrenOf(key: string, cache: Cache): Item[] {
  return [...cache.values()].filter((i) => i.data.parentItem === key);
}

export function isPaper(item: Item): boolean {
  const d = item.data;
  if (d.deleted) return false;
  if (!PAPER_TYPES_EXCLUDED.has(d.itemType)) return true;
  return (
    d.itemType === "attachment" &&
    !d.parentItem &&
    READABLE_ATTACHMENTS.has(d.contentType)
  );
}

export function gather(key: string, cache: Cache) {
  const paper = cache.get(key) as Item;
  const alive = (i: Item) => !i.data.deleted;
  let attachments: Item[];
  let notes: Item[];
  if (paper.data.itemType === "attachment") {
    attachments = [paper];
    notes = [];
  } else {
    const kids = childrenOf(key, cache).filter(alive);
    attachments = kids.filter((c) => c.data.itemType === "attachment");
    notes = kids.filter((c) => c.data.itemType === "note");
  }
  const annotations: [Item, Item[]][] = attachments.map((att) => {
    const anns = childrenOf(att.key, cache).filter(
      (a) => alive(a) && a.data.itemType === "annotation",
    );
    anns.sort((a, b) =>
      cmp(a.data.annotationSortIndex ?? "", b.data.annotationSortIndex ?? ""),
    );
    return [att, anns];
  });
  return { attachments, annotations, notes };
}

export const hasTag = (item: Item, tag: string) =>
  (item.data.tags ?? []).some(
    (t: { tag: string }) => t.tag.trim().toLowerCase() === tag,
  );

export function topicsOf(item: Item, pattern: RegExp = TOPIC_RE): string[] {
  const out: string[] = [];
  for (const t of item.data.tags ?? []) {
    if (t.type === 1) continue;
    const m = pattern.exec(t.tag);
    const name = m ? safeFilename(m[1]) : "";
    if (name) out.push(name);
  }
  return out;
}

// ------------------------------------------------------------- rendering

const AUTHOR_TYPES = new Set([
  "author",
  "editor",
  "presenter",
  "inventor",
  "programmer",
  undefined,
  null,
]);

export function creators(d: ItemData): string[] {
  const out: string[] = [];
  for (const c of d.creators ?? []) {
    if (!AUTHOR_TYPES.has(c.creatorType)) continue;
    const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ");
    out.push(name.trim());
  }
  return out;
}

export function lastName(d: ItemData): string {
  for (const c of d.creators ?? []) {
    if (c.lastName) return c.lastName;
    if (c.name) return c.name.split(/\s+/).filter(Boolean)[0] ?? "";
  }
  return "";
}

/** Python's text.encode("ascii", "ignore") after NFKD: accents dropped. */
export const asciiFold = (text: string) =>
  [...text.normalize("NFKD")]
    .filter((c) => (c.codePointAt(0) as number) < 128)
    .join("");

export function year(d: ItemData): string {
  return /\b(\d{4})\b/.exec(d.date ?? "")?.[1] ?? "";
}

export function citekey(d: ItemData): string {
  if (d.citationKey) return d.citationKey;
  const m = /^Citation Key:\s*(\S+)/m.exec(d.extra ?? "");
  if (m) return m[1];
  const base = asciiFold(lastName(d)).replace(/[^A-Za-z]/g, "") || "Anon";
  return `${base}${year(d) || "nd"}`;
}

export const titleOf = (d: ItemData) =>
  (d.title || d.filename || "Untitled").trim();

/** Python's str.strip(): whitespace only, Unicode-aware. */
const pyStrip = (s: string) => s.replace(/^\s+|\s+$/gu, "");

export function safeFilename(text: string, limit = 90): string {
  let t = text.replace(/[\\/:*?"<>|#^[\]]/g, "");
  t = pyStrip(t.replace(/\s+/g, " ")).replace(/\.+$/, "");
  if ([...t].length > limit) {
    const cut = [...t].slice(0, limit).join("");
    const at = cut.lastIndexOf(" ");
    t = at >= 0 ? cut.slice(0, at) : cut;
  }
  return t;
}

export const LINK_RE = /\[\[([^\]|#]+)((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]/g;

export const norm = (text: string) =>
  asciiFold(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const LINK_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "into",
  "about",
  "between",
  "del",
  "las",
  "los",
  "una",
  "por",
  "con",
  "des",
  "les",
  "der",
  "die",
  "und",
]);
const words = (text: string) =>
  (
    asciiFold(text)
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  ).filter((w) => w.length > 1 && !LINK_STOPWORDS.has(w));

export const noteName = (path: string) =>
  (path.split("/").pop() as string).slice(0, -3);

/** Finds the paper a [[link]] typed in Zotero means (see the Python's PaperFinder). */
export class PaperFinder {
  private exact = new Map<string, Set<string>>();
  private papers: [string, Set<string>, string, Set<string>][] = [];
  constructor(
    cache: Cache,
    private paths: Record<string, string>,
    private reserved: Set<string>,
  ) {
    for (const [k, item] of cache) {
      if (!isPaper(item)) continue;
      const d = item.data;
      const names = [norm(lastName(d) + year(d)), norm(citekey(d))];
      if (k in paths) names.push(norm(noteName(paths[k])));
      for (const n of names) {
        if (!n) continue;
        if (!this.exact.has(n)) this.exact.set(n, new Set());
        (this.exact.get(n) as Set<string>).add(k);
      }
      const surnames = new Set<string>(
        (d.creators ?? []).flatMap((c: ItemData) =>
          words(c.lastName || c.name || ""),
        ),
      );
      this.papers.push([k, surnames, year(d), new Set(words(titleOf(d)))]);
    }
  }

  find(text: string): string | null {
    if (this.reserved.has(norm(text))) return null;
    const exact = this.exact.get(norm(text));
    if (exact && exact.size === 1) return [...exact][0];
    const query = words(text);
    if (!query.length) return null;
    const fits = (
      w: string,
      surnames: Set<string>,
      yr: string,
      title: Set<string>,
    ) =>
      w === yr ||
      surnames.has(w) ||
      title.has(w) ||
      (w.length >= 3 &&
        ([...surnames].some((s) => s.startsWith(w)) ||
          [...title].some((t) => t.startsWith(w))));
    let hits = this.papers
      .filter(([, s, y, t]) => query.every((w) => fits(w, s, y, t)))
      .map(([k]) => k);
    if (hits.length > 1) {
      const inVault = hits.filter((k) => k in this.paths);
      hits = inVault.length ? inVault : hits;
    }
    return hits.length === 1 ? hits[0] : null;
  }
}

export function linkFixer(
  paths: Record<string, string>,
  cache: Cache,
  reserved: Set<string>,
) {
  const finder = new PaperFinder(cache, paths, reserved);
  return (text: string) =>
    text.replace(
      new RegExp(LINK_RE.source, "g"),
      (_m, name: string, anchor: string, alias: string) => {
        const k = finder.find(name);
        const target = k && k in paths ? noteName(paths[k]) : pyStrip(name);
        return `[[${target}${anchor}${alias}]]`;
      },
    );
}

function pageIndex(ann: Item): number | null {
  try {
    const p = JSON.parse(ann.data.annotationPosition || "{}").pageIndex;
    return typeof p === "number" ? p : null;
  } catch {
    return null;
  }
}

export function pageUrl(attKey: string, ann: Item): string {
  const page = pageIndex(ann);
  let q = `annotation=${ann.key}`;
  if (page !== null) q = `page=${page + 1}&${q}`;
  return `zotero://open-pdf/library/items/${attKey}?${q}`;
}

export function pageLink(attKey: string, ann: Item): string {
  const label = ann.data.annotationPageLabel || "";
  return `[${label ? `p. ${label}` : "open"}](${pageUrl(attKey, ann)})`;
}

const LIGATURES: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};

export function cleanText(text: string): string {
  let t = (text || "").replace(/­\s*/g, "");
  t = [...t].map((c) => LIGATURES[c] ?? c).join("");
  t = t.replace(/([a-z])- (?!(?:and|or|to|nor|as|vs)\b)([a-z])/g, "$1$2");
  t = t.replace(/([A-Z0-9])- ([A-Za-z0-9])/g, "$1-$2");
  t = t.replace(/[ \t]+/g, " ");
  return pyStrip(t.replace(/ *\n */g, "\n"));
}

/** Python's str.splitlines() on text already stripped. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches Python's own character classes
const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
const lines = (text: string) => text.split(LINE_BREAKS);

export const quote = (text: string) =>
  lines(pyStrip(text))
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/**
 * Python's f"{n:.{d}f}": correctly rounded, an exact half to even (29.25 is
 * "29.2"), where JavaScript's toFixed rounds an exact half up.
 */
export function fixed(n: number, d: number): string {
  // toFixed with many places gives the double's exact decimal digits.
  const exact = Math.abs(n).toFixed(Math.min(100, d + 40));
  const dot = exact.indexOf(".");
  const after = exact.slice(dot + 1 + d);
  if (/^50*$/.test(after)) {
    const kept = exact.slice(0, dot + 1 + d).replace(/\.$/, "");
    const last = Number(kept[kept.length - 1]);
    const down = last % 2 === 0;
    const value = down ? kept : (Math.abs(n) + 0.5 * 10 ** -d).toFixed(d);
    return (n < 0 && Number(value) !== 0 ? "-" : "") + value;
  }
  return n.toFixed(d);
}

export function inkSvg(ann: Item): string | null {
  const d = ann.data;
  let pos: { paths?: number[][]; width?: number };
  try {
    pos = JSON.parse(d.annotationPosition || "{}");
  } catch {
    return null;
  }
  const strokes = (pos.paths ?? [])
    .filter((p) => p.length >= 4)
    .map((p) => {
      const pts: [number, number][] = [];
      for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
      return pts;
    });
  if (!strokes.length) return null;
  const width = Math.max(Number(pos.width) || 1, 0.8);
  const xs = strokes.flatMap((s) => s.map(([x]) => x));
  const ys = strokes.flatMap((s) => s.map(([, y]) => y));
  const pad = width + 4;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  let color = d.annotationColor || "#000000";
  if (["#aaaaaa", "#ffd400", "#ffffff"].includes(color.toLowerCase()))
    color = "#222222";
  const polylines = strokes
    .map((s) =>
      s
        .map(([x, y]) => `${fixed(x - x0, 1)},${fixed(h - (y - y0), 1)}`)
        .join(" "),
    )
    .map((pts) => `<polyline points="${pts}"/>`)
    .join("\n");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fixed(w, 1)} ${fixed(h, 1)}" ` +
    `width="${fixed(w * 1.5, 0)}" height="${fixed(h * 1.5, 0)}">\n` +
    `<rect width="100%" height="100%" rx="6" fill="#fffdf7"/>\n` +
    `<g fill="none" stroke="${color}" stroke-width="${fixed(width, 2)}" ` +
    `stroke-linecap="round" stroke-linejoin="round">\n${polylines}\n</g>\n</svg>\n`
  );
}

const THOUGHT_LINK = /(\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]*\))/;

/** A comment under a passage: italic, faded, its links left clickable. */
export function thought(text: string): string {
  return lines(text)
    .map((line) => {
      if (!pyStrip(line)) return "";
      return line
        .split(THOUGHT_LINK)
        .filter(Boolean)
        .map((piece) =>
          new RegExp(`^${THOUGHT_LINK.source}$`).test(piece)
            ? `*${piece}*`
            : `<em style="opacity: 0.6">${piece.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</em>`,
        )
        .join("");
    })
    .join("\n");
}

export function renderAnnotation(
  attKey: string,
  ann: Item,
  fix: (t: string) => string,
  files: Map<string, string>,
  ideas: Record<string, string | null>,
): string {
  const d = ann.data;
  const kind = d.annotationType;
  const color = COLORS[(d.annotationColor || "").toLowerCase()] ?? "";
  const comment = pyStrip(d.annotationComment || "");
  const link = pageLink(attKey, ann);
  const block = `^${ann.key.toLowerCase()}`;
  const tag = color ? ` #hl/${color}` : "";
  const out: string[] = [];
  let svg: string | null;
  if ((kind === "highlight" || kind === "underline") && d.annotationText) {
    out.push(
      quote(cleanText(d.annotationText)),
      `> — ${link}${tag}`,
      "",
      block,
    );
  } else if (kind === "note") {
    out.push(`📝 ${link}${tag} ${block}`);
  } else if (kind === "ink" && (svg = inkSvg(ann))) {
    const name = `ink-${ann.key.toLowerCase()}.svg`;
    files.set(name, svg);
    out.push(`![[${name}]]`, `✍️ ${link} ${block}`);
  } else {
    out.push(`*(${kind} annotation)* ${link}${tag} ${block}`);
  }
  if (comment) out.push("", thought(fix(comment)));
  const idea = ideas[ann.key];
  if (idea) out.push("", `💡 [[${noteName(idea)}]]`);
  return out.join("\n");
}

export function relatedKeys(d: ItemData): string[] {
  const rel = d.relations?.["dc:relation"] ?? [];
  return (typeof rel === "string" ? [rel] : rel).map(
    (u: string) => u.replace(/\/+$/, "").split("/").pop() as string,
  );
}

export function renderBody(
  key: string,
  cache: Cache,
  paths: Record<string, string>,
  files: Map<string, string>,
  ideas: Record<string, string | null>,
  fix: (t: string) => string,
  forceTag: string,
  topics: string[] = [],
  namedIdeas: string[] = [],
  groupsLines: [string, string[]][] = [],
): string {
  const d = (cache.get(key) as Item).data;
  const { attachments, annotations, notes } = gather(key, cache);
  const authors = creators(d);
  const pub =
    d.publicationTitle ||
    d.bookTitle ||
    d.proceedingsTitle ||
    d.websiteTitle ||
    d.publisher ||
    "";
  const out = [`# ${titleOf(d)}`, ""];
  const meta = [authors.join(", "), year(d), pub ? `*${pub}*` : ""]
    .filter(Boolean)
    .join(" · ");
  if (meta) out.push(meta, "");
  const links = [`[Zotero](zotero://select/library/items/${key})`];
  const readable = attachments.filter((a) =>
    READABLE_ATTACHMENTS.has(a.data.contentType),
  );
  if (readable.length)
    links.push(
      `[Open PDF](zotero://open-pdf/library/items/${readable[0].key})`,
    );
  if (d.DOI) links.push(`[DOI](https://doi.org/${d.DOI})`);
  else if (d.url) links.push(`[Web](${d.url})`);
  out.push(links.join(" · "), "");
  if (topics.length)
    out.push(`Topics: ${topics.map((t) => `[[${t}]]`).join(" · ")}`, "");
  if (namedIdeas.length)
    out.push(`Ideas: ${namedIdeas.map((t) => `[[${t}]]`).join(" · ")}`, "");
  for (const [label, names] of groupsLines) {
    if (names.length)
      out.push(`${label}: ${names.map((t) => `[[${t}]]`).join(" · ")}`, "");
  }
  if (d.abstractNote) out.push("## Abstract", "", quote(d.abstractNote), "");
  const rendered = annotations.filter(([, anns]) => anns.length);
  if (rendered.length) {
    out.push("## Highlights", "");
    for (const [att, anns] of rendered) {
      if (rendered.length > 1) out.push(`### ${titleOf(att.data)}`, "");
      for (const ann of anns)
        out.push(renderAnnotation(att.key, ann, fix, files, ideas), "");
    }
  }
  const related = relatedKeys(d).filter(
    (k) => cache.has(k) && isPaper(cache.get(k) as Item),
  );
  if (related.length) {
    out.push("## Related papers", "");
    for (const k of related) {
      const rd = (cache.get(k) as Item).data;
      const label = `${lastName(rd)} (${year(rd) || "n.d."}) ${titleOf(rd)}`;
      out.push(
        k in paths
          ? `- [[${noteName(paths[k])}]] ${titleOf(rd)}`
          : `- [${label}](zotero://select/library/items/${k}) *(not in vault; tag \`${forceTag}\` to add)*`,
      );
    }
    out.push("");
  }
  if (notes.length) {
    out.push("## Zotero notes", "");
    const sorted = [...notes].sort((a, b) =>
      cmp(a.data.dateAdded ?? "", b.data.dateAdded ?? ""),
    );
    for (const n of sorted)
      out.push(fix(htmlToMarkdown(n.data.note)), "", "---", "");
    out.pop();
    out.pop();
  }
  return `${out.join("\n").replace(/\s+$/u, "")}\n`;
}

export function ownedFrontmatter(
  key: string,
  cache: Cache,
): Record<string, YamlValue> {
  const d = (cache.get(key) as Item).data;
  const y = year(d);
  const tags = (d.tags ?? []).map((t: { tag: string }) => t.tag);
  const fm: Record<string, YamlValue> = {
    title: titleOf(d),
    authors: creators(d),
    year: y ? Number.parseInt(y, 10) : null,
    publication: d.publicationTitle || d.bookTitle || null,
    doi: d.DOI || null,
    url: d.url || null,
    item_type: d.itemType,
    citekey: citekey(d),
    zotero_key: key,
    zotero_tags: tags.length ? tags : null,
    aliases: [titleOf(d)],
  };
  return Object.fromEntries(
    Object.entries(fm).filter(
      ([, v]) => !(v === null || v === "" || (Array.isArray(v) && !v.length)),
    ),
  );
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

const dump = (fm: Record<string, YamlValue>) => dumpYaml(fm);

/** The paper note's new text, or null when its markers were removed by hand. */
export function mergeNote(
  existing: string | null,
  body: string,
  owned: Record<string, YamlValue>,
): string | null {
  let fm: Record<string, YamlValue>;
  let rest: string;
  if (existing === null) {
    fm = { ...owned, tags: ["paper"], status: "to-process" };
    rest = `${BEGIN}\n${body}${END}\n\n## My notes\n\n`;
  } else {
    const m = FM_RE.exec(existing);
    fm = m ? loadYaml(m[1]) : {};
    rest = m ? existing.slice(m[0].length) : existing;
    if (!rest.includes(BEGIN) || !rest.includes(END)) return null;
    for (const k of OWNED_KEYS) delete fm[k];
    fm = { ...owned, ...fm };
    const at = rest.indexOf(BEGIN);
    const pre = rest.slice(0, at);
    const tail = rest.slice(at + BEGIN.length);
    const post = tail.slice(tail.indexOf(END) + END.length);
    rest = `${pre}${BEGIN}\n${body}${END}${post}`;
  }
  return `---\n${dump(fm)}---\n${rest}`;
}

// ------------------------------------------------------------------ ideas

export function ideaTitle(text: string): string {
  const ls = lines(pyStrip(text)).map((l) => pyStrip(l));
  const first = ls.length ? ls[0].replace(/^[#>*\-\s]+/, "") : "";
  if ([...first].length <= 80) return safeFilename(first, 80);
  const m = /^(.{20,80}?[.?!])\s/s.exec(`${first} `);
  return m ? safeFilename(m[1], 80) : `${safeFilename(first, 80)}…`;
}

export function settled(ann: Item, now: Date): boolean {
  const modified = Date.parse(ann.data.dateModified ?? "");
  if (Number.isNaN(modified)) return true;
  return (now.getTime() - modified) / 1000 >= IDEA_SETTLE_S;
}

export async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ideaNote(
  text: string,
  ann: Item,
  paperName: string,
  fix: (t: string) => string,
  created: string,
): string {
  const d = ann.data;
  const fm: Record<string, YamlValue> = {
    tags: ["idea"],
    created,
    source: `[[${paperName}]]`,
    zotero_annotation: ann.key,
  };
  const page = d.annotationPageLabel;
  const where = `[[${paperName}#^${ann.key.toLowerCase()}]]${page ? ` (p. ${page})` : ""}`;
  const out = [fix(text), "", "## Evidence", "", `- ${where}`];
  if (d.annotationText) out.push(quote(cleanText(d.annotationText)));
  out.push("", "## Related ideas", "", "- ", "");
  return `---\n${dump(fm)}---\n${out.join("\n")}`;
}

// ----------------------------------------------------------------- topics

/** {name: {paper: [highlights tagged with it]}}, as the sync's topic_members. */
export function topicMembers(
  cache: Cache,
  pattern: RegExp,
): Map<string, Map<string, Item[]>> {
  const members = new Map<string, Map<string, Item[]>>();
  const spelling = new Map<string, string>();
  for (const item of cache.values()) {
    const d = item.data;
    if (d.deleted) continue;
    const names = topicsOf(item, pattern);
    if (!names.length) continue;
    const paper = topLevelKey(item, cache);
    const p = cache.get(paper);
    if (!p || !isPaper(p)) continue;
    for (let name of names) {
      if (!spelling.has(norm(name))) spelling.set(norm(name), name);
      name = spelling.get(norm(name)) as string;
      if (!members.has(name)) members.set(name, new Map());
      const papers = members.get(name) as Map<string, Item[]>;
      if (!papers.has(paper)) papers.set(paper, []);
      if (d.itemType === "annotation") (papers.get(paper) as Item[]).push(item);
    }
  }
  for (const papers of members.values()) {
    for (const anns of papers.values()) {
      anns.sort((a, b) =>
        cmp(a.data.annotationSortIndex ?? "", b.data.annotationSortIndex ?? ""),
      );
    }
  }
  return members;
}

/** {tag: {paper: [highlights]}} for exact tags (notes paired with a Zotero tag). */
export function exactTagMembers(
  cache: Cache,
  tags: Set<string>,
): Map<string, Map<string, Item[]>> {
  const members = new Map<string, Map<string, Item[]>>();
  for (const item of cache.values()) {
    const d = item.data;
    if (d.deleted) continue;
    for (const t of d.tags ?? []) {
      if (t.type === 1 || !tags.has(t.tag)) continue;
      const paper = topLevelKey(item, cache);
      const p = cache.get(paper);
      if (!p || !isPaper(p)) continue;
      if (!members.has(t.tag)) members.set(t.tag, new Map());
      const papers = members.get(t.tag) as Map<string, Item[]>;
      if (!papers.has(paper)) papers.set(paper, []);
      if (d.itemType === "annotation") (papers.get(paper) as Item[]).push(item);
    }
  }
  for (const papers of members.values()) {
    for (const anns of papers.values()) {
      anns.sort((a, b) =>
        cmp(a.data.annotationSortIndex ?? "", b.data.annotationSortIndex ?? ""),
      );
    }
  }
  return members;
}

export function passage(
  ann: Item,
  paperName: string,
  fix: (t: string) => string,
  files: Map<string, string>,
): string {
  const d = ann.data;
  const attKey = d.parentItem || "";
  const kind = d.annotationType;
  const page = d.annotationPageLabel;
  const label = page ? `${paperName}, p. ${page}` : paperName;
  const where = `> — [[${paperName}#^${ann.key.toLowerCase()}|${label}]] · [PDF](${pageUrl(attKey, ann)})`;
  const out: string[] = [];
  let svg: string | null;
  if ((kind === "highlight" || kind === "underline") && d.annotationText) {
    out.push(quote(cleanText(d.annotationText)), where);
  } else if (kind === "ink" && (svg = inkSvg(ann))) {
    const name = `ink-${ann.key.toLowerCase()}.svg`;
    files.set(name, svg);
    out.push(`![[${name}]]`, where);
  } else {
    out.push(where);
  }
  const comment = pyStrip(d.annotationComment || "");
  if (comment) out.push("", thought(fix(comment)));
  return out.join("\n");
}

export function topicBody(
  papers: Map<string, Item[]>,
  cache: Cache,
  paths: Record<string, string>,
  fix: (t: string) => string,
  files: Map<string, string>,
): string {
  const order = [...papers.keys()].sort((a, b) => {
    const da = (cache.get(a) as Item).data;
    const db = (cache.get(b) as Item).data;
    return (
      cmp(year(da) || "9999", year(db) || "9999") ||
      cmp(lastName(da), lastName(db))
    );
  });
  const out = ["## Literature", ""];
  for (const k of order) {
    const d = (cache.get(k) as Item).data;
    out.push(
      `- [[${noteName(paths[k])}]] ${titleOf(d)} (${year(d) || "n.d."})`,
    );
  }
  out.push("");
  const withPassages = order.filter((k) => (papers.get(k) as Item[]).length);
  if (withPassages.length) {
    out.push("## Passages", "");
    for (const k of withPassages) {
      const name = noteName(paths[k]);
      out.push(`### [[${name}]] ${titleOf((cache.get(k) as Item).data)}`, "");
      for (const ann of papers.get(k) as Item[])
        out.push(passage(ann, name, fix, files), "");
    }
  }
  return `${out.join("\n").replace(/\s+$/u, "")}\n`;
}

/** A topic or idea note's new text, or null when its markers were removed by hand. */
export function mergeTopic(
  existing: string | null,
  topicId: string,
  body: string,
  kind: string,
  today: string,
  heading: string,
  kindTag: string = kind,
): string | null {
  const block = `${BEGIN}\n${body}${END}`;
  if (existing === null) {
    const fm: Record<string, YamlValue> = {
      tags: [kindTag],
      created: today,
      [`zotero_${kind}`]: topicId,
    };
    return `---\n${dump(fm)}---\n${heading}\n\n\n${block}\n\n## My notes\n\n`;
  }
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const at = existing.indexOf(BEGIN);
    const pre = existing.slice(0, at);
    const tail = existing.slice(at + BEGIN.length);
    const post = tail.slice(tail.indexOf(END) + END.length);
    return `${pre}${block}${post}`;
  }
  if (existing.includes(`zotero_${kind}: ${topicId}`)) return null;
  return `${existing.replace(/\n+$/, "")}\n\n${block}\n`;
}
