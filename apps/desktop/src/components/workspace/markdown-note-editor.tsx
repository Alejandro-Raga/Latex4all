import { useEffect, useRef } from "react";
import {
  autocompletion,
  selectedCompletionIndex,
  setSelectedCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder, tooltips } from "@codemirror/view";
import { noteLinkCompletions } from "@/lib/vault/link-complete";
import { useVaultStore } from "@/stores/vault-store";
import { themedHighlighting } from "./editor/editor-theme";

/**
 * A plain Markdown editor for a vault note: wraps lines, saves with ⌘S,
 * gives up with Escape, and suggests notes to link after "[[".
 */
export function MarkdownNoteEditor({
  initial,
  onChange,
  onSave,
  onCancel,
  noteName,
}: {
  /** The note being edited, left out of link suggestions. */
  noteName?: string;
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
          themedHighlighting,
          EditorView.lineWrapping,
          placeholder("Write…"),
          // On the window, not inside the panel, which would clip it.
          tooltips({ parent: document.body }),
          autocompletion({
            override: [
              noteLinkCompletions(
                () => useVaultStore.getState().index,
                () => noteName,
              ),
            ],
            icons: false,
            maxRenderedOptions: 40,
          }),
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
            ".cm-tooltip.cm-tooltip-autocomplete": {
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "3px",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul": {
              fontFamily: "var(--font-sans, ui-sans-serif, system-ui)",
              fontSize: "13px",
              maxHeight: "16rem",
              minWidth: "14rem",
              maxWidth: "min(26rem, 90vw)",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
              padding: "4px 8px",
              borderRadius: "5px",
              lineHeight: "1.4",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            },
            ".cm-completionDetail": {
              marginLeft: "0.75em",
              fontStyle: "normal",
              color: "var(--muted-foreground)",
              fontSize: "11px",
            },
            ".cm-tooltip.cm-completionInfo": {
              backgroundColor: "var(--popover)",
              color: "var(--muted-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "6px 8px",
              maxWidth: "18rem",
              fontSize: "12px",
            },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor:
                "color-mix(in oklab, var(--primary) 25%, transparent)",
            },
          }),
        ],
      }),
    });
    view.focus();
    // The pointer picks a suggestion too (CodeMirror only follows the keys),
    // so its full name shows beside whichever one it's on.
    // Only a pointer that moved: the list appearing under a resting one
    // mustn't change which suggestion Enter takes.
    let last = { x: Number.NaN, y: Number.NaN };
    const hover = (e: MouseEvent) => {
      const moved = e.clientX !== last.x || e.clientY !== last.y;
      last = { x: e.clientX, y: e.clientY };
      if (!moved) return;
      const li = (e.target as Element | null)?.closest?.(
        ".cm-tooltip-autocomplete li[id]",
      );
      if (!li) return;
      const i = Number(li.id.split("-").pop());
      if (Number.isInteger(i) && selectedCompletionIndex(view.state) !== i) {
        view.dispatch({ effects: setSelectedCompletion(i) });
      }
    };
    document.addEventListener("mousemove", hover);
    return () => {
      document.removeEventListener("mousemove", hover);
      view.destroy();
    };
  }, [initial]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" />;
}
