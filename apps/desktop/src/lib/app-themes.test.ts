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
    expect(css).not.toContain(".light {");
  });
});
