import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface Place {
  /** The page bookmarked, if any. */
  bookmark?: number;
  /** The page last open. */
  last?: number;
}

export interface RecentPaper {
  itemKey: string;
  label: string;
  at: number;
}

interface BookmarkState {
  /** By paper (its Zotero item, or its id when it isn't in Zotero). */
  places: Record<string, Place>;
  /** Papers opened lately, the latest first. */
  recent: RecentPaper[];
  opened: (itemKey: string, label: string) => void;
  setBookmark: (paper: string, page: number | undefined) => void;
  setLast: (paper: string, page: number) => void;
}

/** Where each paper was left: its bookmark, and the page last open. */
export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set) => ({
      places: {},
      recent: [],
      opened: (itemKey, label) =>
        set((s) => ({
          recent: [
            { itemKey, label, at: Date.now() },
            ...s.recent.filter((r) => r.itemKey !== itemKey),
          ].slice(0, 10),
        })),
      setBookmark: (paper, page) =>
        set((s) => ({
          places: {
            ...s.places,
            [paper]: { ...s.places[paper], bookmark: page },
          },
        })),
      setLast: (paper, page) =>
        set((s) =>
          s.places[paper]?.last === page
            ? s
            : {
                places: {
                  ...s.places,
                  [paper]: { ...s.places[paper], last: page },
                },
              },
        ),
    }),
    {
      name: "latex4all-bookmarks",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
