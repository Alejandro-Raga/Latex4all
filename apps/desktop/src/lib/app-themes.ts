/**
 * The app's color themes. Each is a class on <html>. The first six have hand
 * tuned variables in globals.css; the rest (and a custom one) are described by
 * four colors, from which every UI color is blended (see themeStyles).
 */
export interface ThemeColors {
  /** Page and editor background. */
  bg: string;
  /** Sidebar and panels. */
  surface: string;
  /** Text. */
  fg: string;
  /** Buttons, selection, links. */
  accent: string;
}

export interface AppTheme {
  id: string;
  label: string;
  dark: boolean;
  colors: ThemeColors;
  /** Styled in globals.css rather than blended from `colors`. */
  handTuned?: boolean;
  group: "Classic" | "Colorful" | "Retro";
}

export const CUSTOM_THEME = "custom";

export const APP_THEMES: AppTheme[] = [
  // Classic, hand tuned in globals.css.
  {
    id: "light",
    label: "Light",
    dark: false,
    handTuned: true,
    group: "Classic",
    colors: {
      bg: "#ffffff",
      surface: "#fafafa",
      fg: "#171717",
      accent: "#171717",
    },
  },
  {
    id: "paper",
    label: "Paper",
    dark: false,
    handTuned: true,
    group: "Classic",
    colors: {
      bg: "#f8f3e8",
      surface: "#f1e9d8",
      fg: "#3b2f22",
      accent: "#6b4f2e",
    },
  },
  {
    id: "sky",
    label: "Sky",
    dark: false,
    handTuned: true,
    group: "Classic",
    colors: {
      bg: "#f6f9fd",
      surface: "#edf2f9",
      fg: "#1f2a3d",
      accent: "#2563eb",
    },
  },
  {
    id: "dark",
    label: "Dark",
    dark: true,
    handTuned: true,
    group: "Classic",
    colors: {
      bg: "#0a0a0a",
      surface: "#171717",
      fg: "#fafafa",
      accent: "#e5e5e5",
    },
  },
  {
    id: "dim",
    label: "Dim",
    dark: true,
    handTuned: true,
    group: "Classic",
    colors: {
      bg: "#26282c",
      surface: "#2d3034",
      fg: "#e1e3e6",
      accent: "#d7d9dd",
    },
  },
  {
    id: "nord",
    label: "Nord",
    dark: true,
    handTuned: true,
    group: "Classic",
    colors: {
      bg: "#2e3440",
      surface: "#2a303b",
      fg: "#eceff4",
      accent: "#88c0d0",
    },
  },

  // Colorful.
  {
    id: "solarized",
    label: "Solarized",
    dark: false,
    group: "Colorful",
    colors: {
      bg: "#fdf6e3",
      surface: "#eee8d5",
      fg: "#3b4d56",
      accent: "#268bd2",
    },
  },
  {
    id: "rose",
    label: "Rosé",
    dark: false,
    group: "Colorful",
    colors: {
      bg: "#fff5f7",
      surface: "#fbe7ec",
      fg: "#4a2b35",
      accent: "#d6457a",
    },
  },
  {
    id: "mint",
    label: "Mint",
    dark: false,
    group: "Colorful",
    colors: {
      bg: "#f3fbf6",
      surface: "#e3f4ea",
      fg: "#1f3b2c",
      accent: "#10a36b",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    dark: true,
    group: "Colorful",
    colors: {
      bg: "#002b36",
      surface: "#073642",
      fg: "#b8c4c4",
      accent: "#2aa198",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    dark: true,
    group: "Colorful",
    colors: {
      bg: "#282a36",
      surface: "#21222c",
      fg: "#f8f8f2",
      accent: "#bd93f9",
    },
  },

  // Retro.
  {
    id: "seventies",
    label: "Seventies",
    dark: false,
    group: "Retro",
    colors: {
      bg: "#fbf1e1",
      surface: "#f2dcc0",
      fg: "#4a2c17",
      accent: "#d9622b",
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    dark: true,
    group: "Retro",
    colors: {
      bg: "#282828",
      surface: "#32302f",
      fg: "#ebdbb2",
      accent: "#fe8019",
    },
  },
  {
    id: "synthwave",
    label: "Synthwave",
    dark: true,
    group: "Retro",
    colors: {
      bg: "#241b2f",
      surface: "#1e1628",
      fg: "#f5e9ff",
      accent: "#ff7edb",
    },
  },
  {
    id: "phosphor",
    label: "Phosphor",
    dark: true,
    group: "Retro",
    colors: {
      bg: "#0a120a",
      surface: "#0d180d",
      fg: "#8dff96",
      accent: "#39ff14",
    },
  },
  {
    id: "amber",
    label: "Amber CRT",
    dark: true,
    group: "Retro",
    colors: {
      bg: "#140d02",
      surface: "#1b1205",
      fg: "#ffb000",
      accent: "#ffcc4d",
    },
  },
];

export const THEME_IDS = [...APP_THEMES.map((t) => t.id), CUSTOM_THEME];

export const DEFAULT_CUSTOM_COLORS: ThemeColors = {
  bg: "#fdfaf3",
  surface: "#f1ece0",
  fg: "#2b2a28",
  accent: "#7c5cff",
};

/** Relative luminance (0 black … 1 white) of a #rrggbb color. */
export function luminance(hex: string): number {
  const m = hex
    .replace("#", "")
    .match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 1;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = Number.parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDarkColor = (hex: string) => luminance(hex) < 0.2;

/** Text color that reads on top of `hex`. */
export const readableOn = (hex: string) =>
  luminance(hex) > 0.45 ? "#111111" : "#ffffff";

let customColors: ThemeColors = DEFAULT_CUSTOM_COLORS;

/** The custom theme's colors, as the app last applied them. */
export function setCustomThemeColors(colors: ThemeColors) {
  customColors = colors;
}

/** Whether a next-themes resolved theme is one of the dark ones. */
export function isDarkTheme(resolved: string | undefined): boolean {
  if (resolved === CUSTOM_THEME) return isDarkColor(customColors.bg);
  return APP_THEMES.find((t) => t.id === resolved)?.dark ?? false;
}

/** The four base colors as the CSS variables the blended themes read. */
export function themeVariables(c: ThemeColors): Record<string, string> {
  return {
    "--t-bg": c.bg,
    "--t-surface": c.surface,
    "--t-fg": c.fg,
    "--t-accent": c.accent,
    "--t-on-accent": readableOn(c.accent),
  };
}

/**
 * CSS for the blended themes: each class sets its four colors, and one rule
 * turns those into every color the UI uses.
 */
export function themeStyles(): string {
  const blended = APP_THEMES.filter((t) => !t.handTuned);
  const classes = [...blended.map((t) => `.${t.id}`), `.${CUSTOM_THEME}`].join(
    ", ",
  );
  const perTheme = blended
    .map((t) => {
      const vars = Object.entries(themeVariables(t.colors))
        .map(([k, v]) => `${k}: ${v};`)
        .join(" ");
      return `.${t.id} { ${vars} }`;
    })
    .join("\n");
  const mix = (a: string, pa: number, b: string) =>
    `color-mix(in oklab, var(${a}) ${pa}%, var(${b}))`;
  return `${perTheme}
${classes} {
  --background: var(--t-bg);
  --foreground: var(--t-fg);
  --card: ${mix("--t-bg", 94, "--t-fg")};
  --card-foreground: var(--t-fg);
  --popover: ${mix("--t-bg", 95, "--t-fg")};
  --popover-foreground: var(--t-fg);
  --primary: var(--t-accent);
  --primary-foreground: var(--t-on-accent);
  --secondary: ${mix("--t-bg", 90, "--t-fg")};
  --secondary-foreground: var(--t-fg);
  --muted: ${mix("--t-bg", 91, "--t-fg")};
  --muted-foreground: ${mix("--t-fg", 64, "--t-bg")};
  --accent: ${mix("--t-bg", 82, "--t-accent")};
  --accent-foreground: var(--t-fg);
  --border: ${mix("--t-bg", 84, "--t-fg")};
  --input: ${mix("--t-bg", 80, "--t-fg")};
  --ring: ${mix("--t-accent", 70, "--t-bg")};
  --sidebar: var(--t-surface);
  --sidebar-foreground: var(--t-fg);
  --sidebar-primary: var(--t-accent);
  --sidebar-primary-foreground: var(--t-on-accent);
  --sidebar-accent: ${mix("--t-surface", 84, "--t-accent")};
  --sidebar-accent-foreground: var(--t-fg);
  --sidebar-border: ${mix("--t-surface", 84, "--t-fg")};
  --sidebar-ring: ${mix("--t-accent", 70, "--t-bg")};
}`;
}
