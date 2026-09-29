import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Editor colors read from the app theme's CSS variables (the --syn-* ones
 * for syntax, see globals.css and app-themes.ts), so the editor follows every
 * theme, including custom ones, without being rebuilt.
 */
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-command)" },
  { tag: t.className, color: "var(--syn-env)" },
  {
    tag: t.heading,
    color: "var(--syn-heading)",
    fontWeight: "600",
  },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.string, t.meta, t.monospace], color: "var(--syn-string)" },
  {
    tag: [t.processingInstruction, t.operator, t.variableName],
    color: "var(--syn-math)",
  },
  { tag: t.bracket, color: "var(--syn-bracket)" },
  { tag: [t.number, t.atom, t.bool], color: "var(--syn-number)" },
  { tag: [t.labelName, t.link, t.url], color: "var(--syn-env)" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "var(--destructive)" },
]);

const chrome = EditorView.theme({
  "&": { color: "var(--foreground)", backgroundColor: "var(--background)" },
  ".cm-content": { caretColor: "var(--primary)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor:
        "color-mix(in oklab, var(--primary) 26%, transparent) !important",
    },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "color-mix(in oklab, var(--muted-foreground) 75%, transparent)",
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
    outline: "1px solid color-mix(in oklab, var(--primary) 55%, transparent)",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--destructive) 25%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--syn-env) 18%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-panels": {
    backgroundColor: "var(--sidebar)",
    color: "var(--foreground)",
  },
  ".cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--input)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--border)",
  },
});

/** Colors for a CodeMirror editor, from whichever theme is showing. */
export function themedEditor(dark: boolean) {
  return [chrome, EditorView.darkTheme.of(dark), syntaxHighlighting(highlight)];
}

/** Just the syntax colors, for editors that style their own surroundings. */
export const themedHighlighting = syntaxHighlighting(highlight);
