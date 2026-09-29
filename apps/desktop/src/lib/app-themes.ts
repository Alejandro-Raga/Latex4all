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

/**
 * The rest of a theme's colors: a second accent for highlights, and the
 * editor's syntax colors.
 */
export interface ThemePalette {
  accent2: string;
  /** \commands, \begin and \end. */
  command: string;
  /** Environment names, labels, links. */
  env: string;
  /** Literal arguments, verbatim, code. */
  string: string;
  /** Math. */
  math: string;
  number: string;
  comment: string;
  /** \section and friends. */
  heading: string;
}

export interface AppTheme {
  id: string;
  label: string;
  dark: boolean;
  colors: ThemeColors;
  palette: ThemePalette;
  /** Colored bands along the top of the window, like a badge on a case. */
  stripes?: string[];
  /** Styled in globals.css rather than blended from `colors`. */
  handTuned?: boolean;
  group: "Classic" | "Colorful" | "Retro";
}

export const CUSTOM_THEME = "custom";

type Def = [
  id: string,
  label: string,
  group: AppTheme["group"],
  colors: [bg: string, surface: string, fg: string, accent: string],
  palette: [
    accent2: string,
    command: string,
    env: string,
    string: string,
    math: string,
    number: string,
    comment: string,
    heading: string,
  ],
  extra?: Partial<AppTheme>,
];

const HAND_TUNED = new Set(["light", "paper", "sky", "dark", "dim", "nord"]);

