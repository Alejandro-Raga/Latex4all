import { describe, expect, it } from "vitest";
import type { Annotation } from "@/lib/annotations/types";
import { parseNote } from "./parse";
import {
  citeLocations,
  BEGIN,
  citedKeys,
  END,
  mergeProjectNote,
  outline,
  projectNoteBody,
  projectNotePath,
} from "./project-note";
import { buildVaultIndex } from "./vault-index";

const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
Firms underinvest in basic research \cite{nelson_simple_1959, arrow1962}.
% \cite{commented_out}
\subsection{Why it \emph{matters}}
See \citep[p.~3]{nelson_simple_1959} and \textcite{unknown2020}.
\section*{Data and Methods}
\end{document}
`;

const index = buildVaultIndex([
  parseNote(
    "Papers/Nelson1959.md",
    "---\ncitekey: Nelson1959\nzotero_key: 4AJVQCAA\nauthors:\n- Richard R. Nelson\nyear: 1959\n---\n",
  ),
  parseNote("Papers/Arrow1962.md", "---\ncitekey: Arrow1962\n---\n"),
]);

const note = (from: number, to: number, extra: Partial<Annotation> = {}) => ({
  path: "main.tex",
  annotation: {
    id: String(from),
    from,
    to,
    color: "yellow",
    resolved: false,
    comments: [],
    ...extra,
  } as Annotation,
});

const firms = MAIN.indexOf("Firms underinvest");
const input = {
  name: "Science Policy Paper",
  root: "/Users/me/Latex4All/Science Policy Paper",
  type: "article",
  texFiles: [{ path: "main.tex", content: MAIN }],
  annotations: [
    note(firms, firms + "Firms underinvest in basic research".length, {
      comments: [
        {
          id: "c",
          author: "Alejandro",
          authorColor: "",
          text: "Needs a stronger source.",
          at: Date.UTC(2026, 8, 27),
        },
      ],
    }),
    note(0, 5, { resolved: true }),
    note(10, 20, {
      suggestion: { text: "x", author: "", authorColor: "", at: 0 },
    }),
  ],
  index,
  itemKeyByCitekey: new Map([["nelson_simple_1959", "4AJVQCAA"]]),
  now: new Date(Date.UTC(2026, 8, 29)),
};

describe("project notes", () => {
  it("collects citation keys in order, once, ignoring comments", () => {
    expect(citedKeys([{ content: MAIN }])).toEqual([
      "nelson_simple_1959",
      "arrow1962",
      "unknown2020",
    ]);
  });

  it("outlines sections and subsections as plain text", () => {
    expect(outline([{ content: MAIN }])).toEqual([
      "- Introduction",
      "  - Why it matters",
      "- Data and Methods",
    ]);
  });

  it("links cited papers to their notes and lists the rest", () => {
    const body = projectNoteBody(input);
    expect(body).toContain("[[Nelson1959]] · [[Arrow1962]]");
    expect(body).toContain("Not in the vault: `unknown2020`");
  });

  it("quotes open highlights with their place and notes, not suggestions", () => {
    const body = projectNoteBody(input);
    expect(body).toContain(
      "> Firms underinvest in basic research\n> — [main.tex:4](latex4all://open?project=%2FUsers%2Fme%2FLatex4All%2FScience+Policy+Paper&file=main.tex&line=4) #hl/yellow",
    );
    expect(
      body.startsWith("[Open in Latex4All](latex4all://open?project="),
    ).toBe(true);
    expect(body).toContain(
      "**Alejandro** (2026-09-27): Needs a stronger source.",
    );
    expect(body).toContain("*1 resolved note not shown.*");
    expect(body.match(/^> /gm)?.length).toBe(2);
  });

  it("creates a note, then updates only its own part", () => {
    const created = mergeProjectNote(null, input);
    expect(created).toContain(
      "type: article\nproject: /Users/me/Latex4All/Science Policy Paper\nlatex4all_updated: 2026-09-29\ntags:\n- project",
    );
    expect(created).toContain(`${BEGIN}\n[Open in Latex4All](`);
    expect(created).toContain("## Cites");
    expect(created).toContain(`${END}\n\n## My notes`);

    const edited = (created as string)
      .replace("tags:\n- project", "tags:\n- project\nstatus: drafting")
      .replace("## My notes\n\n", "## My notes\n\nMy own thoughts.\n");
    const later = {
      ...input,
      type: "thesis",
      texFiles: [{ path: "main.tex", content: `${MAIN}\\cite{newkey}` }],
      now: new Date(Date.UTC(2026, 9, 1)),
    };
    const updated = mergeProjectNote(edited, later) as string;
    expect(updated).toContain("type: thesis");
    expect(updated).toContain("latex4all_updated: 2026-10-01");
    expect(updated).toContain("status: drafting");
    expect(updated).toContain("My own thoughts.");
    expect(updated).toContain("`newkey`");
    expect(updated.match(/^type:/gm)?.length).toBe(1);
  });

  it("leaves a note alone once its markers are taken out", () => {
    expect(
      mergeProjectNote("---\ntags: [project]\n---\nMine now.", input),
    ).toBeNull();
  });

  it("files notes under the chosen folder with a safe name", () => {
    expect(projectNotePath("My work", "Thesis: draft #2")).toBe(
      "My work/Thesis draft 2.md",
    );
    expect(projectNotePath("", "Paper")).toBe("Paper.md");
  });
});

describe("cite locations", () => {
  it("gives each key's files and lines, skipping comments", () => {
    const places = citeLocations([
      {
        path: "main.tex",
        content:
          "Intro \\cite{a}.\n% \\cite{b}\nMore \\citep[p.~2]{b, a} and \\cite{a}.",
      },
      { path: "ch/two.tex", content: "\n\\textcite{b}" },
    ]);
    expect(places.get("a")).toEqual([
      { file: "main.tex", line: 1 },
      { file: "main.tex", line: 3 },
    ]);
    expect(places.get("b")).toEqual([
      { file: "main.tex", line: 3 },
      { file: "ch/two.tex", line: 2 },
    ]);
  });
});
