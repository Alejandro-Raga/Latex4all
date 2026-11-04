import { describe, expect, it } from "vitest";
import { foldersOf, isUnder, rejoined, toggled } from "./sync-choices";

describe("sync choices", () => {
  it("covers a file and everything in a folder, not lookalikes", () => {
    expect(isUnder("refs.bib", ["refs.bib"])).toBe(true);
    expect(isUnder("figures/a.png", ["figures"])).toBe(true);
    expect(isUnder("figures2/a.png", ["figures"])).toBe(false);
    expect(isUnder("main.tex", [])).toBe(false);
  });

  it("lists the folders above a path", () => {
    expect(foldersOf("a/b/c.png")).toEqual(["a", "a/b"]);
    expect(foldersOf("main.tex")).toEqual([]);
  });

  it("unticking a folder replaces what was listed inside it", () => {
    expect(toggled(["figures/a.png", "refs.bib"], "figures", false)).toEqual([
      "figures",
      "refs.bib",
    ]);
  });

  it("unticking inside a folder already left out changes nothing", () => {
    expect(toggled(["figures"], "figures/a.png", false)).toEqual(["figures"]);
  });

  it("ticking removes the path and anything inside it", () => {
    expect(
      toggled(["figures", "figures/x/y.png", "refs.bib"], "figures", true),
    ).toEqual(["refs.bib"]);
  });

  it("tells which paths came back in", () => {
    expect(rejoined(["figures", "refs.bib"], ["refs.bib"])).toEqual([
      "figures",
    ]);
  });
});
