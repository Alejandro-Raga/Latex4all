import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAnnotationsStore } from "./annotations-store";

/** Panels that live in the right-hand dock, top to bottom. */
export const DOCK_PANELS = ["reference", "vault", "notes"] as const;
export type DockPanel = (typeof DOCK_PANELS)[number];

interface DockState {
  /** Reference and Vault; Notes/Chat opens through the annotations store. */
  open: Record<Exclude<DockPanel, "notes">, boolean>;
  /** Folded down to their header. */
  collapsed: Record<DockPanel, boolean>;
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
      setOpen: (panel, open) => {
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

/** The dock panels currently open, in dock order. */
export function useOpenDockPanels(): DockPanel[] {
  const open = useDockStore((s) => s.open);
  const notes = useAnnotationsStore((s) => s.panelOpen);
  return DOCK_PANELS.filter((p) => (p === "notes" ? notes : open[p]));
}
