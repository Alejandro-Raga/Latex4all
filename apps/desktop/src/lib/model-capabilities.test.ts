import { describe, expect, it } from "vitest";
import {
  isChatModelOption,
  newestModelsFirst,
  suggestedReplacement,
} from "./model-capabilities";

describe("Gemini's model list", () => {
  const gemini = "https://generativelanguage.googleapis.com/v1beta/openai";
  const chat = (model: string) => isChatModelOption({ baseUrl: gemini, model });

  it("keeps chat models, not live audio, image, video or speech ones", () => {
    expect(chat("models/gemini-3.8-flash")).toBe(true);
    expect(chat("models/gemini-3.1-pro-preview")).toBe(true);
    expect(chat("models/gemini-3.8-live")).toBe(false);
    expect(chat("models/gemini-2.5-flash-native-audio-dialog")).toBe(false);
    expect(chat("models/gemini-2.5-flash-image")).toBe(false);
    expect(chat("models/imagen-4.0-generate")).toBe(false);
    expect(chat("models/veo-3.0-generate")).toBe(false);
    expect(chat("models/gemini-2.5-flash-preview-tts")).toBe(false);
    expect(chat("models/gemini-embedding-001")).toBe(false);
  });

  it("puts the newest first, a stable one before its preview", () => {
    expect(
      newestModelsFirst([
        "models/gemini-2.5-flash",
        "models/gemini-3.1-pro-preview",
        "models/gemini-3.8-flash",
        "models/gemini-3.1-pro",
      ]),
    ).toEqual([
      "models/gemini-3.8-flash",
      "models/gemini-3.1-pro",
      "models/gemini-3.1-pro-preview",
      "models/gemini-2.5-flash",
    ]);
  });

  it("reads the successor a retired model's error names", () => {
    expect(
      suggestedReplacement(
        "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features",
      ),
    ).toBe("gemini-3.8-flash");
    expect(suggestedReplacement("Invalid API key")).toBeNull();
    // Not a model name: no retry.
    expect(
      suggestedReplacement(
        "models/gemini-3.8-live only supports real-time bidirectional streaming via WebSocket (bidiGenerateContent). Please use the Gemini Live API instead of generateContent.",
      ),
    ).toBeNull();
  });
});
