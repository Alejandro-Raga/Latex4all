import { invoke } from "@tauri-apps/api/core";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { extractCheckableSpans } from "./latex-spellcheck-spans";

const DEBOUNCE_MS = 600;
const MARK = Decoration.mark({ class: "cm-misspelled" });

/** `${language}|${word}` -> correctly spelled?, shared across files so a
 * word checked once (in a given language) stays known. */
const spellingCache = new Map<string, boolean>();

export function clearSpellingCache(): void {
  spellingCache.clear();
}

const setMisspellings =
  StateEffect.define<readonly { from: number; to: number }[]>();
/** Dispatched to instantly re-derive decorations from the existing cache —
 * e.g. after the user ignores a word — without a network round-trip. */
const refreshSpelling = StateEffect.define<void>();
/** Dispatched to bypass the debounce and re-check right away — e.g. after
 * switching the check language, so it doesn't wait for the next edit or a
 * file switch to take effect. */
const forceRecheck = StateEffect.define<void>();
/** Dispatched alongside a fix's own text-replacing change so the old
 * underline disappears in that same transaction, not after the next
 * debounced recheck. */
const clearInRange = StateEffect.define<{ from: number; to: number }>();

export function refreshSpellingDecorations(view: EditorView): void {
  view.dispatch({ effects: refreshSpelling.of(undefined) });
}

export function forceSpellcheckRecheck(view: EditorView): void {
  view.dispatch({ effects: forceRecheck.of(undefined) });
}

/** An effect that clears any misspelling highlight over `[from, to)` —
 * combine into a replacement's own dispatch (alongside the text-changing
 * `changes`) so the old underline disappears in that same transaction,
 * not after the next debounced recheck. */
export function clearMisspellingEffect(
  from: number,
  to: number,
): StateEffect<{ from: number; to: number }> {
  return clearInRange.of({ from, to });
}

const misspellingField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMisspellings)) {
        decorations = Decoration.set(
          effect.value.map(({ from, to }) => MARK.range(from, to)),
        );
      }
      if (effect.is(clearInRange)) {
        decorations = decorations.update({
          filterFrom: effect.value.from,
          filterTo: effect.value.to,
          filter: () => false,
        });
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class SpellcheckPlugin {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastSpans: { from: number; to: number; word: string }[] = [];

  constructor(
    private view: EditorView,
    private language: () => string,
    private isIgnored: (word: string) => boolean,
  ) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.schedule();
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        // Dispatching synchronously from inside a ViewPlugin's update() is
        // invalid in CodeMirror ("Calls to EditorView.update are not
        // allowed while an update is in progress") — it's caught internally
        // and silently dropped, so redecorate()/run() never actually took
        // effect. Deferring past the current update cycle fixes that.
        if (effect.is(refreshSpelling)) {
          queueMicrotask(() => this.redecorate());
        }
        if (effect.is(forceRecheck)) {
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

  /** Rebuilds decorations from the last-checked spans + current cache/ignore
   * list, with no server round-trip — used for immediate feedback. */
  private redecorate(): void {
    if (this.destroyed) return;
    const ranges = this.lastSpans.filter(
      (s) => this.isCachedMisspelled(s.word) && !this.isIgnored(s.word),
    );
    this.view.dispatch({ effects: setMisspellings.of(ranges) });
  }

  private isCachedMisspelled(word: string): boolean {
    return spellingCache.get(`${this.language()}|${word}`) === false;
  }

  private async run(): Promise<void> {
    const text = this.view.state.doc.toString();
    const spans = extractCheckableSpans(text);
    this.lastSpans = spans;
    const language = this.language();
    const unknown = [...new Set(spans.map((s) => s.word))].filter(
      (w) => !spellingCache.has(`${language}|${w}`),
    );

    if (unknown.length > 0) {
      try {
        const misspelled = await invoke<string[]>("check_spelling", {
          words: unknown,
          language,
        });
        const misspelledSet = new Set(misspelled);
        for (const w of unknown) {
          spellingCache.set(`${language}|${w}`, !misspelledSet.has(w));
        }
      } catch {
        for (const w of unknown) spellingCache.set(`${language}|${w}`, true);
      }
    }

    if (this.destroyed) return;
    if (this.view.state.doc.toString() !== text) return;

    const ranges = spans.filter(
      (s) => this.isCachedMisspelled(s.word) && !this.isIgnored(s.word),
    );
    this.view.dispatch({ effects: setMisspellings.of(ranges) });
  }
}

export function spellcheckExtension(options: {
  language: () => string;
  isIgnored: (word: string) => boolean;
}) {
  return [
    misspellingField,
    ViewPlugin.define(
      (view) => new SpellcheckPlugin(view, options.language, options.isIgnored),
    ),
  ];
}
