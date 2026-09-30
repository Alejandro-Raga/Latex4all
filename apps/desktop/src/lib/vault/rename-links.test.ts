import { describe, expect, it } from "vitest";
import { renameLinks } from "./rename-links";

describe("renaming a note's links", () => {
  it("follows every way of linking, and nothing else", () => {
    const text = [
      '---\nproject: "[[Old paper]]"\n---',
      "See [[Old paper]], [[old paper|my draft]] and [[Old paper#Methods]].",
      "![[Old paper]] and [[Old paper.md]].",
      "Not [[Old paper 2]] nor [[An Old paper]] nor Old paper.",
    ].join("\n");
    expect(renameLinks(text, "Old paper", "New title")).toBe(
      [
        '---\nproject: "[[New title]]"\n---',
        "See [[New title]], [[New title|my draft]] and [[New title#Methods]].",
        "![[New title]] and [[New title]].",
        "Not [[Old paper 2]] nor [[An Old paper]] nor Old paper.",
      ].join("\n"),
    );
  });
});
