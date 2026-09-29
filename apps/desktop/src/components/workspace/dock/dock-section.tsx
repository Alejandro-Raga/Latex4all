import { createContext, type ReactNode, useContext } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DockSection {
  /** The topmost section, which sits under the window's title bar. */
  first: boolean;
  collapsed: boolean;
  /** Folding needs another section to take the room; a lone one can't. */
  canCollapse: boolean;
  toggleCollapsed: () => void;
  /** Shown widened in the big pane rather than in the dock column. */
  wide: boolean;
  toggleWide: () => void;
}

const DockSectionContext = createContext<DockSection | null>(null);

export const DockSectionProvider = DockSectionContext.Provider;

/** Where the panel is shown: in the dock, widened, or elsewhere (null). */
export const useDockSection = () => useContext(DockSectionContext);

/**
 * The header row of a panel. In the dock it gets a fold arrow and, below the
 * first section, drops the title-bar padding; elsewhere it is a plain header.
 */
export function DockHeaderBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const section = useContext(DockSectionContext);
  const underTitleBar = section?.first ?? true;
  return (
    <div
      className={cn(
        "pane-header flex shrink-0 items-center gap-1.5 border-b px-2",
        underTitleBar
          ? "h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] pt-[var(--titlebar-height)]"
          : "h-[var(--workspace-topbar-height)]",
        className,
      )}
    >
      {section?.canCollapse && (
        <button
          type="button"
          onClick={section.toggleCollapsed}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={section.collapsed ? "Expand" : "Collapse"}
          aria-label={section.collapsed ? "Expand" : "Collapse"}
          aria-expanded={!section.collapsed}
        >
          {section.collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </button>
      )}
      {children}
    </div>
  );
}

/** Widens a dock panel into the big pane, or puts it back. */
export function DockWideButton() {
  const section = useContext(DockSectionContext);
  if (!section) return null;
  const Icon = section.wide ? Minimize2Icon : Maximize2Icon;
  const label = section.wide ? "Back to the side" : "Widen";
  return (
    <button
      type="button"
      onClick={section.toggleWide}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={label}
      aria-label={label}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
