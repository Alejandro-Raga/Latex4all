import { describe, it, expect } from "vitest";
import { PROJECT_TYPE_SUGGESTIONS, typeMenuOptions } from "@/lib/project-meta";

describe("typeMenuOptions", () => {
  it("keeps the built-in suggestions in order when nothing custom is in use", () => {
    expect(typeMenuOptions([])).toEqual([...PROJECT_TYPE_SUGGESTIONS]);
  });

  it("appends custom types, sorted, after the suggestions", () => {
    const options = typeMenuOptions(["Referee report", "Grant proposal"]);
    expect(options.slice(0, PROJECT_TYPE_SUGGESTIONS.length)).toEqual([
      ...PROJECT_TYPE_SUGGESTIONS,
    ]);
    expect(options.slice(PROJECT_TYPE_SUGGESTIONS.length)).toEqual([
      "Grant proposal",
      "Referee report",
    ]);
  });

  it("does not repeat a suggestion typed in by hand", () => {
    expect(typeMenuOptions(["thesis", "Thesis"])).toEqual([
      ...PROJECT_TYPE_SUGGESTIONS,
    ]);
  });

  it("lists a custom type once, however it was capitalised or spaced", () => {
    const options = typeMenuOptions([
      "Referee report",
      "  referee   report ",
      null,
      undefined,
      "",
    ]);
    expect(options.filter((o) => o.toLowerCase() === "referee report")).toEqual(
      ["Referee report"],
    );
  });
});
