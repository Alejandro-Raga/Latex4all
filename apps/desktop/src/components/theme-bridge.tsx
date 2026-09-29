import { useEffect } from "react";
import { useTheme } from "next-themes";
import {
  CUSTOM_THEME,
  isDarkTheme,
  setCustomThemeColors,
  themeStyles,
  themeVariables,
} from "@/lib/app-themes";
import { useSettingsStore } from "@/stores/settings-store";

const STYLE_ID = "latex4all-blended-themes";

/**
 * Keeps <html> in step with the chosen theme: the blended themes' styles,
 * the custom theme's colors, and the `theme-dark` class that switches
 * Tailwind's dark variant for every dark theme.
 */
export function ThemeBridge() {
  const { resolvedTheme: resolved, forcedTheme } = useTheme();
  const resolvedTheme = forcedTheme ?? resolved;
  const custom = useSettingsStore((s) => s.customTheme);

  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = themeStyles();
    document.head.append(style);
  }, []);

  useEffect(() => {
    setCustomThemeColors(custom);
    const root = document.documentElement;
    const vars = themeVariables(custom);
    for (const [name, value] of Object.entries(vars)) {
      if (resolvedTheme === CUSTOM_THEME) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
    root.classList.toggle("theme-dark", isDarkTheme(resolvedTheme));
  }, [resolvedTheme, custom]);

  return null;
}
