import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import {
  LibraryIcon,
  type LucideIcon,
  MessageSquareIcon,
  NotebookTextIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnnotationsStore } from "@/stores/annotations-store";
import { useChatStore } from "@/stores/chat-store";
import {
  DOCK_PANELS,
  type DockPanel,
  useDockedPanels,
  useDockStore,
  useOpenDockPanels,
} from "@/stores/dock-store";
import { confirmLeaveVaultEdit } from "@/stores/vault-store";
import { ChatPanel } from "../chat-panel";
import { NotesPanel } from "../notes-panel";
import { QuickReferencePanel } from "../quick-reference-panel";
import { VaultPanel } from "../vault-panel";
import { DockSectionProvider } from "./dock-section";

/** Header heights, so a collapsed section keeps exactly its header. */
const FIRST_HEADER_PX = 70; // title bar + top bar
const HEADER_PX = 40;
const MIN_BODY_PX = 90;

const DOCK_INFO: Record<DockPanel, { label: string; icon: LucideIcon }> = {
  reference: { label: "Reference", icon: LibraryIcon },
  vault: { label: "Vault", icon: NotebookTextIcon },
  notes: { label: "Notes", icon: MessageSquareIcon },
};

/** Closing a panel may need a word first (e.g. a note being edited). */
function closeDockPanel(panel: DockPanel) {
  if (panel === "vault" && !confirmLeaveVaultEdit()) return;
  useDockStore.getState().setOpen(panel, false);
}

function DockPanelContent({ panel }: { panel: DockPanel }) {
  const panelTab = useAnnotationsStore((s) => s.panelTab);
  const chatDays = useChatStore((s) => s.days);
  const onClose = () => closeDockPanel(panel);
  if (panel === "reference") return <QuickReferencePanel onClose={onClose} />;
  if (panel === "vault") return <VaultPanel onClose={onClose} />;
  return panelTab === "chat" && chatDays > 0 ? (
    <ChatPanel onClose={onClose} />
  ) : (
    <NotesPanel onClose={onClose} />
  );
}

/**
 * The right-hand column: Reference, Vault and Notes stacked, each resizable,
 * foldable to its header, and closable, so the editor keeps its width.
 */
export function RightDock() {
  const panels = useDockedPanels();
  const setWide = useDockStore((s) => s.setWide);
  const collapsed = useDockStore((s) => s.collapsed);
  const setCollapsed = useDockStore((s) => s.setCollapsed);
  const containerRef = useRef<HTMLDivElement>(null);
  const handles = useRef<Partial<Record<DockPanel, ImperativePanelHandle>>>({});
  const [height, setHeight] = useState(800);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setHeight(el.clientHeight || 800),
    );
    observer.observe(el);
    setHeight(el.clientHeight || 800);
    return () => observer.disconnect();
  }, []);

  // Keep the panels folded or open as the store says (it outlives them).
  useEffect(() => {
    for (const panel of panels) {
      const handle = handles.current[panel];
      if (!handle) continue;
      if (collapsed[panel] && !handle.isCollapsed()) handle.collapse();
      if (!collapsed[panel] && handle.isCollapsed()) handle.expand();
    }
  }, [panels, collapsed]);

  const pct = (px: number) => Math.min(95, (px / height) * 100);

  return (
    <div ref={containerRef} className="h-full min-w-0 bg-background">
      <PanelGroup
        direction="vertical"
        autoSaveId={`dock:${panels.join("+")}`}
        className="h-full"
      >
        {panels.map((panel, i) => {
          const header = i === 0 ? FIRST_HEADER_PX : HEADER_PX;
          return (
            <Fragment key={panel}>
              {i > 0 && (
                <PanelResizeHandle className="h-px bg-border transition-colors hover:bg-ring" />
              )}
              <Panel
                id={panel}
                order={DOCK_PANELS.indexOf(panel)}
                ref={(handle) => {
                  handles.current[panel] = handle ?? undefined;
                }}
                collapsible
                collapsedSize={pct(header)}
                minSize={pct(header + MIN_BODY_PX)}
                defaultSize={100 / panels.length}
                onCollapse={() => setCollapsed(panel, true)}
                onExpand={() => setCollapsed(panel, false)}
                className="min-h-0 overflow-hidden"
              >
                <DockSectionProvider
                  value={{
                    first: i === 0,
                    collapsed: collapsed[panel],
                    toggleCollapsed: () =>
                      setCollapsed(panel, !collapsed[panel]),
                    wide: false,
                    toggleWide: () => setWide(panel),
                  }}
                >
                  <DockPanelContent panel={panel} />
                </DockSectionProvider>
              </Panel>
            </Fragment>
          );
        })}
      </PanelGroup>
    </div>
  );
}

/** A dock panel widened into the big pane beside the editor. */
export function WideDockPanel() {
  const wide = useDockStore((s) => s.wide);
  const setWide = useDockStore((s) => s.setWide);
  if (!wide) return null;
  return (
    <div className="h-full min-w-0 bg-background">
      <DockSectionProvider
        value={{
          first: true,
          collapsed: false,
          toggleCollapsed: () => {},
          wide: true,
          toggleWide: () => setWide(null),
        }}
      >
        <DockPanelContent panel={wide} />
      </DockSectionProvider>
    </div>
  );
}

/** Icons down the right edge that open and close the dock's panels. */
export function DockRail() {
  const openPanels = useOpenDockPanels();
  const toggle = useDockStore((s) => s.toggle);
  const unread = useChatStore((s) => s.unread);

  return (
    <nav
      aria-label="Side panels"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-border border-l bg-background pt-[calc(var(--titlebar-height)+6px)]"
    >
      {DOCK_PANELS.map((panel) => {
        const { label, icon: Icon } = DOCK_INFO[panel];
        const active = openPanels.includes(panel);
        return (
          <button
            key={panel}
            type="button"
            onClick={() => (active ? closeDockPanel(panel) : toggle(panel))}
            title={active ? `Hide ${label}` : `Show ${label}`}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "relative flex size-8 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {panel === "notes" && unread > 0 && (
              <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
