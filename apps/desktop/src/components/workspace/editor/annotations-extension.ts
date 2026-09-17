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
import type { Annotation } from "@/lib/annotations/types";

/**
 * Highlights and notes, drawn quietly: a soft background for a highlight, and
 * for one with a note a small faint glyph where it ends. Nothing goes in the
 * margin, so text never shifts. A resolved thread draws nothing until hovered.
 */

/** Replaces the file's annotations (e.g. after someone else changed one). */
export const setAnnotations = StateEffect.define<readonly Annotation[]>();

interface AnnotationsValue {
  annotations: readonly Annotation[];
  decorations: DecorationSet;
}

class NoteGlyph extends WidgetType {
  constructor(readonly id: string) {
    super();
  }

  eq(other: NoteGlyph) {
    return other.id === this.id;
  }

  toDOM() {
    const glyph = document.createElement("span");
    glyph.className = "cm-annotation-note";
    glyph.dataset.annotationId = this.id;
    glyph.setAttribute("aria-label", "Note");
    // lucide "message-square", reduced.
    glyph.innerHTML =
      '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    return glyph;
  }

  ignoreEvent() {
    return false;
  }
}

function build(annotations: readonly Annotation[], length: number) {
  const ranges: Range<Decoration>[] = [];
  for (const a of annotations) {
    const from = Math.max(0, Math.min(a.from, length));
    const to = Math.max(0, Math.min(a.to, length));
    if (from >= to || a.resolved) continue;
    ranges.push(
      Decoration.mark({
        class: `cm-annotation cm-annotation-${a.color}`,
        attributes: { "data-annotation-id": a.id },
      }).range(from, to),
    );
    if (a.comments.length > 0) {
      ranges.push(
        Decoration.widget({ widget: new NoteGlyph(a.id), side: 1 }).range(to),
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
    // the same edges: typing just outside a highlight doesn't join it.
    return {
      annotations: value.annotations.map((a) => ({
        ...a,
        from: tr.changes.mapPos(a.from, 1),
        to: tr.changes.mapPos(a.to, -1),
      })),
      decorations: value.decorations.map(tr.changes),
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
  ".cm-annotation": { borderRadius: "2px" },
  ".cm-annotation-note": {
    display: "inline-block",
    marginLeft: "1px",
    verticalAlign: "super",
    lineHeight: "0",
    opacity: "0.45",
    cursor: "default",
  },
  ".cm-annotation-note:hover": { opacity: "0.8" },
});

export const annotationsExtension = [annotationsField, annotationsTheme];
