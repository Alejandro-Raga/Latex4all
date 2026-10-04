import { describe, expect, it } from "vitest";
import { papersFolderOf } from "./add-paper";
import { BEGIN, END, type PaperData, paperNoteText } from "./paper-note";
import { parseNote } from "./parse";
import { buildVaultIndex } from "./vault-index";

const paper: PaperData = {
  key: "WDK43QUS",
  fields: {
    itemType: "journalArticle",
    title: "The decline of science in corporate R&D",
    creators: [
      { creatorType: "author", firstName: "Ashish", lastName: "Arora" },
      { creatorType: "author", firstName: "Sharon", lastName: "Belenzon" },
      { creatorType: "reviewedAuthor", firstName: "Not", lastName: "Me" },
    ],
    date: "2018-05",
    publicationTitle: "Strategic Management Journal",
    DOI: "10.1002/smj.2693",
    abstractNote: "Research summary: a shift away from science.",
    tags: [{ tag: "Topic: Corporate Science" }, { tag: "obsidian" }],
  },
  pdfKey: "GPXJ69P7",
  annotations: [
    {
      key: "VI9CU433",
      type: "highlight",
      text: "we document a shift away from science",
      color: "#ffd400",
      pageLabel: "3",
      pageIndex: 0,
      comment: "Key claim, see [[Nelson1959]]",
    },
  ],
};

describe("literature notes written by Latex4All", () => {
  it("come out as the Zotero sync writes them", () => {
    const text = paperNoteText(paper, "arora_decline_2018", null) as string;
    expect(text).toContain(
      [
        "---",
        "title: The decline of science in corporate R&D",
        "authors:",
        "- Ashish Arora",
        "- Sharon Belenzon",
        "year: 2018",
        "publication: Strategic Management Journal",
        "doi: 10.1002/smj.2693",
        "item_type: journalArticle",
        "citekey: arora_decline_2018",
        "zotero_key: WDK43QUS",
        "zotero_tags:",
        '- "Topic: Corporate Science"',
        "- obsidian",
        "aliases:",
        "- The decline of science in corporate R&D",
        "tags:",
        "- paper",
        "status: to-process",
        "---",
        BEGIN,
        "# The decline of science in corporate R&D",
        "",
        "Ashish Arora, Sharon Belenzon · 2018 · *Strategic Management Journal*",
        "",
        "[Zotero](zotero://select/library/items/WDK43QUS) · [Open PDF](zotero://open-pdf/library/items/GPXJ69P7) · [DOI](https://doi.org/10.1002/smj.2693)",
        "",
        "Topics: [[Corporate Science]]",
      ].join("\n"),
    );
    expect(text).toContain(
      "> we document a shift away from science\n> — [p. 3](zotero://open-pdf/library/items/GPXJ69P7?page=1&annotation=VI9CU433) #hl/yellow\n\n^vi9cu433\n\nKey claim, see [[Nelson1959]]",
    );
    expect(text.endsWith(`${END}\n\n## My notes\n\n`)).toBe(true);
    // Obsidian reads it as a paper with its key.
    expect(
      buildVaultIndex([parseNote("Papers/x.md", text)]).list[0],
    ).toMatchObject({
      kind: "paper",
      citekey: "arora_decline_2018",
      zoteroKey: "WDK43QUS",
    });
  });

  it("refresh their Zotero part and keep everything the user added", () => {
    const first = paperNoteText(paper, "arora_decline_2018", null) as string;
    const edited = first
      .replace("status: to-process", "status: read\nrating: 5")
      .replace("## My notes\n\n", "## My notes\n\nMy own thoughts.\n");
    const later = paperNoteText(
      { ...paper, fields: { ...paper.fields, title: "Renamed in Zotero" } },
      "arora_decline_2018",
      edited,
    ) as string;
    expect(later).toContain("title: Renamed in Zotero");
    expect(later).toContain("# Renamed in Zotero");
    expect(later).toContain("status: read\nrating: 5");
    expect(later).toContain("My own thoughts.");
    expect(later.match(/^title:/gm)).toHaveLength(1);
  });

  it("leave another plugin's note alone", () => {
    expect(
      paperNoteText(paper, "k", "---\nTitle: Theirs\n---\n# Notes"),
    ).toBeNull();
  });

  it("go where the vault keeps its paper notes", () => {
    const index = buildVaultIndex([
      parseNote("Lecturas/Zotero/a.md", "---\ncitekey: a\n---\n"),
      parseNote("Lecturas/Zotero/b.md", "---\ncitekey: b\n---\n"),
      parseNote("Inbox/c.md", "---\ncitekey: c\n---\n"),
      parseNote("Ideas/d.md", "just an idea"),
    ]);
    expect(papersFolderOf(index, "")).toBe("Lecturas/Zotero");
    expect(papersFolderOf(index, "Mine")).toBe("Mine");
    expect(papersFolderOf(buildVaultIndex([]), "")).toBe("Papers");
  });
});

describe("highlight text", () => {
  it("loses what the PDF layout added", async () => {
    const { cleanHighlight } = await import("./paper-note");
    expect(
      cleanHighlight(
        "pub\u00ad lishing incen- tives ﬁrms R&D- intensive pre- and",
      ),
    ).toBe("publishing incentives firms R&D-intensive pre- and");
  });
});
