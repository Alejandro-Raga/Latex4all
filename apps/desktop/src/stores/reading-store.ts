import { create } from "zustand";
import type { PdfAnnotationRect } from "@/components/workspace/preview/pdf-viewer";
import { usePreviewStore } from "./preview-store";

export interface ReadingPaper {
  /** Stable id of the file or Zotero item, for keeping its zoom. */
  id: string;
  label: string;
  data: Uint8Array;
  annotations?: PdfAnnotationRect[];
}

/**
 * A paper opened in the big PDF pane in place of the compiled document, so it
 * can be read at full size beside the editor.
 */
export const useReadingStore = create<{
  paper: ReadingPaper | null;
  read: (paper: ReadingPaper) => void;
  close: () => void;
}>((set) => ({
  paper: null,
  read: (paper) => {
    usePreviewStore.getState().setVisible(true);
    set({ paper });
  },
  close: () => set({ paper: null }),
}));
