/**
 * Shared LaTeX-awareness for text-analysis features (spellcheck, grammar
 * check): flags which character positions in a LaTeX document are actual
 * prose versus math, verbatim/code blocks, control sequence names, and the
 * technical arguments of commands like \cite{}, \ref{}, \includegraphics{},
 * \label{} (formatting commands like \textbf{} or \section{} are left
 * alone — their argument text is real prose).
 */

// Commands whose {...}/[...] arguments are technical identifiers (citation
// keys, labels, acronym/glossary keys, ...) rather than prose — as opposed
// to e.g. \textbf{}/\section{}/\caption{}, whose argument IS prose and stays
// checked. Deliberately broad: covers natbib, biblatex, cleveref, varioref,
// glossaries, acronym/acro, and hyperref, since a missed entry here means a
// citation key or label leaks into the grammar checker as if it were a word.
const NON_PROSE_COMMANDS = new Set([
  // Citations — natbib
  "cite",
  "citep",
  "citet",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "citealt",
  "citealp",
  "citenum",
  "citetext",
  "nocite",
  "bibitem",
  // Citations — biblatex
  "parencite",
  "Parencite",
  "textcite",
  "Textcite",
  "footcite",
  "footcitetext",
  "autocite",
  "Autocite",
  "autocites",
  "Autocites",
  "smartcite",
  "Smartcite",
  "citepalias",
  "citetalias",
  "fullcite",
  "footfullcite",
  "citetitle",
  "citetitles",
  "citedate",
  "citeurl",
  // References/labels — standard, cleveref, varioref
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "nameref",
  "cref",
  "Cref",
  "crefrange",
  "Crefrange",
  "cpageref",
  "Cpageref",
  "vref",
  "Vref",
  "vpageref",
  "Vpageref",
  "fref",
  "Fref",
  "footref",
  "label",
  // Hyperlinks
  "hyperref",
  "hyperlink",
  "hypertarget",
  "subref",
  // Glossaries
  "gls",
  "Gls",
  "GLS",
  "glspl",
  "Glspl",
  "GLSpl",
  "glsentrytext",
  "glsentryname",
  "glsdesc",
  "glsdisp",
  "glslink",
  // Acronyms (acro / acronym packages)
  "ac",
  "Ac",
  "acs",
  "Acs",
  "acl",
  "Acl",
  "acp",
  "Acp",
  "acsp",
  "aclp",
  "acused",
  "acsu",
  "aclu",
  "iac",
  "Iac",
  "acrshort",
  "acrlong",
  "acrfull",
  // Graphics / includes / package & class setup
  "includegraphics",
  "input",
  "include",
  "includeonly",
  "usepackage",
  "documentclass",
  "bibliography",
  "bibliographystyle",
  "addbibresource",
  "url",
  "pagestyle",
  "newcommand",
  "renewcommand",
  "providecommand",
  "setlength",
  "addtolength",
  "hypersetup",
  "geometry",
  "definecolor",
  "newenvironment",
  "renewenvironment",
  "begin",
  "end",
  "newcolumntype",
  "graphicspath",
  "usetikzlibrary",
  "setcounter",
]);

const VERBATIM_ENVS =
  /\\begin\{(verbatim\*?|lstlisting|minted\*?|Verbatim\*?|listing\*?)\}[\s\S]*?\\end\{\1\}/g;
const MATH_RE =
  /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;
// Named commands (\section, \cite*) OR a single escaped special character
// (\&, \%, \$, \#, \_, \{, \}, \^, \~, \\) — the latter has no name group,
// so it's never looked up in NON_PROSE_COMMANDS or treated as argument-taking.
const COMMAND_RE = /\\([a-zA-Z]+)\*?|\\[&%$#_{}^~\\]/g;

function markExcluded(mask: Uint8Array, from: number, to: number): void {
  const end = Math.min(to, mask.length);
  for (let i = from; i < end; i++) mask[i] = 1;
}

/** End index (exclusive) of a single balanced `{...}` or non-nested `[...]` group. */
function consumeGroup(text: string, open: number): number | null {
  const opener = text[open];
  if (opener !== "{" && opener !== "[") return null;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null; // unterminated — leave it be rather than eating the rest of the doc
}

/** `mask[i] === 1` means position `i` is NOT prose (math, command, technical arg, ...). */
export function buildExclusionMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);

  for (const m of text.matchAll(VERBATIM_ENVS)) {
    markExcluded(mask, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(MATH_RE)) {
    markExcluded(mask, m.index, m.index + m[0].length);
  }

  COMMAND_RE.lastIndex = 0;
  let cmdMatch: RegExpExecArray | null;
  while ((cmdMatch = COMMAND_RE.exec(text))) {
    const [full, name] = cmdMatch;
    const start = cmdMatch.index;
    const end = start + full.length;
    markExcluded(mask, start, end);

    if (NON_PROSE_COMMANDS.has(name)) {
      let pos = end;
      while (pos < text.length && (text[pos] === "{" || text[pos] === "[")) {
        const groupEnd = consumeGroup(text, pos);
        if (groupEnd === null) break;
        markExcluded(mask, pos, groupEnd);
        pos = groupEnd;
      }
    }
  }

  return mask;
}