// biome-ignore format: one theme per row reads as a table.
const DEFS: Def[] = [
  // Classic, hand tuned in globals.css.
  ["light", "Light", "Classic", ["#ffffff", "#fafafa", "#171717", "#171717"],
    ["#2563eb", "#0550ae", "#8250df", "#0a6e62", "#116329", "#953800", "#6e7781", "#b3261e"]],
  ["paper", "Paper", "Classic", ["#f8f3e8", "#f1e9d8", "#3b2f22", "#6b4f2e"],
    ["#a4572a", "#8f4a1c", "#5b6b2e", "#2f6f6a", "#7a3e6b", "#a8551e", "#9c8b73", "#6b3a1a"]],
  ["sky", "Sky", "Classic", ["#f6f9fd", "#edf2f9", "#1f2a3d", "#2563eb"],
    ["#0ea5e9", "#1d4ed8", "#7c3aed", "#0f766e", "#be185d", "#c2410c", "#7d8aa0", "#1e3a8a"]],
  ["dark", "Dark", "Classic", ["#0a0a0a", "#171717", "#fafafa", "#e5e5e5"],
    ["#60a5fa", "#79c0ff", "#d2a8ff", "#a5d6ff", "#7ee787", "#f2cc60", "#8b949e", "#ffa657"]],
  ["dim", "Dim", "Classic", ["#26282c", "#2d3034", "#e1e3e6", "#d7d9dd"],
    ["#8ab4f8", "#8ab4f8", "#c3a6f5", "#9fd3c7", "#a8d68a", "#f0b37e", "#7d8590", "#e8c07d"]],
  ["nord", "Nord", "Classic", ["#2e3440", "#2a303b", "#eceff4", "#88c0d0"],
    ["#b48ead", "#81a1c1", "#88c0d0", "#a3be8c", "#b48ead", "#d08770", "#6f7b94", "#ebcb8b"]],

  // Colorful.
  ["solarized", "Solarized", "Colorful", ["#fdf6e3", "#eee8d5", "#3b4d56", "#268bd2"],
    ["#d33682", "#268bd2", "#6c7c00", "#1f857d", "#d33682", "#cb4b16", "#93a1a1", "#957100"]],
  ["rose", "Rosé", "Colorful", ["#fff5f7", "#fbe1e9", "#4a2b35", "#d6457a"],
    ["#7c4dff", "#c2185b", "#7c4dff", "#0e8a7a", "#c85a12", "#b8336a", "#b3959d", "#9c2a5c"]],
  ["mint", "Mint", "Colorful", ["#f1fbf5", "#d9f1e3", "#1f3b2c", "#0f9d6a"],
    ["#f0604d", "#0b7d55", "#2563a8", "#b45309", "#d9485f", "#7c3aed", "#86a393", "#0b6e4f"]],
  ["solarized-dark", "Solarized Dark", "Colorful", ["#002b36", "#073642", "#b8c4c4", "#2aa198"],
    ["#d33682", "#268bd2", "#859900", "#2aa198", "#d33682", "#cb4b16", "#5d7a82", "#b58900"]],
  ["dracula", "Dracula", "Colorful", ["#282a36", "#21222c", "#f8f8f2", "#bd93f9"],
    ["#ff79c6", "#ff79c6", "#8be9fd", "#f1fa8c", "#50fa7b", "#bd93f9", "#6272a4", "#ffb86c"]],

  // Retro: the colors of old machines, logos and posters, used sparingly.
  ["seventies", "Seventies", "Retro", ["#fbf0dc", "#f1d9b5", "#4a2c17", "#d9622b"],
    ["#2f7a6e", "#c4501d", "#6f7f1f", "#1f7a72", "#b07317", "#a33a2b", "#a88b6a", "#8a3b12"],
    { stripes: ["#e8a33d", "#d9622b", "#a33a2b", "#5a3419"] }],
  ["park", "Park", "Retro", ["#f7ecd8", "#ecdcbc", "#23302a", "#266a57"],
    ["#cd5733", "#266a57", "#376597", "#9b593f", "#cd5733", "#802729", "#999275", "#1f304a"],
    { stripes: ["#266a57", "#8cbeb1", "#e8c533", "#cd5733"] }],
  ["beige", "Beige", "Retro", ["#f4efe2", "#e7dfca", "#2d2a26", "#009ddc"],
    ["#f5821f", "#0a82b8", "#963d97", "#3f8f2a", "#e03a3e", "#b85f10", "#a39c8a", "#963d97"],
    { stripes: ["#61bb46", "#fdb827", "#f5821f", "#e03a3e", "#963d97", "#009ddc"] }],
  ["spectrum", "Spectrum", "Retro", ["#141414", "#0c0c0c", "#e6e6e6", "#00aeef"],
    ["#f7d117", "#00aeef", "#4cb748", "#f7d117", "#ff5ad0", "#ff6b5e", "#7a7a7a", "#ed1c24"],
    { stripes: ["#ed1c24", "#f7d117", "#4cb748", "#00aeef"] }],
  ["arcade", "Arcade", "Retro", ["#1b1613", "#261d17", "#efe6d8", "#e4202e"],
    ["#e08a3c", "#ff5a4e", "#f0a24a", "#e8c872", "#9cc3d5", "#f07b3f", "#8a7a6a", "#ff7a6e"],
    { stripes: ["#e4202e", "#e08a3c", "#8a5a36"] }],
  ["gruvbox", "Gruvbox", "Retro", ["#282828", "#1d2021", "#ebdbb2", "#fe8019"],
    ["#b8bb26", "#fb4934", "#fabd2f", "#b8bb26", "#83a598", "#d3869b", "#928374", "#8ec07c"]],
  ["synthwave", "Synthwave", "Retro", ["#262335", "#1e1a2b", "#f5e9ff", "#ff7edb"],
    ["#36f9f6", "#fede5d", "#36f9f6", "#ff8b39", "#72f1b8", "#f97e72", "#848bbd", "#ff7edb"],
    { stripes: ["#fede5d", "#ff8b39", "#ff7edb", "#36f9f6"] }],
  ["phosphor", "Phosphor", "Retro", ["#07130a", "#0b1c0f", "#9dffa3", "#39ff14"],
    ["#c8ff5a", "#39ff14", "#c8ff5a", "#6fe8d8", "#e9ff8a", "#ffd166", "#3f7a47", "#d6ffd9"]],
  ["amber", "Amber CRT", "Retro", ["#140d02", "#1e1406", "#ffb000", "#ffcc4d"],
    ["#ff6a3d", "#ffd873", "#ff8c42", "#ffe8b0", "#ff6a3d", "#fff27a", "#8a5d14", "#ffe066"]],
];

export const APP_THEMES: AppTheme[] = DEFS.map(
  ([id, label, group, [bg, surface, fg, accent], p, extra]) => ({
    id,
    label,
    group,
    dark: isDarkColor(bg),
    colors: { bg, surface, fg, accent },
    palette: {
      accent2: p[0],
      command: p[1],
      env: p[2],
      string: p[3],
      math: p[4],
      number: p[5],
      comment: p[6],
      heading: p[7],
    },
    ...(HAND_TUNED.has(id) ? { handTuned: true } : {}),
    ...extra,
  }),
);

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

export function isDarkColor(hex: string) {
  return luminance(hex) < 0.2;
}

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

