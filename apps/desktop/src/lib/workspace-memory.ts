/**
 * What a project's workspace looked like — which side panels were open and
 * which PDFs were open in tabs — kept per project so reopening it comes back
 * the same.
 */
import type { DockPanel } from "@/stores/dock-store";
import type { ReadingPaper } from "@/stores/reading-store";

export interface SavedTab {
  id: string;
  label: string;
  zotero?: { itemKey: string; attachmentKey: string };
  filePath?: string;
}

export interface SavedWorkspace {
  dock: { reference: boolean; vault: boolean; notes: boolean };
  collapsed: Record<DockPanel, boolean>;
  wide: DockPanel | null;
  tabs: SavedTab[];
  /** "preview", "wide" or a tab id. */
  active: string;
}

const KEY = (root: string) => `latex4all-workspace:${root}`;

/** A paper tab as it can be reopened later; null when it can't be (no source). */
export function savedTab(paper: ReadingPaper): SavedTab | null {
  if (!paper.zotero && !paper.filePath) return null;
  return {
    id: paper.id,
    label: paper.label,
    ...(paper.zotero ? { zotero: paper.zotero } : {}),
    ...(paper.filePath ? { filePath: paper.filePath } : {}),
  };
}

export function saveWorkspace(root: string, workspace: SavedWorkspace) {
  try {
    localStorage.setItem(KEY(root), JSON.stringify(workspace));
  } catch {
    // Storage full or unavailable: nothing to restore next time, no harm.
  }
}

export function loadWorkspace(root: string): SavedWorkspace | null {
  try {
    const raw = localStorage.getItem(KEY(root));
    if (!raw) return null;
    const w = JSON.parse(raw) as Partial<SavedWorkspace>;
    if (!w.dock || !Array.isArray(w.tabs)) return null;
    return {
      dock: {
        reference: !!w.dock.reference,
        vault: !!w.dock.vault,
        notes: !!w.dock.notes,
      },
      collapsed: {
        reference: !!w.collapsed?.reference,
        vault: !!w.collapsed?.vault,
        notes: !!w.collapsed?.notes,
      },
      wide: w.wide ?? null,
      tabs: w.tabs.filter((t) => t && typeof t.id === "string"),
      active: typeof w.active === "string" ? w.active : "preview",
    };
  } catch {
    return null;
  }
}
