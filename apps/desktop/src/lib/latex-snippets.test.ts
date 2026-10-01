import { describe, expect, it } from "vitest";
import {
  citeCommand,
  citeStyle,
  hasPackage,
  listFrom,
  packageInsertion,
  tableSnippet,
} from "./latex-snippets";

const DOC = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{graphicx, amsmath}
% \usepackage{hyperref}
\begin{document}
Hi.
\end{document}`;

describe("latex snippets", () => {
  it("finds packages, also in lists, but not commented out", () => {
    expect(hasPackage(DOC, "amsmath")).toBe(true);
    expect(hasPackage(DOC, "graphicx")).toBe(true);
    expect(hasPackage(DOC, "hyperref")).toBe(false);
  });

  it("picks citation commands for the document's package", () => {
    expect(citeStyle(String.raw`\usepackage[style=apa]{biblatex}`)).toBe(
      "biblatex",
    );
    expect(citeCommand("text", "biblatex").command).toBe("\\textcite");
    expect(citeCommand("paren", "natbib")).toEqual({ command: "\\citep" });
    expect(citeCommand("text", "plain")).toEqual({
      command: "\\citet",
      needs: "natbib",
    });
  });

  it("adds a package after the last one, once", () => {
    const add = packageInsertion(DOC, "hyperref");
    expect(add).not.toBeNull();
    const out = DOC.slice(0, add?.at) + add?.text + DOC.slice(add?.at);
    expect(out).toContain(
      "\\usepackage{graphicx, amsmath}\n\\usepackage{hyperref}\n",
    );
    expect(packageInsertion(out, "hyperref")).toBeNull();
    expect(packageInsertion("No preamble here", "hyperref")).toBeNull();
  });

  it("turns selected lines into items, dropping bullets and numbers", () => {
    expect(listFrom("- one\n\n2. two\nthree", "itemize").body).toBe(
      "  \\item one\n  \\item two\n  \\item three",
    );
    expect(listFrom("", "enumerate")).toEqual({
      before: "\\begin{enumerate}\n",
      body: "  \\item ",
      after: "\n\\end{enumerate}",
    });
  });

  it("makes a table with a header row", () => {
    const t = tableSnippet(2, 1);
    expect(t).toContain("\\begin{tabular}{ll}");
    expect(t).toContain("Header 1 & Header 2 \\\\");
  });
});
