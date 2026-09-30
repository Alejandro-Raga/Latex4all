/**
 * Suggestions for [[links]] while writing a note: after "[[", the vault's
 * notes, narrowed as you type by name, title, citation key, authors or
 * alias, so a paper can be linked without remembering what its note is
 * called.
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { VaultIndex, VaultNote } from "./vault-index";

const fold = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** How well a note matches what's typed; 0 when it doesn't. */
export function linkScore(note: VaultNote, typed: string): number {
  const words = fold(typed).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const name = fold(note.name);
  const fields = [
    name,
    fold(note.title),
    fold(note.citekey ?? ""),
    fold(note.authors.join(" ")),
    fold(note.aliases.join(" ")),
  ].join(" ");
  let score = 0;
  for (const w of words) {
    if (!fields.includes(w)) return 0;
    score += name.startsWith(w) ? 4 : name.includes(w) ? 3 : 1;
  }
  return score;
}

/** Notes for what's typed after "[[", best first. */
export function linkSuggestions(
  index: VaultIndex,
  typed: string,
  exclude?: string,
  limit = 40,
): VaultNote[] {
  return index.list
    .filter((n) => n.name !== exclude)
    .map((note) => ({ note, score: linkScore(note, typed) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.note.kind === "paper") - Number(a.note.kind === "paper") ||
        a.note.name.localeCompare(b.note.name),
    )
    .slice(0, limit)
    .map((s) => s.note);
}

/**
 * A CodeMirror completion source for [[links]]. `getIndex` is read on each
 * keystroke, so it follows the vault as it changes.
 */
export function noteLinkCompletions(
  getIndex: () => VaultIndex | null,
  currentNote?: () => string | undefined,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[[^\]|#\n]*$/);
    if (!before) return null;
    const index = getIndex();
    if (!index) return null;
    const typed = before.text.slice(2);
    const from = before.from + 2;
    // Obsidian (and bracket auto-closing) may have put "]]" after the cursor.
    const after = context.state.sliceDoc(context.pos, context.pos + 2);
    const options: Completion[] = linkSuggestions(
      index,
      typed,
      currentNote?.(),
    ).map((note) => ({
      label: note.name,
      detail:
        note.kind === "paper"
          ? [note.authors[0]?.split(/[ ,]/).filter(Boolean).pop(), note.year]
              .filter(Boolean)
              .join(" ")
          : note.group || undefined,
      info: note.title !== note.name ? note.title : undefined,
      type: note.kind === "paper" ? "class" : "text",
      apply: (view, _completion, applyFrom, applyTo) => {
        const to = after === "]]" ? applyTo + 2 : applyTo;
        const insert = `${note.name}]]`;
        view.dispatch({
          changes: { from: applyFrom, to, insert },
          selection: { anchor: applyFrom + insert.length },
        });
      },
    }));
    // Every keystroke asks again: matching isn't by the label alone.
    return { from, options, filter: false };
  };
}