const SYNTAX_KEYS = [
  "command",
  "env",
  "string",
  "math",
  "number",
  "comment",
  "heading",
] as const;

function paletteVariables(p: ThemePalette): string {
  return [
    `--t-accent2: ${p.accent2};`,
    ...SYNTAX_KEYS.map((k) => `--syn-${k}: ${p[k]};`),
  ].join(" ");
}

function stripesRule(t: AppTheme): string {
  if (!t.stripes) return "";
  const n = t.stripes.length;
  const bands = t.stripes
    .map((c, i) => `${c} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`)
    .join(", ");
  return `html.${t.id} body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 3px; z-index: 100; pointer-events: none; background: linear-gradient(90deg, ${bands}); }`;
}

/**
 * CSS for the themes: every theme's palette and stripes, each blended theme's
 * four colors, and one rule turning those four into every color the UI uses.
 * A custom theme's palette is turned from its accent around the color wheel.
 */
export function themeStyles(): string {
  const blended = APP_THEMES.filter((t) => !t.handTuned);
  const classes = [...blended.map((t) => `.${t.id}`), `.${CUSTOM_THEME}`].join(
    ", ",
  );
  const light = APP_THEMES[0];
  const perTheme = APP_THEMES.map((t) => {
    const vars = t.handTuned
      ? ""
      : `${Object.entries(themeVariables(t.colors))
          .map(([k, v]) => `${k}: ${v};`)
          .join(" ")} `;
    return `.${t.id} { ${vars}${paletteVariables(t.palette)} }`;
  }).join("\n");
  const stripes = APP_THEMES.map(stripesRule).filter(Boolean).join("\n");
  const mix = (a: string, pa: number, b: string) =>
    `color-mix(in oklab, var(${a}) ${pa}%, var(${b}))`;
  const turn = (deg: number) =>
    `oklch(from var(--t-accent) var(--syn-l) max(c, 0.12) calc(h + ${deg}))`;
  return `:root { ${paletteVariables(light.palette)} --syn-bracket: color-mix(in oklab, var(--foreground) 55%, var(--background)); }
${perTheme}
${stripes}
.${CUSTOM_THEME} {
  --syn-l: 0.5;
  --t-accent2: ${turn(150)};
  --syn-command: ${turn(0)};
  --syn-env: ${turn(70)};
  --syn-string: ${turn(150)};
  --syn-math: ${turn(-70)};
  --syn-number: ${turn(210)};
  --syn-comment: ${mix("--t-fg", 45, "--t-bg")};
  --syn-heading: ${turn(110)};
}
.${CUSTOM_THEME}.theme-dark { --syn-l: 0.8; }
${classes} {
  --background: var(--t-bg);
  --foreground: var(--t-fg);
  --t-tint: ${mix("--t-fg", 70, "--t-accent")};
  --card: ${mix("--t-bg", 94, "--t-tint")};
  --card-foreground: var(--t-fg);
  --popover: ${mix("--t-bg", 95, "--t-tint")};
  --popover-foreground: var(--t-fg);
  --primary: var(--t-accent);
  --primary-foreground: var(--t-on-accent);
  --secondary: ${mix("--t-bg", 90, "--t-tint")};
  --secondary-foreground: var(--t-fg);
  --muted: ${mix("--t-bg", 91, "--t-tint")};
  --muted-foreground: ${mix("--t-fg", 64, "--t-bg")};
  --accent: ${mix("--t-bg", 82, "--t-accent")};
  --accent-foreground: var(--t-fg);
  --border: ${mix("--t-bg", 82, "--t-tint")};
  --input: ${mix("--t-bg", 78, "--t-tint")};
  --ring: ${mix("--t-accent2", 70, "--t-bg")};
  --chart-1: var(--t-accent);
  --chart-2: var(--t-accent2);
  --chart-3: var(--syn-env);
  --chart-4: var(--syn-string);
  --chart-5: var(--syn-math);
  --sidebar: var(--t-surface);
  --sidebar-foreground: var(--t-fg);
  --sidebar-primary: var(--t-accent);
  --sidebar-primary-foreground: var(--t-on-accent);
  --sidebar-accent: ${mix("--t-surface", 82, "--t-accent")};
  --sidebar-accent-foreground: var(--t-fg);
  --sidebar-border: ${mix("--t-surface", 82, "--t-tint")};
  --sidebar-ring: ${mix("--t-accent2", 70, "--t-bg")};
}`;
}
