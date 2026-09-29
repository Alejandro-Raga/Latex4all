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
