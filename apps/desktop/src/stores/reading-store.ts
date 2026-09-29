import { create } from "zustand";
import type { PdfAnnotationRect } from "@/components/workspace/preview/pdf-viewer";
import { usePreviewStore } from "./preview-store";

export interface ReadingPaper {
  /** Stable id of the file or Zotero item: one tab per paper. */
  id: string;
  label: string;
  data: Uint8Array;
  annotations?: PdfAnnotationRect[];
  /** For a Zotero PDF: where highlights made on it are saved. */
  zotero?: { itemKey: string; attachmentKey: string };
  /** For a PDF on disk: where it is, so it can be reopened. */
  filePath?: string;
}

/** The PDF pane's tabs: the compiled preview, papers, a widened side panel. */
export type PaneTab = "preview" | "wide" | string;

interface ReadingState {
  papers: ReadingPaper[];
  active: PaneTab;
  /** Opens a paper in its own tab (or brings its tab forward). */
  open: (paper: ReadingPaper) => void;
  close: (id: string) => void;
  activate: (tab: PaneTab) => void;
  /** Closes every paper (another project was opened). */
  reset: () => void;
  /** Shows a highlight just made on an open paper. */
  addAnnotation: (id: string, annotation: PdfAnnotationRect) => void;
}

/**
 * Papers opened in the big PDF pane beside the editor, each in a tab next to
 * the compiled document, so several can be read at full size.
 */
export const useReadingStore = create<ReadingState>((set, get) => ({
  papers: [],
  active: "preview",
  open: (paper) => {
    usePreviewStore.getState().setVisible(true);
    const papers = get().papers;
    const at = papers.findIndex((p) => p.id === paper.id);
    set({
      papers:
        at === -1
          ? [...papers, paper]
          : papers.map((p, i) => (i === at ? paper : p)),
      active: paper.id,
    });
  },
  close: (id) => {
    const { papers, active } = get();
    const at = papers.findIndex((p) => p.id === id);
    if (at === -1) return;
    const rest = papers.filter((p) => p.id !== id);
    // Closing the tab in front shows its neighbour, as browsers do.
    const next =
      active !== id ? active : (rest[at]?.id ?? rest[at - 1]?.id ?? "preview");
    set({ papers: rest, active: next });
  },
  activate: (tab) => set({ active: tab }),
  reset: () => set({ papers: [], active: "preview" }),
  addAnnotation: (id, annotation) =>
    set((s) => ({
      papers: s.papers.map((p) =>
        p.id === id
          ? { ...p, annotations: [...(p.annotations ?? []), annotation] }
          : p,
      ),
    })),
}));
