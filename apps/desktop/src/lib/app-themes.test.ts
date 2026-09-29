import { describe, expect, it } from "vitest";
import {
  APP_THEMES,
  isDarkColor,
  isDarkTheme,
  luminance,
  readableOn,
  setCustomThemeColors,
  themeStyles,
} from "./app-themes";

describe("app themes", () => {
  it("measures how light a color is", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(isDarkColor("#282a36")).toBe(true);
    expect(isDarkColor("#fdf6e3")).toBe(false);
  });

  it("picks text that reads on an accent", () => {
    expect(readableOn("#39ff14")).toBe("#111111");
    expect(readableOn("#268bd2")).toBe("#ffffff");
  });

  it("marks each theme dark or light to match its background", () => {
    for (const t of APP_THEMES) {
      expect(isDarkColor(t.colors.bg), t.id).toBe(t.dark);
    }
  });

  it("treats the custom theme as dark when its background is dark", () => {
    setCustomThemeColors({
      bg: "#101820",
      surface: "#18222c",
      fg: "#e0e0e0",
      accent: "#ff8800",
    });
    expect(isDarkTheme("custom")).toBe(true);
    setCustomThemeColors({
      bg: "#fafafa",
      surface: "#eeeeee",
      fg: "#222222",
      accent: "#ff8800",
    });
    expect(isDarkTheme("custom")).toBe(false);
  });

  it("writes styles for every blended theme and the custom one", () => {
    const css = themeStyles();
    for (const t of APP_THEMES.filter((t) => !t.handTuned)) {
      expect(css).toContain(`.${t.id} {`);
    }
    expect(css).toContain(".custom");
    expect(css).toContain("--primary-foreground: var(--t-on-accent)");
    expect(css).not.toContain(".light { --t-bg");
  });

  it("gives every theme its editor colors, and stripes where it has them", () => {
    const css = themeStyles();
    for (const t of APP_THEMES) {
      expect(css).toContain(`.${t.id} {`);
      expect(css).toContain(`--syn-command: ${t.palette.command};`);
    }
    expect(css).toContain("html.spectrum body::before");
    expect(css).toMatch(
      /\.custom \{[^}]*--syn-env: oklch\(from var\(--t-accent\)/,
    );
  });

  it("keeps text and syntax colors readable on each background", () => {
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const t of APP_THEMES) {
      const { bg, fg } = t.colors;
      expect(contrast(fg, bg), `${t.id} text`).toBeGreaterThan(7);
      for (const k of [
        "command",
        "env",
        "string",
        "math",
        "number",
        "heading",
      ] as const) {
        expect(contrast(t.palette[k], bg), `${t.id} ${k}`).toBeGreaterThan(3.2);
      }
      expect(
        contrast(t.palette.comment, bg),
        `${t.id} comment`,
      ).toBeGreaterThan(2.2);
    }
  });

  it("gives colorful and retro themes more than one hue", () => {
    for (const t of APP_THEMES.filter((t) => t.group !== "Classic")) {
      const hues = new Set(
        Object.values(t.palette).map((c) => c.toLowerCase()),
      );
      expect(hues.size, t.id).toBeGreaterThanOrEqual(6);
    }
  });
});
