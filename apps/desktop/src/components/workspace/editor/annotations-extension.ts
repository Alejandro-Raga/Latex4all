import {
  type EditorState,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { invertedEffects } from "@codemirror/commands";
import type { StoredAnnotation } from "@/lib/annotations/local-annotations";
import type { Annotation, AnnotationSuggestion } from "@/lib/annotations/types";

/**
 * Highlights and notes, drawn quietly: a soft background for a highlight, and
 * for one with a note a small faint glyph where it ends. Nothing goes in the
 * margin, so text never shifts. A resolved thread is greyed out.
 */

/** Replaces the file's annotations (e.g. after someone else changed one). */
export const setAnnotations = StateEffect.define<readonly Annotation[]>();

/**
 * A project that isn't shared: its annotations as an edit left them, kept in
 * the editor's history so undo and redo take them back with the text.
 */
export const annotationEdit = StateEffect.define<{
  path: string;
  before: StoredAnnotation[];
  after: StoredAnnotation[];
}>();

const annotationUndo = invertedEffects.of((tr) =>
  tr.effects
    .filter((e) => e.is(annotationEdit))
    .map((e) =>
      annotationEdit.of({
        path: e.value.path,
        before: e.value.after,
        after: e.value.before,
      }),
    ),
);

interface AnnotationsValue {
  annotations: readonly Annotation[];
  decorations: DecorationSet;
}

class NoteGlyph extends WidgetType {
  constructor(
    readonly id: string,
    readonly resolved: boolean,
  ) {
    super();
  }

  eq(other: NoteGlyph) {
    return other.id === this.id && other.resolved === this.resolved;
  }

  toDOM() {
    const glyph = document.createElement("span");
    glyph.className = this.resolved
      ? "cm-annotation-note cm-annotation-note-resolved"
      : "cm-annotation-note";
    glyph.dataset.annotationId = this.id;
    glyph.setAttribute("aria-label", this.resolved ? "Resolved note" : "Note");
    // lucide "message-square", reduced.
    glyph.innerHTML =
      '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    return glyph;
  }

  ignoreEvent() {
    return false;
  }
}

function suggestionClass(suggestion: AnnotationSuggestion) {
  if (suggestion.conflict) return "cm-annotation cm-annotation-conflict";
  return suggestion.text
    ? "cm-annotation cm-annotation-suggestion"
    : "cm-annotation cm-annotation-suggestion cm-annotation-suggestion-delete";
}

function build(annotations: readonly Annotation[], length: number) {
  const ranges: Range<Decoration>[] = [];
  for (const a of annotations) {
    const from = Math.max(0, Math.min(a.from, length));
    const to = Math.max(0, Math.min(a.to, length));
    if (from >= to) continue;
    // Resolved notes turn grey rather than vanishing, so they can be found.
    const className = a.suggestion
      ? suggestionClass(a.suggestion)
      : a.resolved
        ? "cm-annotation cm-annotation-resolved"
        : a.color === "none"
          ? null
          : `cm-annotation cm-annotation-${a.color}`;
    if (className) {
      ranges.push(
        Decoration.mark({
          class: className,
          attributes: { "data-annotation-id": a.id },
        }).range(from, to),
      );
    }
    if (a.comments.length > 0) {
      ranges.push(
        Decoration.widget({
          widget: new NoteGlyph(a.id, a.resolved),
          side: 1,
        }).range(to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

export const annotationsField = StateField.define<AnnotationsValue>({
  create: () => ({ annotations: [], decorations: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAnnotations)) {
        return {
          annotations: effect.value,
          decorations: build(effect.value, tr.state.doc.length),
        };
      }
    }
    if (!tr.docChanged) return value;
    // Until the next refresh from the source, follow the edits here, with
    // the same edges: typing just outside a highlight doesn't join it. Drawn
    // again from those edges, rather than moving the decorations along, or a
    // note's glyph would be pushed ahead of whatever is typed right after it.
    const annotations = value.annotations.map((a) => ({
      ...a,
      from: tr.changes.mapPos(a.from, 1),
      to: tr.changes.mapPos(a.to, -1),
    }));
    return {
      annotations,
      decorations: build(annotations, tr.state.doc.length),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

/** The innermost annotation at `pos`, resolved ones included. */
export function annotationAt(
  state: EditorState,
  pos: number,
): Annotation | null {
  let best: Annotation | null = null;
  for (const a of state.field(annotationsField).annotations) {
    if (pos < a.from || pos > a.to || a.from >= a.to) continue;
    if (!best || a.to - a.from < best.to - best.from) best = a;
  }
  return best;
}

export function annotationById(state: EditorState, id: string) {
  return (
    state.field(annotationsField).annotations.find((a) => a.id === id) ?? null
  );
}

const COLORS = {
  yellow: "250, 204, 21",
  green: "74, 222, 128",
  blue: "96, 165, 250",
  pink: "244, 114, 182",
  purple: "167, 139, 250",
};

export const annotationsTheme = EditorView.baseTheme({
  ...Object.fromEntries(
    Object.entries(COLORS).flatMap(([name, rgb]) => [
      [
        `&light .cm-annotation-${name}`,
        { backgroundColor: `rgba(${rgb}, 0.24)` },
      ],
      [
        `&dark .cm-annotation-${name}`,
        { backgroundColor: `rgba(${rgb}, 0.16)` },
      ],
    ]),
  ),
  "&light .cm-annotation-resolved": {
    backgroundColor: "rgba(148, 163, 184, 0.28)",
  },
  "&dark .cm-annotation-resolved": {
    backgroundColor: "rgba(148, 163, 184, 0.18)",
  },
  // Text two people changed at once: underlined, so it reads as needing a
  // look rather than as someone's highlight.
  "&light .cm-annotation-conflict": {
    backgroundColor: "rgba(249, 115, 22, 0.16)",
    textDecoration: "underline wavy rgba(234, 88, 12, 0.8)",
    textUnderlineOffset: "3px",
  },
  "&dark .cm-annotation-conflict": {
    backgroundColor: "rgba(249, 115, 22, 0.14)",
    textDecoration: "underline wavy rgba(251, 146, 60, 0.8)",
    textUnderlineOffset: "3px",
  },
  // A suggested edit: a dashed green underline, struck through if it's
  // suggesting the text be deleted.
  "&light .cm-annotation-suggestion": {
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    textDecoration: "underline dashed rgba(22, 163, 74, 0.9)",
    textUnderlineOffset: "3px",
  },
  "&dark .cm-annotation-suggestion": {
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    textDecoration: "underline dashed rgba(74, 222, 128, 0.85)",
    textUnderlineOffset: "3px",
  },
  "&light .cm-annotation-suggestion-delete": {
    textDecoration: "line-through rgba(22, 163, 74, 0.9)",
  },
  "&dark .cm-annotation-suggestion-delete": {
    textDecoration: "line-through rgba(74, 222, 128, 0.85)",
  },
  ".cm-annotation": { borderRadius: "2px" },
  ".cm-annotation-note": {
    display: "inline-block",
    marginLeft: "1px",
    verticalAlign: "super",
    lineHeight: "0",
    opacity: "0.45",
    cursor: "default",
  },
  ".cm-annotation-note-resolved": { opacity: "0.3" },
  ".cm-annotation-note:hover": { opacity: "0.8" },
});

export const annotationsExtension = [
  annotationsField,
  annotationsTheme,
  annotationUndo,
];
