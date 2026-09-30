import zoteroIntegrationNote from "./fixtures/zotero-integration-note.md?raw";
import { noteForCitekey } from "./cite-link";
import { describe, expect, it } from "vitest";
import { citeKeyAtCursor } from "./cite-at-cursor";
import { parseFrontmatter, parseNote } from "./parse";
import { buildVaultIndex, neighbourhood, searchNotes } from "./vault-index";

const PAPER = `---
title: 'The Simple Economics of Basic Scientific Research'
authors:
- Richard R. Nelson
year: 1959
citekey: Nelson1959
zotero_key: 4AJVQCAA
aliases:
- The Simple Economics of Basic Scientific Research
tags:
- paper
status: to-process
---
%% begin zotero %%
# The Simple Economics of Basic Scientific Research

> Basic research is a public good
> — [p. 3](zotero://open-pdf/library/items/X?page=3) #hl/yellow ^ab12

reminds me of [[Arrow1962]] and \`[[NotALink]]\`

💡 [[Firms underinvest]]
![[ink-ab12.svg]]
%% end zotero %%

## My notes
See [[Missing2000]] and [[arrow1962#^cd34|Arrow]].
`;

const IDEA = `---
tags:
- idea
created: '2026-09-28'
source: '[[Nelson1959]]'
zotero_annotation: 3TV86QGK
---
Firms underinvest in basic research.

## Evidence
- [[Nelson1959#^ab12]] (p. 3)
`;

describe("parseFrontmatter", () => {
  it("reads scalars, quoted strings and both list forms", () => {
    expect(
      parseFrontmatter(
        "a: 1\nb: 'it''s'\nc: [x, \"y\"]\nd:\n- one\n- two\ne: true\nf:",
      ),
    ).toEqual({
      a: 1,
      b: "it's",
      c: ["x", "y"],
      d: ["one", "two"],
      e: true,
      f: null,
    });
  });
});

describe("parseNote", () => {
  it("finds links outside code and comments, and embeds separately", () => {
    const note = parseNote("Papers/Nelson1959.md", PAPER);
    expect(note.name).toBe("Nelson1959");
    expect(note.folder).toBe("Papers");
    expect(note.frontmatter.zotero_key).toBe("4AJVQCAA");
    expect(note.links.map((l) => l.target)).toEqual([
      "Arrow1962",
      "Firms underinvest",
      "Missing2000",
      "arrow1962",
    ]);
    expect(note.links[3].anchor).toBe("^cd34");
    expect(note.embeds).toEqual(["ink-ab12.svg"]);
    expect(note.body.startsWith("%% begin zotero %%")).toBe(true);
  });

  it("counts the source field of an idea as a link", () => {
    const note = parseNote("Ideas/Firms underinvest.md", IDEA);
    expect(note.links.map((l) => l.target)).toEqual([
      "Nelson1959",
      "Nelson1959",
    ]);
  });
});

describe("buildVaultIndex", () => {
  const index = buildVaultIndex([
    parseNote("Papers/Nelson1959.md", PAPER),
    parseNote("Papers/Arrow1962.md", "---\ntags: [paper]\n---\nText"),
    parseNote("Ideas/Firms underinvest.md", IDEA),
    parseNote("Inbox.md", "quick thought about [[nelson1959]]"),
  ]);

  it("resolves links by name, case-insensitively, both ways", () => {
    const nelson = index.notes.get("nelson1959");
    expect(nelson?.kind).toBe("paper");
    expect(nelson?.title).toBe(
      "The Simple Economics of Basic Scientific Research",
    );
    expect(nelson?.outgoing.sort()).toEqual(["Arrow1962", "Firms underinvest"]);
    expect(nelson?.incoming.sort()).toEqual(["Firms underinvest", "Inbox"]);
    expect(nelson?.unresolved).toEqual(["Missing2000"]);
    expect(index.notes.get("arrow1962")?.incoming).toEqual(["Nelson1959"]);
  });

  it("orders papers, then ideas, then the rest", () => {
    expect(index.list.map((n) => n.name)).toEqual([
      "Arrow1962",
      "Nelson1959",
      "Firms underinvest",
      "Inbox",
    ]);
  });

  it("gives a note's neighbourhood with the links among it", () => {
    const { nodes, edges } = neighbourhood(index, "Firms underinvest");
    expect(nodes.map((n) => n.note.name).sort()).toEqual([
      "Firms underinvest",
      "Nelson1959",
    ]);
    const wider = neighbourhood(index, "Firms underinvest", 2).nodes;
    expect(Object.fromEntries(wider.map((n) => [n.note.name, n.ring]))).toEqual(
      {
        "Firms underinvest": 0,
        Nelson1959: 1,
        Arrow1962: 2,
        Inbox: 2,
      },
    );
    expect(edges).toContainEqual({
      from: "Nelson1959",
      to: "Firms underinvest",
    });
    expect(edges).toContainEqual({
      from: "Firms underinvest",
      to: "Nelson1959",
    });
  });

  it("searches names and titles before text", () => {
    expect(searchNotes(index, "simple economics")[0].name).toBe("Nelson1959");
    expect(searchNotes(index, "underinvest").map((n) => n.name)).toEqual([
      "Firms underinvest",
      "Nelson1959",
    ]);
    expect(searchNotes(index, "nothing like this")).toEqual([]);
  });
});

