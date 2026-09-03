import { invoke } from "@tauri-apps/api/core";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { sanitizeForGrammarCheck } from "./latex-grammar-sanitize";
import { buildExclusionMask } from "./latex-prose-mask";

const DEBOUNCE_MS = 1200;
const GRAMMAR_MARK = Decoration.mark({ class: "cm-grammar-issue" });
const SPELLING_MARK = Decoration.mark({ class: "cm-grammar-issue-spelling" });

export interface GrammarIssue {
  from: number;
  to: number;
  message: string;
  shortMessage: string;
  replacements: string[];
  category: string;
  isSpelling: boolean;
}

/** True if any position in [from, to) falls outside actual prose (LaTeX
 * commands, math, technical args) — used to drop issues LanguageTool raised
 * against the sanitizer's own space-padding rather than real text. */
function overlapsExcluded(mask: Uint8Array, from: number, to: number): boolean {
  const end = Math.min(to, mask.length);
  for (let i = Math.max(0, from); i < end; i++) {
    if (mask[i]) return true;
  }
  return false;
}

interface GrammarState {
  issues: readonly GrammarIssue[];
  decorations: DecorationSet;
}

const setGrammarIssues = StateEffect.define<readonly GrammarIssue[]>();
const forceRecheck = StateEffect.define<void>();
const clearIssuesInRange = StateEffect.define<{ from: number; to: number }>();

/** An effect that clears any grammar/spelling issue overlapping `[from,
 * to)` — combine into a replacement's own dispatch (alongside the
 * text-changing `changes`) so the old underline disappears in that same
 * transaction, not after the next debounced recheck. */
export function clearGrammarIssueEffect(
  from: number,
  to: number,
): StateEffect<{ from: number; to: number }> {
  return clearIssuesInRange.of({ from, to });
}

/** Bypasses the debounce and re-queries the server right away — e.g. after
 * un-ignoring a word, so it can be re-flagged without waiting for the next
 * edit. */
export function forceGrammarRecheck(view: EditorView): void {
  view.dispatch({ effects: forceRecheck.of(undefined) });
}

/** Instantly clears every grammar/spelling issue and its underline — e.g.
 * when the user disables the grammar checker, so old highlights don't
 * linger until the document is next edited. */
export function clearGrammarIssues(view: EditorView): void {
  if (view.state.field(grammarField).issues.length === 0) return;
  view.dispatch({ effects: setGrammarIssues.of([]) });
}

/** Instantly removes every current issue whose flagged text matches `word`
 * (case-insensitive) — e.g. after the user clicks "Ignore" — with no
 * server round-trip, so all occurrences clear at once, not just the one
 * being viewed. */
export function dismissGrammarIssuesForWord(
  view: EditorView,
  word: string,
): void {
  const target = word.toLowerCase();
  const current = view.state.field(grammarField).issues;
  const next = current.filter(
    (issue) =>
      view.state.sliceDoc(issue.from, issue.to).toLowerCase() !== target,
  );
  if (next.length !== current.length) {
    view.dispatch({ effects: setGrammarIssues.of(next) });
  }
}

function buildDecorations(issues: readonly GrammarIssue[]): DecorationSet {
  return Decoration.set(
    issues
      .slice()
      .sort((a, b) => a.from - b.from)
      .map((issue) =>
        (issue.isSpelling ? SPELLING_MARK : GRAMMAR_MARK).range(
          issue.from,
          issue.to,
        ),
      ),
  );
}

export const grammarField = StateField.define<GrammarState>({
  create() {
    return { issues: [], decorations: Decoration.none };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGrammarIssues)) {
        return {
          issues: effect.value,
          decorations: buildDecorations(effect.value),
        };
      }
    }

    let issues = value.issues;
    let changed = false;

    if (tr.docChanged) {
      // Map existing ranges through the edit so highlights stay roughly
      // correct until the next debounced check replaces them outright.
      issues = issues
        .map((issue) => ({
          ...issue,
          from: tr.changes.mapPos(issue.from, 1),
          to: tr.changes.mapPos(issue.to, -1),
        }))
        .filter((issue) => issue.from < issue.to);
      changed = true;
    }

    for (const effect of tr.effects) {
      if (effect.is(clearIssuesInRange)) {
        const { from, to } = effect.value;
        const next = issues.filter(
          (issue) => issue.to <= from || issue.from >= to,
        );
        if (next.length !== issues.length) {
          issues = next;
          changed = true;
        }
      }
    }

    if (!changed) return value;
    return { issues, decorations: buildDecorations(issues) };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

class GrammarCheckPlugin {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastChecked = "";

  constructor(
    private view: EditorView,
    private enabled: () => boolean,
    private serverUrl: () => string,
    private language: () => string,
    private isIgnored: (word: string) => boolean,
  ) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.schedule();
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(forceRecheck)) {
          this.lastChecked = ""; // bust the "nothing changed" short-circuit
          // Deferred defensively: run() always awaits before dispatching in
          // practice, but queueing keeps it safe even if that ever changes
          // (a synchronous dispatch from inside update() is silently
          // dropped by CodeMirror rather than erroring).
          queueMicrotask(() => void this.run());
        }
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.run();
    }, DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    if (!this.enabled()) return;

    const text = this.view.state.doc.toString();
    const sanitized = sanitizeForGrammarCheck(text);
    if (sanitized === this.lastChecked) return;

    let issues: GrammarIssue[] = [];
    try {
      issues = await invoke<GrammarIssue[]>("check_grammar", {
        text: sanitized,
        serverUrl: this.serverUrl(),
        language: this.language(),
      });
    } catch {
      // Server unreachable/misconfigured — leave existing decorations as-is
      // rather than clearing them on every transient failure.
      return;
    }

    // Drop anything touching a blanked-out (non-prose) region: LaTeX
    // commands themselves, and "repeated whitespace" false positives from
    // the sanitizer's own same-length space padding.
    const mask = buildExclusionMask(text);
    issues = issues.filter(
      (issue) =>
        !overlapsExcluded(mask, issue.from, issue.to) &&
        !this.isIgnored(text.slice(issue.from, issue.to)),
    );

    if (this.destroyed) return;
    if (this.view.state.doc.toString() !== text) return; // stale
    this.lastChecked = sanitized;

    this.view.dispatch({ effects: setGrammarIssues.of(issues) });
  }
}

export function grammarCheckExtension(options: {
  enabled: () => boolean;
  serverUrl: () => string;
  language: () => string;
  isIgnored: (word: string) => boolean;
}) {
  return [
    grammarField,
    ViewPlugin.define(
      (view) =>
        new GrammarCheckPlugin(
          view,
          options.enabled,
          options.serverUrl,
          options.language,
          options.isIgnored,
        ),
    ),
  ];
}
