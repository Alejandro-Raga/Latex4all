/**
 * Bringing a .bib file up to date with a Zotero collection, without losing
 * what Zotero doesn't know about: entries someone added by hand (or a
 * collaborator, from their own library) stay, and a paper keeps the
 * citation key the text already uses even if Zotero would now make another.
 */

/** A .bib file's entries by citation key, in file order. */
export function parseBibEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const part of content.split(/\n(?=@)/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^@\w+\s*\{\s*([^,\s]+)/);
    if (match) entries.set(match[1], trimmed);
  }
  return entries;
}

/** The entry with its citation key changed. */
export function rekey(bibtex: string, key: string): string {
  return bibtex.replace(/^(@\w+\s*\{\s*)[^,\s]+/, `$1${key}`);
}

export interface SyncedEntry {
  /** Zotero item key. */
  key: string;
  citekey: string;
  bibtex: string;
}

/**
 * The .bib after a sync. `complete` means `updated` is everything in the
 * collection now (a collection re-read); otherwise it's what changed since
 * last time, with `deleted` gone from Zotero.
 */
export function mergeSyncedBib(input: {
  content: string;
  /** Zotero item key → citation key, as of the last sync. */
  keyMap: Record<string, string>;
  updated: SyncedEntry[];
  deleted?: string[];
  complete: boolean;
}): { content: string; keyMap: Record<string, string> } {
  const existing = parseBibEntries(input.content);
  const fromZotero = new Set(Object.values(input.keyMap));
  const keyMap: Record<string, string> = input.complete
    ? {}
    : { ...input.keyMap };
  const fresh = new Map<string, string>();
  for (const entry of input.updated) {
    if (!entry.bibtex.trim()) continue;
    // The key the project already knows this paper by, if any.
    const key = input.keyMap[entry.key] ?? entry.citekey;
    keyMap[entry.key] = key;
    fresh.set(
      key,
      key === entry.citekey
        ? entry.bibtex.trim()
        : rekey(entry.bibtex.trim(), key),
    );
  }
  const gone = new Set<string>();
  for (const item of input.deleted ?? []) {
    const key = input.keyMap[item];
    if (key) gone.add(key);
    delete keyMap[item];
  }

  const out = new Map<string, string>();
  for (const [key, bibtex] of existing) {
    if (fresh.has(key)) {
      out.set(key, fresh.get(key) as string);
    } else if (!fromZotero.has(key)) {
      // Not from Zotero: added by hand or by someone else. It stays.
      out.set(key, bibtex);
    } else if (!input.complete && !gone.has(key)) {
      // From Zotero, unchanged since last time.
      out.set(key, bibtex);
    }
  }
  for (const [key, bibtex] of fresh) if (!out.has(key)) out.set(key, bibtex);
  return { content: `${[...out.values()].join("\n\n")}\n`, keyMap };
}
