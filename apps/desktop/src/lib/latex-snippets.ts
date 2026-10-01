/**
 * What the editor's ribbon inserts, worked out from the document so the
 * right command is used without having to know which one that is.
 */

export type CiteStyle = "biblatex" | "natbib" | "plain";

/** Comments blanked out, keeping every other character where it was. */
const uncommented = (tex: string) =>
  tex.replace(
    /(^|[^\\])(%[^\n]*)/gm,
    (_, pre: string, c: string) => pre + " ".repeat(c.length),
  );

/** Whether a package is loaded (`\usepackage[...]{a,b}` counts for each). */
export function hasPackage(tex: string, name: string): boolean {
  for (const m of uncommented(tex).matchAll(
    /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
  )) {
    if (m[1].split(",").some((p) => p.trim() === name)) return true;
  }
  return false;
}

/** How the document cites: biblatex, natbib, or plain LaTeX. */
export function citeStyle(tex: string): CiteStyle {
  if (hasPackage(tex, "biblatex")) return "biblatex";
  if (hasPackage(tex, "natbib")) return "natbib";
  return "plain";
}

/**
 * The command for a citation in the sentence ("Nelson (1959) argues") or
 * in parentheses ("… (Nelson, 1959)"), and the package it needs, if any.
 */
export function citeCommand(
  kind: "text" | "paren",
  style: CiteStyle,
): { command: string; needs?: string } {
  if (style === "biblatex") {
    return { command: kind === "text" ? "\\textcite" : "\\parencite" };
  }
  // Plain LaTeX can't cite in the sentence; natbib can, with any style.
  return {
    command: kind === "text" ? "\\citet" : "\\citep",
    ...(style === "plain" ? { needs: "natbib" } : {}),
  };
}

/**
 * Where `\usepackage{name}` goes: after the last \usepackage, else after
 * \documentclass. Null when it's there already or there's no preamble.
 */
export function packageInsertion(
  tex: string,
  name: string,
): { at: number; text: string } | null {
  if (hasPackage(tex, name)) return null;
  const begin = uncommented(tex).search(/\\begin\s*\{document\}/);
  if (begin === -1) return null;
  const preamble = uncommented(tex.slice(0, begin));
  const last = [
    ...preamble.matchAll(/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\}[^\n]*/g),
  ].pop();
  const doc = preamble.match(
    /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]*\}[^\n]*/,
  );
  const after = last ?? doc;
  if (!after) return null;
  return {
    at: (after.index ?? 0) + after[0].length,
    text: `\n\\usepackage{${name}}`,
  };
}

/** A list from the selected lines, one item each; an empty one otherwise. */
export function listFrom(
  selected: string,
  env: "itemize" | "enumerate",
): { before: string; body: string; after: string } {
  const lines = selected
    .split("\n")
    .map((l) => l.trim().replace(/^([-*•]|\d+[.)])\s+/, ""))
    .filter(Boolean);
  const body = lines.length
    ? lines.map((l) => `  \\item ${l}`).join("\n")
    : "  \\item ";
  return { before: `\\begin{${env}}\n`, body, after: `\n\\end{${env}}` };
}

/** A table with a header row and `rows` empty rows. */
export function tableSnippet(cols: number, rows: number): string {
  const row = (cell: (i: number) => string) =>
    `    ${Array.from({ length: cols }, (_, i) => cell(i)).join(" & ")} \\\\`;
  return [
    "\\begin{table}[htbp]",
    "  \\centering",
    "  \\caption{}",
    "  \\label{tab:}",
    `  \\begin{tabular}{${"l".repeat(cols)}}`,
    "    \\hline",
    row((i) => `Header ${i + 1}`),
    "    \\hline",
    ...Array.from({ length: rows }, () => row(() => " ")),
    "    \\hline",
    "  \\end{tabular}",
    "\\end{table}",
  ].join("\n");
}
