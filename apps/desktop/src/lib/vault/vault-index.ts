import { listField, noteName, type ParsedNote, textField } from "./parse";

export type NoteKind = "paper" | "idea" | "topic" | "note";

export interface VaultNote extends ParsedNote {
  kind: NoteKind;
  /** Title to show: the paper's title, or the note name. */
  title: string;
  /** Zotero item key, for notes made from Zotero by the sync. */
  zoteroKey: string | null;
  citekey: string | null;
  /** Names of notes this one links to (resolved, no duplicates, not itself). */
  outgoing: string[];
  /** Names of notes that link here. */
  incoming: string[];
  /** Link targets with no note behind them yet. */
  unresolved: string[];
}

export interface VaultIndex {
  /** Keyed by lower-cased note name. */
  notes: Map<string, VaultNote>;
  /** Notes in display order. */
  list: VaultNote[];
}

function kindOf(note: ParsedNote): NoteKind {
  const tags = listField(note.frontmatter, "tags").map((t) =>
    t.toLowerCase().replace(/^#/, ""),
  );
  const folder = note.folder.toLowerCase();
  if (
    note.frontmatter.zotero_key ||
    tags.includes("paper") ||
    folder === "papers"
  )
    return "paper";
  if (tags.includes("idea") || folder === "ideas") return "idea";
  if (tags.includes("topic") || folder === "topics") return "topic";
  return "note";
}

export function buildVaultIndex(parsed: ParsedNote[]): VaultIndex {
  const notes = new Map<string, VaultNote>();
  // Obsidian links by file name; the first note with a name wins, like it.
  const sorted = [...parsed].sort((a, b) => a.path.localeCompare(b.path));
  for (const note of sorted) {
    const key = note.name.toLowerCase();
    if (notes.has(key)) continue;
    const fm = note.frontmatter;
    const kind = kindOf(note);
    notes.set(key, {
      ...note,
      kind,
      title: (kind === "paper" ? textField(fm, "title") : null) ?? note.name,
      zoteroKey: textField(fm, "zotero_key"),
      citekey: textField(fm, "citekey"),
      outgoing: [],
      incoming: [],
      unresolved: [],
    });
  }

  for (const note of notes.values()) {
    const out = new Set<string>();
    const missing = new Set<string>();
    for (const link of note.links) {
      const target = notes.get(noteName(link.target).toLowerCase());
      if (!target) missing.add(link.target);
      else if (target.name !== note.name) out.add(target.name);
    }
    note.outgoing = [...out];
    note.unresolved = [...missing];
    for (const name of out)
      notes.get(name.toLowerCase())?.incoming.push(note.name);
  }

  const order: Record<NoteKind, number> = {
    paper: 0,
    idea: 1,
    topic: 2,
    note: 3,
  };
  const list = [...notes.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name),
  );
  return { notes, list };
}

export function findNote(
  index: VaultIndex,
  name: string,
): VaultNote | undefined {
  return index.notes.get(noteName(name).toLowerCase());
}

/**
 * Notes within `depth` links of `name` (either direction), with the links
 * among them, for a local graph. `ring` is how many steps away a note is.
 */
export function neighbourhood(index: VaultIndex, name: string, depth = 1) {
  const centre = findNote(index, name);
  if (!centre) return { nodes: [], edges: [] };
  const ring = new Map<string, number>([[centre.name, 0]]);
  let frontier = [centre];
  for (let step = 1; step <= depth; step++) {
    const next: VaultNote[] = [];
    for (const note of frontier) {
      for (const n of [...note.outgoing, ...note.incoming]) {
        const other = findNote(index, n);
        if (other && !ring.has(other.name)) {
          ring.set(other.name, step);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const nodes = [...ring.keys()]
    .map((n) => findNote(index, n))
    .filter((n): n is VaultNote => Boolean(n))
    .map((note) => ({ note, ring: ring.get(note.name) ?? 0 }));
  const edges: { from: string; to: string }[] = [];
  for (const { note } of nodes) {
    for (const target of note.outgoing) {
      if (ring.has(target)) edges.push({ from: note.name, to: target });
    }
  }
  return { nodes, edges };
}

export function searchNotes(index: VaultIndex, query: string): VaultNote[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return index.list;
  const scored: { note: VaultNote; score: number }[] = [];
  for (const note of index.list) {
    const head = `${note.name} ${note.title} ${note.citekey ?? ""} ${listField(
      note.frontmatter,
      "authors",
    ).join(" ")}`.toLowerCase();
    const body = note.body.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (head.includes(w)) score += 3;
      else if (body.includes(w)) score += 1;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0) scored.push({ note, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.note);
}
