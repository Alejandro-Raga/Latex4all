/**
 * Reading Obsidian notes: their frontmatter, and the [[links]] between them.
 */

export type FrontmatterValue = string | number | boolean | string[] | null;
export type Frontmatter = Record<string, FrontmatterValue>;

export interface NoteLink {
  /** The note named in the link, as written: `Nelson1959` in `[[Nelson1959#^ab|see]]`. */
  target: string;
  /** Heading or block after `#`, without the `#`. */
  anchor: string | null;
}

export interface ParsedNote {
  /** Path inside the vault, e.g. `Papers/Nelson1959.md`. */
  path: string;
  /** File name without `.md`: what [[links]] point at. */
  name: string;
  /** First folder of the path, or "" at the vault root. */
  folder: string;
  frontmatter: Frontmatter;
  /** The note without its frontmatter. */
  body: string;
  links: NoteLink[];
  /** Files shown inside the note with `![[...]]` (images, PDFs, other notes). */
  embeds: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const WIKILINK_RE = /(!?)\[\[([^\]|#\n]*)(?:#([^\]|\n]*))?(?:\|[^\]\n]*)?\]\]/g;

function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    (v[0] === "'" || v[0] === '"') &&
    v[v.length - 1] === v[0]
  ) {
    return v[0] === "'" ? v.slice(1, -1).replace(/''/g, "'") : v.slice(1, -1);
  }
  return v;
}

function scalar(value: string): FrontmatterValue {
  const v = value.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(",").map(unquote).filter(Boolean) : [];
  }
  return unquote(v);
}

/**
 * The subset of YAML Obsidian frontmatter uses: `key: value`, inline lists
 * `[a, b]`, and block lists of `- item` lines. Anything else is kept as text.
 */
export function parseFrontmatter(yaml: string): Frontmatter {
  const out: Frontmatter = {};
  let listKey: string | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      const list = out[listKey];
      const value = unquote(item[1]);
      out[listKey] = Array.isArray(list) ? [...list, value] : [value];
      continue;
    }
    const pair = line.match(/^([^\s:#][^:]*):(?:\s+(.*))?$/);
    if (!pair) continue;
    const key = pair[1].trim();
    const value = pair[2] ?? "";
    out[key] = scalar(value);
    listKey = value.trim() === "" ? key : null;
  }
  return out;
}

/** The note text with code, comments and math blanked out, so links in them don't count. */
function linkableText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/%%[\s\S]*?%%/g, " ");
}

export function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export function parseNote(path: string, text: string): ParsedNote {
  const match = text.match(FRONTMATTER_RE);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  const body = match ? text.slice(match[0].length) : text;

  const links: NoteLink[] = [];
  const embeds: string[] = [];
  for (const m of linkableText(body).matchAll(WIKILINK_RE)) {
    const target = m[2].trim();
    if (m[1]) {
      if (target) embeds.push(target);
      continue;
    }
    if (target) links.push({ target, anchor: m[3]?.trim() || null });
  }
  // `source:` on idea notes made from Zotero names the paper they came from.
  for (const value of Object.values(frontmatter)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string") continue;
      for (const m of v.matchAll(WIKILINK_RE)) {
        if (!m[1] && m[2].trim())
          links.push({ target: m[2].trim(), anchor: null });
      }
    }
  }

  const parts = path.split("/");
  return {
    path,
    name: noteName(path),
    folder: parts.length > 1 ? parts[0] : "",
    frontmatter,
    body,
    links,
    embeds,
  };
}

/**
 * A frontmatter value by key, ignoring case when there's no exact match:
 * templates write `Title:` and `Authors:` as often as `title:`.
 */
function fieldValue(fm: Frontmatter, key: string) {
  if (key in fm) return fm[key];
  const lower = key.toLowerCase();
  const found = Object.keys(fm).find((k) => k.toLowerCase() === lower);
  return found === undefined ? undefined : fm[found];
}

/** A frontmatter field as a list of strings, whatever form it was written in. */
export function listField(fm: Frontmatter, key: string): string[] {
  const value = fieldValue(fm, key);
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

export function textField(fm: Frontmatter, key: string): string | null {
  const value = fieldValue(fm, key);
  if (value === null || value === undefined || Array.isArray(value))
    return null;
  return String(value);
}
