import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  filterNotes,
  mergeFilters,
  parseNoteQuery,
} from "./note-query";
import { parseNote } from "./parse";
import { buildVaultIndex } from "./vault-index";

const paper = (
  name: string,
  year: number | null,
  authors: string[],
  extra = "",
) =>
  parseNote(
    `Papers/${name}.md`,
    `---\ntitle: ${name} title\ncitekey: ${name}\nauthors:\n${authors.map((a) => `- ${a}`).join("\n")}\n${year ? `year: ${year}\n` : ""}tags:\n- paper\n${extra}---\nBody about spillovers.\n`,
  );

const index = buildVaultIndex([
  paper("Nelson1959", 1959, ["Richard R. Nelson"]),
  paper("Arrow1962", 1962, ["Kenneth Arrow"]),
  paper(
    "Cohen1990",
    1990,
    ["Wesley M. Cohen", "Daniel A. Levinthal"],
    'topics:\n- "[[Absorptive capacity]]"\n',
  ),
  paper(
    "Arora2018",
    2018,
    ["Ashish Arora", "Sharon Belenzon"],
    'topics:\n- "[[Corporate science]]"\n',
  ),
  paper("Undated", null, ["Anon"]),
  parseNote("Topics/Absorptive capacity.md", "---\ntags:\n- topic\n---\n"),
  parseNote("Topics/Corporate science.md", "---\ntags:\n- topic\n---\n"),
  parseNote("Ideas/Science is harder.md", "[[Arora2018]]"),
]);
const names = (q: string, sort?: Parameters<typeof filterNotes>[3]) =>
  filterNotes(index, index.list, parseNoteQuery(q), sort).map((n) => n.name);

describe("vault search, Zotero-like", () => {
  it("reads field conditions and words", () => {
    expect(
      parseNoteQuery(
        'author:nelson year:1950-1970 topic:"corporate science" tag:#paper spill',
      ),
    ).toEqual({
      ...EMPTY_FILTER,
      words: ["spill"],
      authors: ["nelson"],
      yearFrom: 1950,
      yearTo: 1970,
      topics: ["corporate science"],
      tags: ["paper"],
    });
    expect(parseNoteQuery("year:>2000").yearFrom).toBe(2001);
    expect(parseNoteQuery("y:<=1990").yearTo).toBe(1990);
    expect(parseNoteQuery("https://x.org").words).toEqual(["https://x.org"]);
  });

  it("filters by year, author, topic and type", () => {
    expect(names("year:1950-1970").sort()).toEqual(["Arrow1962", "Nelson1959"]);
    expect(names("year:2018")).toEqual(["Arora2018"]);
    expect(names("author:levinthal")).toEqual(["Cohen1990"]);
    expect(names("topic:absorptive")).toEqual(["Cohen1990"]);
    expect(names("type:topic")).toEqual([
      "Absorptive capacity",
      "Corporate science",
    ]);
    expect(names("spillovers year:>1980 type:paper").sort()).toEqual([
      "Arora2018",
      "Cohen1990",
    ]);
  });

  it("sorts by year either way, undated last", () => {
    const papers = "type:paper";
    expect(names(papers, "year-desc")).toEqual([
      "Arora2018",
      "Cohen1990",
      "Arrow1962",
      "Nelson1959",
      "Undated",
    ]);
    expect(names(papers, "year-asc")[0]).toBe("Nelson1959");
    const oldest = names(papers, "year-asc");
    expect(oldest[oldest.length - 1]).toBe("Undated");
    // By first author's surname: Anon, Arora, Arrow, Cohen, Nelson.
    expect(names(papers, "author")).toEqual([
      "Undated",
      "Arora2018",
      "Arrow1962",
      "Cohen1990",
      "Nelson1959",
    ]);
  });

  it("combines what's typed with the filter row", () => {
    const row = { ...EMPTY_FILTER, yearFrom: 1960 };
    const merged = mergeFilters(parseNoteQuery("year:1950-1995"), row);
    expect([merged.yearFrom, merged.yearTo]).toEqual([1960, 1995]);
  });
});