describe("citeKeyAtCursor", () => {
  const text =
    "As shown \\citep[p.~3]{nelson_simple_1959, arrow_economic_1962}.";
  const at = (s: string) => text.indexOf(s);

  it("picks the key the cursor is on", () => {
    expect(citeKeyAtCursor(text, at("nelson") + 2)).toBe("nelson_simple_1959");
    expect(citeKeyAtCursor(text, at("arrow") + 3)).toBe("arrow_economic_1962");
  });

  it("uses the first key when the cursor is on the command", () => {
    expect(citeKeyAtCursor(text, at("citep") + 1)).toBe("nelson_simple_1959");
  });

  it("finds nothing outside a citation", () => {
    expect(citeKeyAtCursor(text, 2)).toBeNull();
    expect(citeKeyAtCursor("\\section{Intro}", 10)).toBeNull();
  });
});

describe("vaultMarkdown", () => {
  it("turns Obsidian syntax into plain Markdown", async () => {
    const { vaultMarkdown, noteFromHref } = await import("./render");
    const out = vaultMarkdown(
      "%% begin zotero %%\n> quote\n> — [p. 3](zotero://x) #hl/yellow ^ab12\n\nsee [[Arrow1962#^cd|Arrow]] and [[Idea one]]\n![[ink-ab12.svg]]\n%% end zotero %%",
    );
    expect(out).toBe(
      "> quote\n> — [p. 3](zotero://x)\n\nsee [Arrow](vault:Arrow1962) and [Idea one](vault:Idea%20one)\n![ink-ab12.svg](vault-embed:ink-ab12.svg)",
    );
    expect(noteFromHref("vault:Idea%20one")).toBe("Idea one");
    expect(noteFromHref("https://x")).toBeNull();
  });
});

describe("fillTemplate", () => {
  it("fills Obsidian's title, date and time placeholders", async () => {
    const { fillTemplate } = await import("./template");
    const now = new Date(2026, 8, 29, 9, 5, 7);
    expect(
      fillTemplate(
        "# {{title}}\ncreated: {{date}} {{time}}\n{{date:DD/MM/YYYY}} {{ Title }}",
        "Idea one",
        now,
      ),
    ).toBe("# Idea one\ncreated: 2026-09-29 09:05\n29/09/2026 Idea one");
  });
});

describe("paper detection across Zotero setups", () => {
  it("recognises citekey fields, @citekey names and zotero:// links", () => {
    const index = buildVaultIndex([
      parseNote("Lit/@smith2020.md", "---\ntitle: A study\n---\nbody"),
      parseNote(
        "Refs/Jones.md",
        "---\ncitationKey: jones2019\nauthor: Ann Jones\ndate: 2019-04-01\n---\n",
      ),
      parseNote(
        "Refs/Lee.md",
        "[Open](zotero://select/library/items/ABCD1234)",
      ),
      parseNote("Ideas/Thought.md", "just a note"),
    ]);
    const get = (n: string) => index.notes.get(n.toLowerCase());
    expect(get("@smith2020")).toMatchObject({
      kind: "paper",
      citekey: "smith2020",
      title: "A study",
    });
    expect(get("Jones")).toMatchObject({
      kind: "paper",
      citekey: "jones2019",
      authors: ["Ann Jones"],
      year: "2019",
    });
    expect(get("Lee")).toMatchObject({ kind: "paper", zoteroKey: "ABCD1234" });
    expect(get("Thought")).toMatchObject({ kind: "idea", group: "Ideas" });
    expect(index.list.map((n) => n.group)).toEqual([
      "Papers",
      "Papers",
      "Papers",
      "Ideas",
    ]);
  });
});

