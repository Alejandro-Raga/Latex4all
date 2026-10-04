import { describe, expect, it } from "vitest";
import type { ZoteroItemSummary } from "@/lib/zotero-api";
import { parsePublicationYear } from "@/lib/zotero-api";
import {
  filterReferences,
  parseQuery,
  searchReferences,
  sortReferences,
  splitConditions,
} from "@/lib/zotero-search";

const item = (
  key: string,
  title: string,
  creators: string,
  date: string,
): ZoteroItemSummary => ({
  key,
  title,
  creators,
  year: String(parsePublicationYear(date) ?? ""),
  date,
});

const library = [
  item("a", "Climate policy in Europe", "García, Lopez", "2019-03-01"),
  item("b", "A history of Spanish grammar", "Núñez", "May 2004"),
  item("c", "Deep learning for climate models", "Smith, García", "2021"),
  item("d", "Notes on typesetting", "Knuth", "in press"),
];

const keys = (items: ZoteroItemSummary[]) => items.map((i) => i.key);

describe("parsePublicationYear", () => {
  it("reads the year wherever it sits in Zotero's free-text date", () => {
    expect(parsePublicationYear("2019-03-01")).toBe(2019);
    expect(parsePublicationYear("May 2004")).toBe(2004);
    expect(parsePublicationYear("12/05/2020")).toBe(2020);
    expect(parsePublicationYear("2021")).toBe(2021);
  });

  it("returns null when there is no year to read", () => {
    expect(parsePublicationYear("in press")).toBeNull();
    expect(parsePublicationYear("")).toBeNull();
    expect(parsePublicationYear("volume 12")).toBeNull();
  });
});

describe("filterReferences", () => {
  it("matches on the article name", () => {
    expect(keys(filterReferences(library, "climate"))).toEqual(["a", "c"]);
  });

  it("matches on an author name", () => {
    expect(keys(filterReferences(library, "knuth"))).toEqual(["d"]);
  });

  it("ignores accents in both the query and the library", () => {
    expect(keys(filterReferences(library, "garcia"))).toEqual(["a", "c"]);
    expect(keys(filterReferences(library, "nunez"))).toEqual(["b"]);
    expect(keys(filterReferences(library, "García"))).toEqual(["a", "c"]);
  });

  it("narrows as terms are added", () => {
    expect(keys(filterReferences(library, "climate garcia"))).toEqual([
      "a",
      "c",
    ]);
    expect(keys(filterReferences(library, "climate smith"))).toEqual(["c"]);
  });

  it("scopes a term to one field when asked", () => {
    expect(keys(filterReferences(library, "author:garcia"))).toEqual([
      "a",
      "c",
    ]);
    // "grammar" is in a title, so an author-scoped search must not find it.
    expect(keys(filterReferences(library, "author:grammar"))).toEqual([]);
    expect(keys(filterReferences(library, "title:grammar"))).toEqual(["b"]);
  });

  it("keeps quoted phrases together", () => {
    expect(parseQuery('"climate policy"')).toEqual([
      { field: "any", text: "climate policy" },
    ]);
    expect(keys(filterReferences(library, '"climate policy"'))).toEqual(["a"]);
    expect(keys(filterReferences(library, '"policy climate"'))).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(keys(filterReferences(library, "   "))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("sortReferences", () => {
  it("orders by publication date, newest first", () => {
    expect(keys(sortReferences(library, "newest"))).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("orders by publication date, oldest first", () => {
    expect(keys(sortReferences(library, "oldest"))).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("keeps undated items last in both directions", () => {
    const newest = keys(sortReferences(library, "newest"));
    const oldest = keys(sortReferences(library, "oldest"));
    expect(newest[newest.length - 1]).toBe("d");
    expect(oldest[oldest.length - 1]).toBe("d");
  });

  it("orders by title", () => {
    expect(keys(sortReferences(library, "title"))).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("orders by first author, accents aside, no author last", () => {
    const anonymous = item("e", "Anonymous pamphlet", "", "1990");
    expect(keys(sortReferences([...library, anonymous], "author"))).toEqual([
      "a",
      "d",
      "b",
      "c",
      "e",
    ]);
  });

  it("leaves the library alone when there is nothing to rank it by", () => {
    expect(keys(sortReferences(library, "relevance"))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("does not mutate the input", () => {
    const original = [...library];
    sortReferences(library, "newest");
    expect(library).toEqual(original);
  });
});

describe("searchReferences", () => {
  it("puts a title hit above an author-only hit", () => {
    expect(
      keys(searchReferences(library, "garcia climate", "relevance")),
    ).toEqual(["a", "c"]);
  });

  it("applies the chosen order to the matches", () => {
    expect(keys(searchReferences(library, "climate", "oldest"))).toEqual([
      "a",
      "c",
    ]);
    expect(keys(searchReferences(library, "climate", "newest"))).toEqual([
      "c",
      "a",
    ]);
  });
});

describe("library conditions", () => {
  const typed = [
    { ...library[0], itemType: "journalArticle" },
    { ...library[1], itemType: "book" },
    { ...library[2], itemType: "journalArticle" },
    { ...library[3], itemType: "book" },
  ];

  it("reads year: and type: out of the words", () => {
    const { filter, words } = splitConditions("climate year:>2019 type:book");
    expect(filter).toEqual({ yearFrom: 2020, yearTo: null, type: "book" });
    expect(words).toBe("climate");
    expect(splitConditions("year:2000-2010").filter.yearTo).toBe(2010);
  });

  it("narrows by a typed or picked year range and type", () => {
    expect(keys(searchReferences(typed, "year:2010-2025", "oldest"))).toEqual([
      "a",
      "c",
    ]);
    const picked = { yearFrom: 2000, yearTo: null, type: "book" };
    expect(keys(searchReferences(typed, "", "relevance", picked))).toEqual([
      "b",
    ]);
    expect(keys(searchReferences(typed, "type:journal", "title"))).toEqual([
      "a",
      "c",
    ]);
  });
});
