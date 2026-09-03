import {
  type CompletionResult,
  type CompletionSource,
  snippet,
} from "@codemirror/autocomplete";

/**
 * Commands that conventionally take a mandatory `{...}` argument right
 * after the command name — as opposed to bare macros like `\alpha` or
 * `\quad` that are used standalone. Completing one of these now inserts
 * the matching braces with the cursor placed between them, same as
 * VS Code's LaTeX extensions.
 */
const BRACE_COMMANDS = new Set([
  "\\cite",
  "\\citep",
  "\\citet",
  "\\citeauthor",
  "\\citeyear",
  "\\nocite",
  "\\bibitem",
  "\\ref",
  "\\eqref",
  "\\pageref",
  "\\autoref",
  "\\nameref",
  "\\label",
  "\\textbf",
  "\\textit",
  "\\texttt",
  "\\textsf",
  "\\textrm",
  "\\textsc",
  "\\emph",
  "\\underline",
  "\\textcolor",
  "\\colorbox",
  "\\caption",
  "\\includegraphics",
  "\\part",
  "\\chapter",
  "\\section",
  "\\subsection",
  "\\subsubsection",
  "\\paragraph",
  "\\subparagraph",
  "\\title",
  "\\author",
  "\\date",
  "\\bibliography",
  "\\bibliographystyle",
  "\\usepackage",
  "\\documentclass",
  "\\input",
  "\\include",
  "\\newcommand",
  "\\renewcommand",
  "\\newenvironment",
  "\\renewenvironment",
  "\\footnote",
  "\\url",
  "\\href",
  "\\hspace",
  "\\vspace",
  "\\multicolumn",
  "\\multirow",
]);

function withBraces(result: CompletionResult): CompletionResult {
  return {
    ...result,
    options: result.options.map((option) => {
      // Only patch the plain "just insert the command name" completions —
      // leave environment/snippet entries (which already have their own
      // smart `apply`, e.g. `\begin{...}`) untouched.
      if (BRACE_COMMANDS.has(option.label) && option.apply === option.label) {
        return { ...option, apply: snippet(`${option.label}{\${}}`) };
      }
      return option;
    }),
  };
}

/** Wraps a LaTeX completion source so brace-taking commands auto-insert `{}`. */
export function withAutoBraces(source: CompletionSource): CompletionSource {
  return (context) => {
    const result = source(context);
    if (!result) return result;
    if (result instanceof Promise) {
      return result.then((r) => (r ? withBraces(r) : r));
    }
    return withBraces(result);
  };
}
