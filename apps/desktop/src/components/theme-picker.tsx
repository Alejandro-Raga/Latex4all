import { CheckIcon, MonitorIcon, PaletteIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_THEMES, type AppTheme } from "@/lib/app-themes";
import { cn } from "@/lib/utils";

function Swatch({ theme, className }: { theme: AppTheme; className?: string }) {
  const [bg, surface, accent] = theme.swatch;
  return (
    <span
      className={cn(
        "flex shrink-0 overflow-hidden rounded border border-black/10",
        className,
      )}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      <span className="h-full w-1/3" style={{ backgroundColor: surface }} />
      <span
        className="m-auto size-1.5 rounded-full"
        style={{ backgroundColor: accent }}
      />
    </span>
  );
}

/** A small button opening the list of color themes. */
export function ThemeMenuButton() {
  const { theme = "system", setTheme } = useTheme();
  const current = APP_THEMES.find((t) => t.id === theme);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={`Theme: ${current?.label ?? "System"}`}
          aria-label="Color theme"
        >
          <PaletteIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-44">
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <MonitorIcon className="size-4" />
          <span className="flex-1">System</span>
          {theme === "system" && <CheckIcon className="size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {APP_THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)}>
            <Swatch theme={t} className="h-4 w-5" />
            <span className="flex-1">{t.label}</span>
            {theme === t.id && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The themes as large swatches, for Settings. */
export function ThemeGrid() {
  const { theme = "system", setTheme } = useTheme();
  const option = (active: boolean) =>
    cn(
      "flex flex-col gap-1.5 rounded-lg border p-2 text-left text-xs transition-colors",
      active
        ? "border-primary ring-1 ring-primary"
        : "border-border hover:bg-muted/60",
    );
  return (
    <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
      <button
        type="button"
        onClick={() => setTheme("system")}
        className={option(theme === "system")}
        aria-pressed={theme === "system"}
      >
        <span className="flex h-12 overflow-hidden rounded border border-black/10">
          <span className="flex-1 bg-white" />
          <span className="flex-1 bg-neutral-900" />
        </span>
        System
      </button>
      {APP_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTheme(t.id)}
          className={option(theme === t.id)}
          aria-pressed={theme === t.id}
        >
          <Swatch theme={t} className="h-12 w-full" />
          {t.label}
        </button>
      ))}
    </div>
  );
}
