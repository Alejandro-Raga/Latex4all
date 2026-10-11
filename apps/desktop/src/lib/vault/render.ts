import { noteName } from "./parse";

const IMAGE_RE = /\.(svg|png|jpe?g|gif|webp|avif)$/i;

/** Link targets inside rendered notes: `vault:` opens a note, `vault-embed:` is a vault file. */
export const NOTE_HREF = "vault:";
export const EMBED_SRC = "vault-embed:";
/** A comment under a highlight, written faded by the Zotero sync. */
export const FADED_HREF = "faded:";

const FADED_RE = /<em style="opacity: ?0?\.6">([\s\S]*?)<\/em>/g;
const unescapeHtml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const escapeText = (text: string) => text.replace(/([[\]\\])/g, "\\$1");

/**
 * An Obsidian note body as plain Markdown: comments, block ids and highlight
 * colour tags dropped; [[links]] and ![[embeds]] turned into links and images
 * the panel knows how to follow and load; the sync's faded comments into
 * links to FADED_HREF, shown faded.
 */
export function vaultMarkdown(body: string): string {
  return body
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(
      FADED_RE,
      (_, text: string) => `[${escapeText(unescapeHtml(text))}](${FADED_HREF})`,
    )
    .replace(/[ \t]#hl\/[\w-]+/g, "")
    .replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm, "")
    .replace(
      /!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g,
      (_, target: string) => {
        const t = target.trim();
        return IMAGE_RE.test(t)
          ? `![${escapeText(t)}](${EMBED_SRC}${encodeURIComponent(t)})`
          : `[${escapeText(t)}](${NOTE_HREF}${encodeURIComponent(noteName(t))})`;
      },
    )
    .replace(
      /\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g,
      (
        _,
        target: string,
        anchor: string | undefined,
        alias: string | undefined,
      ) => {
        const t = target.trim();
        const heading = anchor && !anchor.startsWith("#^") ? anchor : "";
        const text = alias?.trim() || `${t}${heading}`;
        return `[${escapeText(text)}](${NOTE_HREF}${encodeURIComponent(t)})`;
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The note name a rendered `vault:` link points at, or null for other links. */
export function noteFromHref(href: string | undefined): string | null {
  return href?.startsWith(NOTE_HREF)
    ? decodeURIComponent(href.slice(NOTE_HREF.length))
    : null;
}
