import { describe, expect, it } from "vitest";
import { mergeText, textChanges } from "@/lib/text-merge";

describe("mergeText", () => {
  it("keeps changes to different parts from both sides", () => {
    const { text, conflicts } = mergeText(
      "Intro.\nMethods.\nResults.",
      "Introduction.\nMethods.\nResults.",
      "Intro.\nMethods.\nResults, finally.",
    );
    expect(text).toBe("Introduction.\nMethods.\nResults, finally.");
    expect(conflicts).toEqual([]);
  });

  it("doesn't double a change both sides made", () => {
    const { text, conflicts } = mergeText(
      "one two three",
      "one 2 three four",
      "zero one 2 three",
    );
    expect(text).toBe("zero one 2 three four");
    expect(conflicts).toEqual([]);
  });

  it("keeps theirs whole where both changed the same words, and reports ours", () => {
    const { text, conflicts } = mergeText(
      "The results are good.",
      "The results are excellent.",
      "The findings are mediocre.",
    );
    expect(text).toBe("The findings are mediocre.");
    expect(conflicts).toEqual([
      {
        from: text.indexOf("mediocre"),
        to: text.indexOf("mediocre") + "mediocre".length,
        other: "excellent",
        otherIsOurs: true,
      },
    ]);
  });

  it("keeps ours when theirs only deleted what we changed", () => {
    const { text, conflicts } = mergeText(
      "Keep. Drop this. Keep.",
      "Keep. Drop this, edited. Keep.",
      "Keep. Keep.",
    );
    expect(text).toBe("Keep. Drop this, edited. Keep.");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].other).toBe("");
    expect(conflicts[0].otherIsOurs).toBe(false);
    expect(text.slice(conflicts[0].from, conflicts[0].to)).toContain(
      "Drop this, edited",
    );
  });

  it("never splits an emoji", () => {
    const { text } = mergeText("a 😀 b", "a 😀 c", "a 😃 b");
    expect(text).toBe("a 😃 c");
  });
});

describe("textChanges", () => {
  it("edits only what differs, in several places", () => {
    const from = "alpha beta gamma";
    const to = "alpha BETA gamma!";
    const changes = textChanges(from, to);
    expect(changes.length).toBeGreaterThan(1);
    let result = from;
    for (const c of [...changes].reverse()) {
      result = result.slice(0, c.from) + c.insert + result.slice(c.to);
    }
    expect(result).toBe(to);
  });
});
