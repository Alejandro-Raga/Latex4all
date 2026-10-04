import { describe, expect, it } from "vitest";
import { newGroupNote, passageMarkdown, withPassage } from "./add-passage";
import { parseNote } from "./parse";
import { buildVaultIndex, findNote } from "./vault-index";

const index = buildVaultIndex([
  parseNote(
    "Papers/Bloom2020.md",
    "---\ntitle: Are Ideas Getting Harder to Find?\ncitekey: Bloom2020\nyear: 2020\n---\n",
  ),
  parseNote(
    "Papers/Arora2018.md",
    "---\ntitle: The decline of science in corporate R&D\ncitekey: Arora2018\nyear: 2018\n---\n",
  ),
]);
const bloom = findNote(index, "Bloom2020")!;
const arora = findNote(index, "Arora2018")!;
const passage = (key: string, text: string, comment?: string) => ({
  itemKey: "PAPER001",
  attachmentKey: "ATT00001",
  annotationKey: key,
  text,
  comment,
  pageLabel: "2",
  pageIndex: 1,
});

describe("a highlight filed under an idea", () => {
  it("is written as the Zotero sync writes it", () => {
    expect(
      passageMarkdown(
        "Bloom2020",
        passage(
          "ANN00001",
          "research produc­ tivity is declining",
          "Key evidence",
        ),
      ),
    ).toBe(
      "> research productivity is declining\n> — [[Bloom2020#^ann00001|Bloom2020, p. 2]] · [PDF](zotero://open-pdf/library/items/ATT00001?page=2&annotation=ANN00001)\n\nKey evidence",
    );
  });

  it("makes a new idea note with the paper and the passage", () => {
    const note = newGroupNote(
      "idea",
      "Science is getting harder",
      "2026-10-04",
    );
    const md = passageMarkdown(
      "Bloom2020",
      passage("ANN00001", "research productivity is declining"),
    );
    const text = withPassage(note, bloom, "ANN00001", md);
    expect(text).toContain("zotero_idea: scienceisgettingharder");
    expect(text).toContain("## The idea");
    expect(text).toMatch(
      /## Literature\n\n- \[\[Bloom2020\]\] Are Ideas Getting Harder to Find\? \(2020\)\n\n## Passages\n\n### \[\[Bloom2020\]\] Are Ideas Getting Harder to Find\?\n\n> research productivity is declining/,
    );
    expect(text.indexOf("%% end zotero %%")).toBeGreaterThan(
      text.indexOf("> research"),
    );
    expect(text.trimEnd().endsWith("## My notes")).toBe(true);
  });

  it("adds a second passage under its paper, a new paper after, and nothing twice", () => {
    const note = newGroupNote("topic", "Corporate science", "2026-10-04");
    let text = withPassage(
      note,
      bloom,
      "A1",
      passageMarkdown("Bloom2020", passage("A1", "first")),
    );
    text = withPassage(
      text,
      arora,
      "A2",
      passageMarkdown("Arora2018", passage("A2", "second")),
    );
    text = withPassage(
      text,
      bloom,
      "A3",
      passageMarkdown("Bloom2020", passage("A3", "third")),
    );
    const again = withPassage(
      text,
      bloom,
      "A3",
      passageMarkdown("Bloom2020", passage("A3", "third")),
    );
    expect(again).toBe(text);
    expect(text).toContain("## Definition");
    const lit = text.slice(
      text.indexOf("## Literature"),
      text.indexOf("## Passages"),
    );
    expect(lit.match(/- \[\[/g)).toHaveLength(2);
    // Bloom's passages together, before Arora's heading.
    const order = ["> first", "> third", "### [[Arora2018]]", "> second"].map(
      (s) => text.indexOf(s),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("goes below what's written in a note made by hand", () => {
    const text = withPassage(
      "My own thoughts on this.\n",
      bloom,
      "A1",
      passageMarkdown("Bloom2020", passage("A1", "first")),
    );
    expect(
      text.startsWith("My own thoughts on this.\n\n%% begin zotero %%"),
    ).toBe(true);
    expect(text).toContain("> first");
  });
});
