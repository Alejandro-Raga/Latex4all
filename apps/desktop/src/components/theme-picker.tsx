import { CheckIcon, MonitorIcon, PaletteIcon, PipetteIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  APP_THEMES,
  type AppTheme,
  CUSTOM_THEME,
  type ThemeColors,
} from "@/lib/app-themes";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

const GROUPS: AppTheme["group"][] = ["Classic", "Colorful", "Retro"];

/** A little picture of a theme: its sidebar, page, text and accent. */
function Swatch({
  colors,
  accents,
  className,
}: {
  colors: ThemeColors;
  /** A theme's other colors, drawn after its accent. */
  accents?: string[];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 overflow-hidden rounded border border-black/10",
        className,
      )}
      style={{ backgroundColor: colors.bg }}
      aria-hidden="true"
    >
      <span
        className="h-full w-1/3"
        style={{ backgroundColor: colors.surface }}
      />
      <span className="flex flex-1 flex-col justify-center gap-[3px] px-[18%]">
        <span
          className="h-[2px] w-full rounded-full"
          style={{ backgroundColor: colors.fg }}
        />
        <span className="flex h-[2px] w-2/3 gap-[2px]">
          {[colors.accent, ...(accents ?? [])].map((c, i) => (
            <span
              key={i}
              className="h-full flex-1 rounded-full"
              style={{ backgroundColor: c }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

const swatchAccents = (t: AppTheme) =>
  t.stripes ?? [t.palette.accent2, t.palette.env];

/** A small button opening the list of color themes. */
export function ThemeMenuButton() {
  const { theme = "system", setTheme } = useTheme();
  const custom = useSettingsStore((s) => s.customTheme);
  const openSettings = () =>
    import("@/stores/settings-window-store").then(({ useSettingsWindow }) =>
      useSettingsWindow.getState().show("appearance"),
    );
  const current =
    theme === CUSTOM_THEME
      ? "Custom"
      : (APP_THEMES.find((t) => t.id === theme)?.label ?? "System");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={`Theme: ${current}`}
          aria-label="Color theme"
        >
          <PaletteIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="max-h-[70vh] w-48 overflow-y-auto"
      >
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <MonitorIcon className="size-4" />
          <span className="flex-1">System</span>
          {theme === "system" && <CheckIcon className="size-3.5" />}
        </DropdownMenuItem>
        {GROUPS.map((group) => (
          <div key={group}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1 text-muted-foreground text-xs">
              {group}
            </DropdownMenuLabel>
            {APP_THEMES.filter((t) => t.group === group).map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)}>
                <Swatch
                  colors={t.colors}
                  accents={swatchAccents(t)}
                  className="h-4 w-6"
                />
                <span className="flex-1">{t.label}</span>
                {theme === t.id && <CheckIcon className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(CUSTOM_THEME)}>
          <Swatch colors={custom} className="h-4 w-6" />
          <span className="flex-1">Custom</span>
          {theme === CUSTOM_THEME && <CheckIcon className="size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openSettings}>
          <PipetteIcon className="size-4" />
          Edit custom colors…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Sidebar" },
  { key: "fg", label: "Text" },
  { key: "accent", label: "Accent" },
];

/** The custom theme's four colors, applied as they're picked. */
function CustomThemeEditor() {
  const { setTheme } = useTheme();
  const custom = useSettingsStore((s) => s.customTheme);
  const setCustom = useSettingsStore((s) => s.setCustomTheme);
  const change = (colors: ThemeColors) => {
    setCustom(colors);
    setTheme(CUSTOM_THEME);
  };

  return (
    <div className="space-y-3 border-border/60 border-t p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">Custom colors</span>
        <select
          value=""
          onChange={(e) => {
            const from = APP_THEMES.find((t) => t.id === e.target.value);
            if (from) change({ ...from.colors });
          }}
          aria-label="Start from a theme"
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">Start from…</option>
          {APP_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COLOR_FIELDS.map(({ key, label }) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-md border border-border p-2 text-xs"
          >
            <input
              type="color"
              value={custom[key]}
              onChange={(e) => change({ ...custom, [key]: e.target.value })}
              className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label={`${label} color`}
            />
            <span className="min-w-0">
              <span className="block">{label}</span>
              <span className="block font-mono text-[10px] text-muted-foreground uppercase">
                {custom[key]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Every theme as a large swatch, plus the custom one, for Settings. */
export function ThemeGrid() {
  const { theme = "system", setTheme } = useTheme();
  const custom = useSettingsStore((s) => s.customTheme);
  const option = (active: boolean) =>
    cn(
      "flex flex-col gap-1.5 rounded-lg border p-2 text-left text-xs transition-colors",
      active
        ? "border-primary ring-1 ring-primary"
        : "border-border hover:bg-muted/60",
    );

  return (
    <div>
      <div className="space-y-4 p-4">
        {GROUPS.map((group) => (
          <div key={group}>
            <p className="mb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {group}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {group === "Classic" && (
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={option(theme === "system")}
                  aria-pressed={theme === "system"}
                >
                  <span className="flex h-10 overflow-hidden rounded border border-black/10">
                    <span className="flex-1 bg-white" />
                    <span className="flex-1 bg-neutral-900" />
                  </span>
                  System
                </button>
              )}
              {APP_THEMES.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={option(theme === t.id)}
                  aria-pressed={theme === t.id}
                >
                  <Swatch
                    colors={t.colors}
                    accents={swatchAccents(t)}
                    className="h-10 w-full"
                  />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
              {group === "Retro" && (
                <button
                  type="button"
                  onClick={() => setTheme(CUSTOM_THEME)}
                  className={option(theme === CUSTOM_THEME)}
                  aria-pressed={theme === CUSTOM_THEME}
                >
                  <Swatch colors={custom} className="h-10 w-full" />
                  Custom
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <CustomThemeEditor />
    </div>
  );
}