describe("Zotero Integration notes and their citation keys", () => {
  // Notes as Zotero Integration templates commonly write them.
  const index = buildVaultIndex([
    parseNote(
      "Literature/Cohen and Levinthal - Absorptive capacity.md",
      [
        "---",
        "category: literaturenote",
        "---",
        "> [!info]- Info",
        "> **Citekey**:: cohenAbsorptiveCapacityNew1990",
        "> **Year**:: 1990",
        "",
        "[Zotero](zotero://select/items/1_QWER1234)",
      ].join("\n"),
    ),
    parseNote(
      "Literature/Zahra.md",
      "---\ntags: [literature/paper]\n---\n[Open](zotero://select/items/@zahra2002)",
    ),
    parseNote("Literature/Todorova.md", '---\ncitekey: "@todorova2007"\n---\n'),
    parseNote("Literature/Lane.md", "---\naliases: ['@lane2006']\n---\nnotes"),
    // Renamed by hand to the key, with nothing else marking it a paper.
    parseNote("Inbox/volberda2010.md", "My notes on Volberda."),
  ]);
  const cite = (key: string) => noteForCitekey(index, key, new Map())?.name;

  it("recognises the note as a paper and reads its key", () => {
    expect(
      index.notes.get("cohen and levinthal - absorptive capacity"),
    ).toMatchObject({
      kind: "paper",
      citekey: "cohenAbsorptiveCapacityNew1990",
      zoteroKey: "QWER1234",
    });
    expect(index.notes.get("zahra")).toMatchObject({
      kind: "paper",
      citekey: "zahra2002",
    });
  });

  it("finds the note for each citation, however it gives its key", () => {
    expect(cite("cohenAbsorptiveCapacityNew1990")).toBe(
      "Cohen and Levinthal - Absorptive capacity",
    );
    expect(cite("zahra2002")).toBe("Zahra");
    expect(cite("todorova2007")).toBe("Todorova");
    expect(cite("lane2006")).toBe("Lane");
    expect(cite("volberda2010")).toBe("volberda2010");
    expect(cite("missing2020")).toBeUndefined();
  });
});

describe("a user's Zotero Integration template", () => {
  // A real note from a user's vault: capitalised fields, no citation key or
  // Zotero link anywhere, and a name of its own (not the key).
  const text = zoteroIntegrationNote;

  it("is a paper, cited by its Better BibTeX key", () => {
    const index = buildVaultIndex([
      parseNote("Lecturas/A human capability approach.md", text),
      parseNote(
        "Lecturas/Boni otro.md",
        "---\nTitle: Another paper\nYear: 2025\nAuthors: Alejandra Boni\n---\n",
      ),
    ]);
    const note = index.notes.get("a human capability approach");
    expect(note).toMatchObject({
      kind: "paper",
      year: "2025",
      title:
        "A human capability approach to transformative innovation policy. Theoretical insights and practical implications for directionality",
    });
    expect(noteForCitekey(index, "boni_human_2025", new Map())?.name).toBe(
      "A human capability approach",
    );
    expect(
      noteForCitekey(index, "boniHumanCapability2025", new Map())?.name,
    ).toBe("A human capability approach");
    expect(noteForCitekey(index, "boni_another_2025", new Map())?.name).toBe(
      "Boni otro",
    );
  });
});

describe("latex4all:// links", () => {
  it("round-trips a project, file and line", async () => {
    const { latex4allLink, parseLatex4AllLink, offsetOfLine } = await import(
      "../deep-link"
    );
    const url = latex4allLink({
      project: "/Users/me/My Paper",
      file: "chapters/intro.tex",
      line: 42,
    });
    expect(url).toBe(
      "latex4all://open?project=%2FUsers%2Fme%2FMy+Paper&file=chapters%2Fintro.tex&line=42",
    );
    expect(parseLatex4AllLink(url)).toEqual({
      project: "/Users/me/My Paper",
      file: "chapters/intro.tex",
      line: 42,
    });
    expect(parseLatex4AllLink("latex4all://open/?project=%2Fp")).toEqual({
      project: "/p",
    });
    expect(parseLatex4AllLink("https://example.com")).toBeNull();
    expect(offsetOfLine("a\nbb\nccc", 3)).toBe(5);
    expect(offsetOfLine("a\nbb", 9)).toBe(4);
  });
});
