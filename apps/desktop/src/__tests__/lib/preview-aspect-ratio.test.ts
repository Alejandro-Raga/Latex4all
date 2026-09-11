import { describe, it, expect } from "vitest";
import {
  CARD_ASPECT,
  PORTRAIT_ASPECT,
  pageAspectRatio,
  pageFit,
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

  describe("pageFit", () => {
    it("limits a page taller than the card by height", () => {
      // A4 (0.707) is taller than the 3:4 card, so its height sets the size
      // and the leftover shows at the sides.
      expect(pageFit(1 / Math.SQRT2)).toBe("height");
    });

    it("limits a wide page by width", () => {
      expect(pageFit(16 / 9)).toBe("width");
      expect(pageFit(4 / 3)).toBe("width");
    });

    it("treats a page the same shape as the card as width-limited", () => {
      // Either answer fits exactly; pinning to width keeps it flush with the
      // card edges rather than leaving a sub-pixel seam.
      expect(pageFit(CARD_ASPECT)).toBe("width");
    });

    it("never reports a fit that would overflow the card", () => {
      for (const ratio of [0.3, 0.5, Math.SQRT1_2, 0.75, 1, 1.33, 1.78, 3]) {
        const fit = pageFit(ratio);
        // Card is 1 wide by 1/CARD_ASPECT tall in card-width units.
        const [w, h] =
          fit === "width"
            ? [1, 1 / ratio]
            : [ratio / CARD_ASPECT, 1 / CARD_ASPECT];
        expect(w).toBeLessThanOrEqual(1.0001);
        expect(h).toBeLessThanOrEqual(1 / CARD_ASPECT + 0.0001);
      }
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
