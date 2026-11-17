import { describe, expect, it } from "vitest";
import {
  copyOf,
  differences,
  findCopies,
  isClutterCopy,
} from "./conflicted-copies";

describe("conflicted copies", () => {
  it("knows each sync's copies and what they're copies of", () => {
    expect(copyOf("main (conflicted copy).tex")).toBe("main.tex");
    expect(copyOf("ch/intro (conflicted copy 2).tex")).toBe("ch/intro.tex");
    expect(copyOf(".git (conflicted copy)")).toBe(".git");
    expect(copyOf("refs (Ana's conflicted copy 2026-10-26).bib")).toBe(
      "refs.bib",
    );
    expect(copyOf("refs (Ana's conflicted copy 2026-10-26 (1)).bib")).toBe(
      "refs.bib",
    );
    expect(copyOf("fig/a (SFConflict ana@uv.es 2026-10-26-09-48-13).png")).toBe(
      "fig/a.png",
    );
    expect(copyOf("main.tex")).toBeNull();
    expect(copyOf("paper (2).pdf")).toBeNull();
    expect(copyOf("notes on conflicted copy.md")).toBeNull();
  });

  it("lists them, saying whether the original is there", () => {
    const found = findCopies([
      "main.tex",
      "main (conflicted copy).tex",
      "old (conflicted copy).bib",
      ".git (conflicted copy)",
    ]);
    expect(found.map((c) => [c.copy, c.originalExists])).toEqual([
      [".git (conflicted copy)", false],
      ["main (conflicted copy).tex", true],
      ["old (conflicted copy).bib", false],
    ]);
    expect(found.map(isClutterCopy)).toEqual([true, false, false]);
  });

  it("shows where a copy differs, with its line", () => {
    const d = differences("one\ntwo three\nfour", "one\ntwo 3\nfour");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ line: 2, original: "three", copy: "3" });
    expect(d[0].before.endsWith("two ")).toBe(true);
  });
});
