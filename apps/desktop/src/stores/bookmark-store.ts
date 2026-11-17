import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface Place {
  /** The page bookmarked, if any. */
  bookmark?: number;
  /** The page last open. */
  last?: number;
}

interface BookmarkState {
  /** By paper (its Zotero item, or its id when it isn't in Zotero). */
  places: Record<string, Place>;
  setBookmark: (paper: string, page: number | undefined) => void;
  setLast: (paper: string, page: number) => void;
}

/** Where each paper was left: its bookmark, and the page last open. */
export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set) => ({
      places: {},
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
