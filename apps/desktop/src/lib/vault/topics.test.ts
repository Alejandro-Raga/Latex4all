import { describe, expect, it } from "vitest";
import { linkSuggestions } from "./link-complete";
import { parseNote } from "./parse";
import {
  isTopicNote,
  newTopicNote,
  paperLine,
  topicsFolderOf,
  topicsOf,
  withPaper,
  withTopicProperty,
} from "./topics";
import { buildVaultIndex, findNote } from "./vault-index";

const index = buildVaultIndex([
  parseNote(
    "Lecturas/A human capability approach.md",
    "---\nTitle: A human capability approach to transformative innovation policy\nYear: 2025\nAuthors: Alejandra Boni, Diana Velasco\n---\n",
  ),
  parseNote(
    "Papers/Cohen1990.md",
    "---\ntitle: 'Absorptive capacity: a new perspective on learning and innovation'\ncitekey: cohen_absorptive_1990\nauthors:\n- Wesley M. Cohen\nyear: 1990\ntopics:\n- \"[[Absorptive capacity]]\"\n---\n",
  ),
  parseNote(
    "Papers/Zahra2002.md",
    "---\ncitekey: zahra2002\nyear: 2002\n---\n",
  ),
  parseNote(
    "Topics/Absorptive capacity.md",
    "---\ntags:\n- topic\nzotero_topic: absorptivecapacity\n---\n",
  ),
  parseNote("Ideas/Capabilities matter.md", "An idea."),
]);
const names = (typed: string) =>
  linkSuggestions(index, typed).map((n) => n.name);

describe("link suggestions", () => {
  it("find a paper by what's in it, not only by its file name", () => {
    expect(names("capability")[0]).toBe("A human capability approach");
    expect(names("boni")).toEqual(["A human capability approach"]);
    expect(names("cohen_absorp")).toEqual(["Cohen1990"]);
    expect(names("learning innovation")).toEqual(["Cohen1990"]);
  });

  it("put names that start with what's typed first", () => {
    expect(names("absorptive")[0]).toBe("Absorptive capacity");
    expect(names("capab").slice(0, 2)).toContain("Capabilities matter");
  });

  it("ignore accents and case, and show everything for an empty [[", () => {
    expect(names("CAPÁBILITY")).toContain("A human capability approach");
    expect(names("")).toHaveLength(index.list.length);
  });
});

describe("topics", () => {
  const cohen = findNote(index, "Cohen1990")!;
  const zahra = findNote(index, "Zahra2002")!;

  it("are recognised, with the papers already in them", () => {
    expect(isTopicNote(findNote(index, "Absorptive capacity")!)).toBe(true);
    expect(isTopicNote(cohen)).toBe(false);
    expect([...topicsOf(index, cohen)]).toEqual(["Absorptive capacity"]);
    expect(topicsFolderOf(index)).toBe("Topics");
  });

  it("start in the Zotero sync's shape", () => {
    const text = newTopicNote(
      "Absorptive capacity",
      paperLine(zahra),
      "2026-09-30",
    );
    expect(text).toContain("zotero_topic: absorptivecapacity");
    expect(text).toContain(
      "%% begin zotero %%\n## Literature\n\n- [[Zahra2002]] (2002)\n%% end zotero %%",
    );
  });

  it("list a new paper in their literature, once", () => {
    const topic =
      "---\ntags:\n- topic\n---\n## Definition\n\n%% begin zotero %%\n## Literature\n\n- [[Cohen1990]] Absorptive (1990)\n%% end zotero %%\n\n## My notes\n\nMine.\n";
    const once = withPaper(topic, zahra);
    expect(once).toContain(
      "- [[Cohen1990]] Absorptive (1990)\n- [[Zahra2002]] (2002)\n%% end zotero %%",
    );
    expect(withPaper(once, zahra)).toBe(once);
    expect(once).toContain("## My notes\n\nMine.");
  });

  it("gather papers under a heading in a topic note of the user's own", () => {
    const own = "# Absorptive capacity\n\nWhat it means.";
    const once = withPaper(own, zahra);
    expect(once).toBe(
      "# Absorptive capacity\n\nWhat it means.\n\n## Papers\n\n- [[Zahra2002]] (2002)\n",
    );
    expect(withPaper(once, cohen)).toContain(
      "## Papers\n\n- [[Zahra2002]] (2002)\n- [[Cohen1990]]",
    );
  });

  it("link the paper to its topics, however its property is written", () => {
    expect(withTopicProperty("Body", "T")).toBe(
      '---\ntopics:\n- "[[T]]"\n---\nBody',
    );
    expect(withTopicProperty("---\ntitle: x\n---\nBody", "T")).toBe(
      '---\ntitle: x\ntopics:\n- "[[T]]"\n---\nBody',
    );
    expect(
      withTopicProperty('---\ntopics:\n- "[[A]]"\nyear: 1\n---\n', "T"),
    ).toBe('---\ntopics:\n- "[[A]]"\n- "[[T]]"\nyear: 1\n---\n');
    expect(withTopicProperty('---\ntopics: ["[[A]]"]\n---\n', "T")).toBe(
      '---\ntopics:\n- "[[A]]"\n- "[[T]]"\n---\n',
    );
    // And Latex4All's own index sees the link.
    const linked = parseNote("P.md", withTopicProperty("Body", "T"));
    expect(linked.links.map((l) => l.target)).toEqual(["T"]);
  });
});
