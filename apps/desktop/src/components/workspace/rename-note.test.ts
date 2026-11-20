import { describe, expect, it } from "vitest";
import { nameProblem } from "./rename-note";

describe("a note's new name", () => {
  it("takes accents, spaces and dashes", () => {
    expect(nameProblem("Innovación — notas 2026")).toBeNull();
  });
  it("can't be empty, a path or break a link", () => {
    expect(nameProblem("  ")).not.toBeNull();
    for (const bad of [
      "a/b",
      "a\\b",
      "a:b",
      "a#b",
      "a|b",
      "a[b]",
      "a^b",
      ".hidden",
    ]) {
      expect(nameProblem(bad), bad).not.toBeNull();
    }
  });
});
