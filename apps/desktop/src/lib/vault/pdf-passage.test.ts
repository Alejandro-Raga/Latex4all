import { describe, expect, it } from "vitest";
import { parseLatex4AllLink } from "@/lib/deep-link";
import { newGroupNote, withPassageFrom } from "./add-passage";
import { withoutPassage } from "./passage-edits";
import { pdfPassageMarkdown, pdfTitle } from "./pdf-passage";

const passage = {
  path: "/Users/me/Paper/drafts/Draft v3.pdf",
  key: "local-abc123",
  text: "Firms underinvest in research.",
  comment: "Check this claim",
  page: 4,
};

describe("a project PDF's highlight in a note", () => {
  it("quotes it with its page, a link back to the highlight, and its comment", () => {
    const md = pdfPassageMarkdown(passage);
    expect(md).toContain("> Firms underinvest in research.");
    expect(md).toContain("[Draft v3, p. 4](latex4all://open?");
    expect(md).toContain("\n\nCheck this claim");
    const url = md.match(/\((latex4all:[^)]+)\)/)?.[1] ?? "";
    expect(parseLatex4AllLink(url)).toEqual({
      project: "/Users/me/Paper/drafts",
      file: "Draft v3.pdf",
      page: 4,
      annotation: "local-abc123",
    });
    expect(pdfTitle(passage.path)).toBe("Draft v3");
  });

  it("goes under the PDF's name once, and leaves with the highlight", () => {
    const from = {
      heading: "Draft v3",
      headingKey: "### Draft v3",
      literature: null,
    };
    const marker = `annotation=${passage.key}`;
    const md = pdfPassageMarkdown(passage);
    const note = newGroupNote("idea", "Underinvestment", "2026-11-17");
    const once = withPassageFrom(note, from, marker, md);
    expect(once).toContain("### Draft v3");
    expect(withPassageFrom(once, from, marker, md)).toBe(once);
    const gone = withoutPassage(once, passage.key, passage.comment);
    expect(gone).not.toContain("Firms underinvest");
    expect(gone).not.toContain("Check this claim");
  });
});
