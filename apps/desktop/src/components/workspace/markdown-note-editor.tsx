import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";

/**
 * A plain Markdown editor for a vault note: wraps lines, saves with ⌘S and
 * gives up with Escape.
 */
export function MarkdownNoteEditor({
  initial,
  onChange,
  onSave,
  onCancel,
}: {
  initial: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Handlers change every render; the editor is built once.
  const handlers = useRef({ onChange, onSave, onCancel });
  handlers.current = { onChange, onSave, onCancel };

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          placeholder("Write…"),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                handlers.current.onCancel();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": {
              fontSize: "13px",
              color: "var(--foreground)",
              backgroundColor: "transparent",
            },
            "&.cm-focused": { outline: "none" },
            ".cm-content": {
              fontFamily: "var(--font-sans, inherit)",
              padding: "8px 0",
              caretColor: "var(--foreground)",
            },
            ".cm-line": { padding: "0 12px", lineHeight: "1.6" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor:
                "color-mix(in oklab, var(--primary) 25%, transparent)",
            },
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
  }, [initial]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" />;
}
