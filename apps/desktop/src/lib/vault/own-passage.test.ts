import { describe, expect, it } from "vitest";
import { newGroupNote, withPassageFrom } from "./add-passage";
import { latexAsProse, ownPassageMarkdown } from "./own-passage";

describe("a passage of your own writing", () => {
  it("reads as prose, not LaTeX", () => {
    expect(
      latexAsProse(
        "Firms do \\emph{basic} research~\\citep[p.~2]{Rosenberg1990}---for\n% a comment\nprofit\\label{x}.",
      ),
    ).toBe("Firms do basic research (Rosenberg1990)—for profit.");
  });

  it("links back to its file and line, and is filed once", () => {
    const p = {
      projectRoot: "/Users/me/Thesis (draft)",
      file: "chapters/intro.tex",
      line: 42,
      text: "Science is getting harder.",
    };
    const md = ownPassageMarkdown(p);
    expect(md).toContain("> Science is getting harder.");
    expect(md).toContain("[chapters/intro.tex, line 42](latex4all://open?");
    expect(md).not.toMatch(/\]\([^)]*[ ()][^)]*\)$/);
    const source = {
      heading: "Thesis (draft)",
      headingKey: "### Thesis (draft)",
      literature: null,
    };
    const marker = md.match(/passage=\w+/)?.[0] ?? "";
    const once = withPassageFrom(
      newGroupNote("idea", "Harder", "2026-10-06"),
      source,
      marker,
      md,
    );
    expect(once).toContain("### Thesis (draft)");
    expect(once).not.toContain("## Literature\n\n- ");
    expect(withPassageFrom(once, source, marker, md)).toBe(once);
  });
});
