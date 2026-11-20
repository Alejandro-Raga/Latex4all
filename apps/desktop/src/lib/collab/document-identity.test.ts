import { describe, expect, it } from "vitest";
import { identityOf, isDifferentDocument, overlap } from "./document-identity";

/** A paper: preamble, title and some paragraphs of its own. */
function paper(kind: string, title: string, subject: string, lines = 12) {
  const body = Array.from(
    { length: lines },
    (_, i) => `This paragraph ${i + 1} is about ${subject} and nothing else.`,
  );
  return [
    `\\documentclass[12pt]{${kind}}`,
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{graphicx}",
    `\\title{${title}}`,
    "\\begin{document}",
    "\\maketitle",
    ...body,
    "\\end{document}",
    "",
  ].join("\n");
}

const sdg = paper("article", "Corporate Science and the Social SDGs", "SDGs");
const firms = paper("article", "Firms, Articles \\& Invention", "invention");

describe("document identity", () => {
  it("is the class and the title, without LaTeX markup", () => {
    expect(identityOf(sdg)).toBe(
      "article|corporate science and the social sdgs",
    );
    expect(
      identityOf("\\documentclass{beamer}\n\\title[Short]{A \\textbf{Talk}}"),
    ).toBe("beamer|a talk");
    expect(identityOf("@article{key, title={x}}")).toBeNull();
  });

  it("tells another project's paper from an edit", () => {
    expect(isDifferentDocument(firms, sdg)).toBe(true);
    // Edits, however large, keep the title or the text.
    const edited = sdg.replace("paragraph 3", "paragraph three, rewritten");
    expect(isDifferentDocument(edited, sdg)).toBe(false);
    const rewritten = paper(
      "article",
      "Corporate Science and the Social SDGs",
      "new findings",
    );
    expect(isDifferentDocument(rewritten, sdg)).toBe(false);
    const retitled = sdg.replace(
      "Social SDGs",
      "Sustainable Development Goals",
    );
    expect(isDifferentDocument(retitled, sdg)).toBe(false);
    const reclassed = sdg.replace("{article}", "{report}");
    expect(isDifferentDocument(reclassed, sdg)).toBe(false);
  });

  it("takes the owner's version back over a damaged file", () => {
    // The file here holds another project's paper; the right one arrives,
    // vouched for by the identity the owner recorded.
    expect(isDifferentDocument(sdg, firms, identityOf(sdg))).toBe(false);
    // Another paper arriving is still refused, whatever was recorded.
    expect(isDifferentDocument(firms, sdg, identityOf(sdg))).toBe(true);
  });

  it("can't tell with too little text, and then lets it through", () => {
    const template =
      "\\documentclass{article}\n\\title{Untitled}\n\\begin{document}\n\\end{document}";
    expect(overlap(template, sdg)).toBe(1);
    expect(isDifferentDocument(template, sdg)).toBe(false);
  });

  it("only checks LaTeX documents", () => {
    expect(
      isDifferentDocument("@a{x}\n".repeat(20), "@b{y}\n".repeat(20)),
    ).toBe(false);
  });
});
