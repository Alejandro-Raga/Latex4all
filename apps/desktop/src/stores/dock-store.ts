import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAnnotationsStore } from "./annotations-store";
import { usePreviewStore } from "./preview-store";
import { useReadingStore } from "./reading-store";

/** Panels that live in the right-hand dock, top to bottom. */
export const DOCK_PANELS = ["reference", "vault", "notes"] as const;
export type DockPanel = (typeof DOCK_PANELS)[number];

interface DockState {
  /** Reference and Vault; Notes/Chat opens through the annotations store. */
  open: Record<Exclude<DockPanel, "notes">, boolean>;
  /** Folded down to their header. */
  collapsed: Record<DockPanel, boolean>;
  /** The panel widened into the big pane beside the editor, if any. */
  wide: DockPanel | null;
  setWide: (panel: DockPanel | null) => void;
  setOpen: (panel: DockPanel, open: boolean) => void;
  toggle: (panel: DockPanel) => void;
  setCollapsed: (panel: DockPanel, collapsed: boolean) => void;
}

/**
 * What the right-hand dock shows. The panels stack in one column so opening
 * another never narrows the editor or the PDF.
 */
export const useDockStore = create<DockState>()(
  persist(
    (set, get) => ({
      open: { reference: false, vault: false },
      collapsed: { reference: false, vault: false, notes: false },
      wide: null,
      setWide: (panel) => {
        const reading = useReadingStore.getState();
        if (panel) {
          // It opens as a tab in the PDF pane, brought to the front.
          usePreviewStore.getState().setVisible(true);
          reading.activate("wide");
        } else if (reading.active === "wide") {
          reading.activate("preview");
        }
        set({ wide: panel });
      },
      setOpen: (panel, open) => {
        if (!open && get().wide === panel) get().setWide(null);
        if (panel === "notes") {
          useAnnotationsStore.getState().setPanelOpen(open);
        } else {
          set((s) => ({ open: { ...s.open, [panel]: open } }));
        }
        if (open) get().setCollapsed(panel, false);
      },
      toggle: (panel) => get().setOpen(panel, !isDockPanelOpen(panel)),
      setCollapsed: (panel, collapsed) =>
        set((s) => ({ collapsed: { ...s.collapsed, [panel]: collapsed } })),
    }),
    {
      name: "latex4all-dock",
      partialize: (s) => ({ open: s.open, collapsed: s.collapsed }),
    },
  ),
);

export function isDockPanelOpen(panel: DockPanel): boolean {
  return panel === "notes"
    ? useAnnotationsStore.getState().panelOpen
    : useDockStore.getState().open[panel];
}

/** The dock panels currently open, in dock order (including a widened one). */
export function useOpenDockPanels(): DockPanel[] {
  const open = useDockStore((s) => s.open);
  const notes = useAnnotationsStore((s) => s.panelOpen);
  return DOCK_PANELS.filter((p) => (p === "notes" ? notes : open[p]));
}

/** The open panels that sit in the dock column, leaving out a widened one. */
export function useDockedPanels(): DockPanel[] {
  const open = useOpenDockPanels();
  const wide = useDockStore((s) => s.wide);
  return open.filter((p) => p !== wide);
}
