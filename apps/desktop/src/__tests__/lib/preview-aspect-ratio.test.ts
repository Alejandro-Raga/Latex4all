import { describe, it, expect } from "vitest";
import {
  PORTRAIT_ASPECT,
  pageAspectRatio,
  texSourceAspectRatio,
} from "@/lib/preview-aspect-ratio";

describe("preview-aspect-ratio", () => {
  describe("pageAspectRatio", () => {
    it("reports a landscape page as wider than tall", () => {
      // 720pt x 405pt: a 16:9 beamer slide as mupdf measures it.
      expect(pageAspectRatio(720, 405)).toBeCloseTo(16 / 9);
    });

    it("reports A4 as taller than wide", () => {
      expect(pageAspectRatio(595, 842)).toBeLessThan(1);
    });

    it("falls back to portrait on degenerate bounds", () => {
      // A page that fails to measure must not collapse the card to zero
      // height or blow up the grid with an Infinity ratio.
      expect(pageAspectRatio(0, 842)).toBe(PORTRAIT_ASPECT);
      expect(pageAspectRatio(595, 0)).toBe(PORTRAIT_ASPECT);
      expect(pageAspectRatio(-1, 842)).toBe(PORTRAIT_ASPECT);
      expect(pageAspectRatio(Number.NaN, 842)).toBe(PORTRAIT_ASPECT);
      expect(pageAspectRatio(595, Number.POSITIVE_INFINITY)).toBe(
        PORTRAIT_ASPECT,
      );
    });
  });

  describe("texSourceAspectRatio", () => {
    it("treats a plain article as portrait", () => {
      expect(texSourceAspectRatio("\\documentclass{article}")).toBe(
        PORTRAIT_ASPECT,
      );
    });

    it("reads beamer's aspectratio option", () => {
      expect(
        texSourceAspectRatio("\\documentclass[aspectratio=169]{beamer}"),
      ).toBeCloseTo(16 / 9);
      expect(
        texSourceAspectRatio("\\documentclass[aspectratio=1610]{beamer}"),
      ).toBeCloseTo(16 / 10);
    });

    it("defaults beamer to 4:3, which is beamer's own default", () => {
      // Not 16:9: an unqualified beamer document really is 128mm x 96mm.
      expect(texSourceAspectRatio("\\documentclass{beamer}")).toBeCloseTo(
        4 / 3,
      );
    });

    it("keeps beamer landscape even with an unknown aspectratio value", () => {
      expect(
        texSourceAspectRatio("\\documentclass[aspectratio=999]{beamer}"),
      ).toBeCloseTo(4 / 3);
    });

    it("handles other options around aspectratio", () => {
      expect(
        texSourceAspectRatio(
          "\\documentclass[11pt, aspectratio=169, handout]{beamer}",
        ),
      ).toBeCloseTo(16 / 9);
    });

    it("turns a landscape article on its side", () => {
      expect(
        texSourceAspectRatio("\\documentclass[landscape,a4paper]{article}"),
      ).toBeGreaterThan(1);
    });

    it("ignores a commented-out documentclass", () => {
      const source = [
        "% \\documentclass[aspectratio=169]{beamer}",
        "\\documentclass{article}",
      ].join("\n");
      expect(texSourceAspectRatio(source)).toBe(PORTRAIT_ASPECT);
    });

    it("finds the declaration below leading comments and blank lines", () => {
      const source = [
        "% A talk for the department seminar",
        "",
        "  \\documentclass[aspectratio=169]{beamer}",
        "\\usepackage{amsmath}",
      ].join("\n");
      expect(texSourceAspectRatio(source)).toBeCloseTo(16 / 9);
    });

    it("survives source with no documentclass at all", () => {
      expect(texSourceAspectRatio("")).toBe(PORTRAIT_ASPECT);
      expect(texSourceAspectRatio("\\input{preamble}")).toBe(PORTRAIT_ASPECT);
    });

    it("handles CRLF line endings", () => {
      expect(
        texSourceAspectRatio(
          "% talk\r\n\\documentclass[aspectratio=169]{beamer}\r\n",
        ),
      ).toBeCloseTo(16 / 9);
    });
  });
});
