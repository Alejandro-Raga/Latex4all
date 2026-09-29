/**
 * The app's color themes. Each is a class on <html> that sets the color
 * variables in globals.css; the dark ones also switch Tailwind's `dark:`
 * variant and the dark editor and window chrome.
 */
export interface AppTheme {
  id: string;
  label: string;
  dark: boolean;
  /** Swatch for pickers: background, surface and accent. */
  swatch: [string, string, string];
}

export const APP_THEMES: AppTheme[] = [
  {
    id: "light",
    label: "Light",
    dark: false,
    swatch: ["#ffffff", "#f5f5f5", "#171717"],
  },
  {
    id: "paper",
    label: "Paper",
    dark: false,
    swatch: ["#f8f3e8", "#efe7d6", "#6b4f2e"],
  },
  {
    id: "sky",
    label: "Sky",
    dark: false,
    swatch: ["#f6f9fd", "#e8eff8", "#2563eb"],
  },
  {
    id: "dark",
    label: "Dark",
    dark: true,
    swatch: ["#0a0a0a", "#262626", "#e5e5e5"],
  },
  {
    id: "dim",
    label: "Dim",
    dark: true,
    swatch: ["#26282c", "#32353a", "#d7d9dd"],
  },
  {
    id: "nord",
    label: "Nord",
    dark: true,
    swatch: ["#2e3440", "#3b4252", "#88c0d0"],
  },
];

export const THEME_IDS = APP_THEMES.map((t) => t.id);

/** Whether a next-themes resolved theme is one of the dark ones. */
export function isDarkTheme(resolved: string | undefined): boolean {
  return APP_THEMES.find((t) => t.id === resolved)?.dark ?? false;
}
