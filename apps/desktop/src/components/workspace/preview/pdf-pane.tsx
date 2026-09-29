import type { CSSProperties } from "react";
import {
  BookOpenIcon,
  FileTextIcon,
  LibraryIcon,
  type LucideIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type DockPanel, useDockStore } from "@/stores/dock-store";
import { useReadingStore } from "@/stores/reading-store";
import { WideDockPanel } from "../dock/right-dock";
import { PaperReader } from "./paper-reader";
import { PdfPreview } from "./pdf-preview";
import { PanelBoundary } from "@/components/panel-boundary";

const WIDE_TAB: Record<DockPanel, { label: string; icon: LucideIcon }> = {
  reference: { label: "Reference", icon: LibraryIcon },
  vault: { label: "Vault", icon: NotebookTextIcon },
  notes: { label: "Notes", icon: MessageSquareIcon },
};

function Tab({
  label,
  icon: Icon,
  active,
  onSelect,
  onClose,
  closeLabel,
  fixed = false,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
  closeLabel?: string;
  /** Keeps its full width while other tabs shrink. */
  fixed?: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex h-8 min-w-0 max-w-56 items-center gap-1.5 rounded-t-md border border-b-0 pr-1 pl-2.5 text-xs transition-colors",
        fixed ? "shrink-0" : "min-w-16 shrink",
        active
          ? "-mb-px border-divider border-t-2 border-t-primary bg-background pb-px text-foreground"
          : "border-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        title={label}
        aria-pressed={active}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="flex size-5 shrink-0 items-center justify-center rounded opacity-60 hover:bg-muted hover:opacity-100"
          title={closeLabel}
          aria-label={closeLabel}
        >
          <XIcon className="size-3" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </div>
  );
}

/**
 * The big pane beside the editor: the compiled document, plus a tab for each
 * paper opened to read and for a widened side panel. Every tab stays mounted,
 * so switching keeps each one's page and zoom.
 */
export function PdfPane() {
  const papers = useReadingStore((s) => s.papers);
  const active = useReadingStore((s) => s.active);
  const activate = useReadingStore((s) => s.activate);
  const closePaper = useReadingStore((s) => s.close);
  const wide = useDockStore((s) => s.wide);
  const setWide = useDockStore((s) => s.setWide);
  const tabbed = papers.length > 0 || wide !== null;
  const shown = (tab: string) => (active === tab ? "h-full" : "hidden");

  return (
    <div className="flex h-full min-w-0 flex-col">
      {tabbed && (
        <div
          role="tablist"
          aria-label="Documents in this pane"
          className="pane-header flex h-[calc(var(--titlebar-height)+34px)] shrink-0 items-end gap-0.5 overflow-x-auto border-b px-2 pt-[var(--titlebar-height)]"
        >
          <Tab
            fixed
            label="Preview"
            icon={FileTextIcon}
            active={active === "preview"}
            onSelect={() => activate("preview")}
          />
          {papers.map((p) => (
            <Tab
              key={p.id}
              label={p.label}
              icon={BookOpenIcon}
              active={active === p.id}
              onSelect={() => activate(p.id)}
              onClose={() => closePaper(p.id)}
              closeLabel={`Close ${p.label}`}
            />
          ))}
          {wide && (
            <Tab
              label={WIDE_TAB[wide].label}
              icon={WIDE_TAB[wide].icon}
              active={active === "wide"}
              onSelect={() => activate("wide")}
              onClose={() => setWide(null)}
              closeLabel="Back to the side"
            />
          )}
        </div>
      )}
      {/* Under the tab bar, the panes' own headers needn't clear the title bar. */}
      <div
        className="min-h-0 flex-1"
        style={
          tabbed ? ({ "--titlebar-height": "0px" } as CSSProperties) : undefined
        }
      >
        <div className={shown("preview")}>
          <PanelBoundary name="PDF preview">
            <PdfPreview />
          </PanelBoundary>
        </div>
        {papers.map((p) => (
          <div key={p.id} className={shown(p.id)}>
            <PanelBoundary name={p.label}>
              <PaperReader paper={p} visible={active === p.id} />
            </PanelBoundary>
          </div>
        ))}
        {wide && (
          <div className={shown("wide")}>
            <WideDockPanel />
          </div>
        )}
      </div>
    </div>
  );
}
