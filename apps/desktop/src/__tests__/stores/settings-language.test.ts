import { describe, expect, it } from "vitest";
import { CHECK_LANGUAGES, useSettingsStore } from "@/stores/settings-store";

describe("check language", () => {
  it("offers English and Spanish only", () => {
    expect(CHECK_LANGUAGES.map((l) => l.code)).toEqual([
      "en-US",
      "en-GB",
      "en-CA",
      "en-AU",
      "es",
    ]);
  });

  it("refuses a language that is no longer offered", () => {
    // Someone who had picked German before it was withdrawn would otherwise
    // keep it selected, leaving the picker blank and the checkers aimed at a
    // language with nothing behind it.
    useSettingsStore.getState().setCheckLanguage("de");
    expect(useSettingsStore.getState().checkLanguage).toBe("en-US");
  });

  it("accepts one that is", () => {
    useSettingsStore.getState().setCheckLanguage("es");
    expect(useSettingsStore.getState().checkLanguage).toBe("es");
  });
});
