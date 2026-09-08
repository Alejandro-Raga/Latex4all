import { describe, expect, it } from "vitest";
import { extractCheckableSpans } from "@/components/workspace/editor/latex-spellcheck-spans";

const words = (text: string) =>
  extractCheckableSpans(text).map((span) => span.word);

describe("extractCheckableSpans", () => {
  it("keeps accented words whole instead of splitting them at the accent", () => {
    // The bug this guards: an ASCII-only word pattern turned "análisis" into
    // "an" + "lisis", and the spell checker flagged the fragments — so
    // correctly spelled Spanish read as misspelled wherever it had an accent.
    expect(words("El análisis de la situación económica española")).toEqual([
      "El",
      "análisis",
      "de",
      "la",
      "situación",
      "económica",
      "española",
    ]);
  });

  it("handles the other offered languages' diacritics too", () => {
    expect(words("Über größere Änderungen")).toEqual([
      "Über",
      "größere",
      "Änderungen",
    ]);
    expect(words("Le café où j'étais")).toEqual([
      "Le",
      "café",
      "où",
      "j'étais",
    ]);
    expect(words("A informação está disponível")).toEqual([
      "informação",
      "está",
      "disponível",
    ]);
  });

  it("keeps a decomposed accent welded to its letter", () => {
    // "análisis" written NFD: "a" + U+0301 combining acute, which is what a
    // dead-key keyboard or a macOS-sourced file can put in the document.
    const nfd = "El ana\u0301lisis";
    expect(nfd).not.toBe(nfd.normalize("NFC"));
    expect(words(nfd)).toEqual(["El", nfd.slice(3)]);
  });

  it("reports spans that address the word in the source", () => {
    const text = "La reunión fue larga";
    const spans = extractCheckableSpans(text);
    for (const span of spans) {
      expect(text.slice(span.from, span.to)).toBe(span.word);
    }
  });

  it("still skips LaTeX commands, math and technical arguments", () => {
    expect(
      words("\\cite{garcia2020} muestra que $\\alpha$ crece \\textbf{mucho}"),
    ).toEqual(["muestra", "que", "crece", "mucho"]);
  });

  it("drops trailing apostrophes and hyphens", () => {
    expect(words("bien- hecho")).toEqual(["bien", "hecho"]);
  });

  it("leaves digits out of words", () => {
    expect(words("agua H2O pura")).toEqual(["agua", "pura"]);
  });
});
