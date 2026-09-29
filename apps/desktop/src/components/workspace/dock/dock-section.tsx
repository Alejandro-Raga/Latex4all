import { createContext, type ReactNode, useContext } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DockSection {
  /** The topmost section, which sits under the window's title bar. */
  first: boolean;
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const DockSectionContext = createContext<DockSection | null>(null);

export const DockSectionProvider = DockSectionContext.Provider;

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
        "flex shrink-0 items-center gap-1.5 border-border border-b px-2",
        underTitleBar
          ? "h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] pt-[var(--titlebar-height)]"
          : "h-[var(--workspace-topbar-height)] bg-muted/30",
        className,
      )}
    >
      {section && (
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
