import { type CSSProperties, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeftRightIcon,
  ArrowUpDownIcon,
  Columns2Icon,
  LibraryIcon,
  NotebookTextIcon,
  Rows2Icon,
} from "lucide-react";
import { PanelBoundary } from "@/components/panel-boundary";
import { QuickReferencePanel } from "@/components/workspace/quick-reference-panel";
import { VaultPanel } from "@/components/workspace/vault-panel";
import { VaultStandalone } from "@/components/workspace/vault-standalone";
import { cn } from "@/lib/utils";
import { useLibraryPreview } from "@/components/zotero-pdf-dialog";
import { confirmLeaveVaultEdit, useVaultStore } from "@/stores/vault-store";

type Side = "reference" | "vault";

interface Layout {
  reference: boolean;
  vault: boolean;
  /** The vault first (left or top), the Zotero library second. */
  swapped: boolean;
  /** One above the other instead of side by side. */
  stacked: boolean;
}

const LAYOUT_KEY = "library-view-layout";
const DEFAULT_LAYOUT: Layout = {
  reference: true,
  vault: true,
  swapped: false,
  stacked: false,
};

function loadLayout(): Layout {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
    if (stored && (stored.reference || stored.vault)) {
      return { ...DEFAULT_LAYOUT, ...stored };
    }
  } catch {
    // Unreadable: the default.
  }
  return DEFAULT_LAYOUT;
}

/**
 * The Zotero library and the vault side by side, with no project open:
 * reading, sorting papers into topics and ideas, writing notes. The bar on
 * top shows or hides each side and swaps them; at least one stays open.
 */
export function LibraryView() {
  const [layout, setLayoutState] = useState(loadLayout);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // Kept for this session.
    }
  };
  // A note opened from elsewhere (a pill in the Zotero library): the vault
  // shows, if it was hidden, so it can be read.
  useEffect(
    () =>
      useVaultStore.subscribe((s, prev) => {
        if (!s.current || s.current === prev.current) return;
        setLayoutState((l) => {
          if (l.vault) return l;
          const next = { ...l, vault: true };
          try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
          } catch {
            // Kept for this session.
          }
          return next;
        });
      }),
    [],
  );
  // A paper asked to open: the Zotero library side shows to open it.
  useEffect(() => {
    const show = (asked: boolean) => {
      if (!asked) return;
      setLayoutState((l) => (l.reference ? l : { ...l, reference: true }));
    };
    show(!!useLibraryPreview.getState().request);
    return useLibraryPreview.subscribe((st) => show(!!st.request));
  }, []);
  const toggle = (side: Side) => {
    const other = side === "reference" ? "vault" : "reference";
    if (layout[side] && !layout[other]) return;
    if (side === "vault" && layout.vault && !confirmLeaveVaultEdit()) return;
    setLayout({ ...layout, [side]: !layout[side] });
  };
  const both = layout.reference && layout.vault;

  const reference = layout.reference && (
    <Panel
      key="reference"
      id="reference"
      order={layout.swapped ? 2 : 1}
      minSize={25}
      className="min-h-0 min-w-0"
    >
      <PanelBoundary name="Library">
        <QuickReferencePanel
          onClose={() => toggle("reference")}
          closeOnEscape={false}
        />
      </PanelBoundary>
    </Panel>
  );
  const vault = layout.vault && (
    <Panel
      key="vault"
      id="vault"
      order={layout.swapped ? 1 : 2}
      minSize={25}
      className="min-h-0 min-w-0"
    >
      <PanelBoundary name="Vault">
        <VaultStandalone.Provider value>
          <VaultPanel onClose={() => toggle("vault")} />
        </VaultStandalone.Provider>
      </PanelBoundary>
    </Panel>
  );
  const handle = both && (
    <PanelResizeHandle
      key="handle"
      className={cn(
        "bg-border transition-colors hover:bg-ring",
        layout.stacked ? "h-px" : "w-px",
      )}
    />
  );
  const Swap = layout.stacked ? ArrowUpDownIcon : ArrowLeftRightIcon;
  const Arrange = layout.stacked ? Columns2Icon : Rows2Icon;
  const arrangeLabel = layout.stacked ? "Side by side" : "One above the other";

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      {/* Below the window's drag strip, which takes clicks at the very top. */}
      <div className="flex h-[calc(32px+var(--titlebar-height))] shrink-0 items-center gap-1 border-b px-2 pt-[var(--titlebar-height)]">
        <PaneToggle
          on={layout.reference}
          onClick={() => toggle("reference")}
          icon={LibraryIcon}
          label="Zotero library"
        />
        <PaneToggle
          on={layout.vault}
          onClick={() => toggle("vault")}
          icon={NotebookTextIcon}
          label="Vault"
        />
        {both && (
          <>
            <button
              type="button"
              onClick={() => setLayout({ ...layout, swapped: !layout.swapped })}
              className="ml-1 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Swap sides"
              aria-label="Swap sides"
            >
              <Swap className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setLayout({ ...layout, stacked: !layout.stacked })}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title={arrangeLabel}
              aria-label={arrangeLabel}
            >
              <Arrange className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <PanelGroup
        key={layout.stacked ? "stacked" : "side"}
        direction={layout.stacked ? "vertical" : "horizontal"}
        autoSaveId={
          both
            ? `library-view${layout.stacked ? "-stacked" : ""}${layout.swapped ? "-swapped" : ""}`
            : undefined
        }
        className="min-h-0 flex-1"
        // The bar sits under the drag strip, so the panes' headers needn't.
        style={{ "--titlebar-height": "0px" } as CSSProperties}
      >
        {layout.swapped
          ? [vault, handle, reference]
          : [reference, handle, vault]}
      </PanelGroup>
    </div>
  );
}

function PaneToggle({
  on,
  onClick,
  icon: Icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: typeof LibraryIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors",
        on
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
