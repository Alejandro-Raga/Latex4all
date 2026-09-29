/**
 * Ways to show a PDF page: plain, gentler on the eyes, or dark. Each is a CSS
 * filter over the rendered page; the dark ones invert it, so highlight
 * overlays get the inverse filter to keep their true colours.
 */
export type PdfTheme =
  | "light"
  | "soft"
  | "sepia"
  | "dim"
  | "warm-dark"
  | "dark";

export interface PdfThemeInfo {
  id: PdfTheme;
  label: string;
  /** Filter on the pages, or undefined for none. */
  filter?: string;
  /** Filter that puts overlays (highlights, notes) back to their colours. */
  overlayFilter?: string;
  /** Roughly how a page looks, for the picker: background and text. */
  paper: string;
  ink: string;
  dark: boolean;
}

const UNINVERT = "invert(1) hue-rotate(180deg)";

export const PDF_THEMES: PdfThemeInfo[] = [
  {
    id: "light",
    label: "Light",
    paper: "#ffffff",
    ink: "#111111",
    dark: false,
  },
  {
    id: "soft",
    label: "Soft",
    filter: "brightness(0.96) contrast(0.94) sepia(0.08)",
    paper: "#efece6",
    ink: "#1c1b19",
    dark: false,
  },
  {
    id: "sepia",
    label: "Sepia",
    filter: "sepia(0.55) brightness(0.94) contrast(0.92)",
    paper: "#ece2cd",
    ink: "#3f3222",
    dark: false,
  },
  {
    id: "dim",
    label: "Dim",
    filter: "invert(0.86) hue-rotate(180deg) contrast(0.9)",
    overlayFilter: UNINVERT,
    paper: "#2d2d2d",
    ink: "#d2d2d2",
    dark: true,
  },
  {
    id: "warm-dark",
    label: "Warm dark",
    filter: "invert(0.88) hue-rotate(180deg) sepia(0.3) contrast(0.9)",
    overlayFilter: UNINVERT,
    paper: "#2e2a24",
    ink: "#dcd2c0",
    dark: true,
  },
  {
    id: "dark",
    label: "Dark",
    filter: UNINVERT,
    overlayFilter: UNINVERT,
    paper: "#000000",
    ink: "#ffffff",
    dark: true,
  },
];

export function pdfTheme(id: PdfTheme | undefined): PdfThemeInfo {
  return PDF_THEMES.find((t) => t.id === id) ?? PDF_THEMES[0];
}

export function isPdfTheme(value: unknown): value is PdfTheme {
  return PDF_THEMES.some((t) => t.id === value);
}
