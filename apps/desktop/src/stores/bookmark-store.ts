import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface Place {
  /** The page bookmarked, if any. */
  bookmark?: number;
  /** The page last open. */
  last?: number;
  /** The furthest page reached, to count pages read. */
  furthest?: number;
}

/** A local YYYY-MM-DD. */
const dayOf = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
};

/** At most this many pages counted at once: a jump to the end isn't reading. */
const MOST_AT_ONCE = 30;

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
  /** Pages read on each day, YYYY-MM-DD: new pages reached in the reader. */
  pagesByDay: Record<string, number>;
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
      pagesByDay: {},
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
        set((s) => {
          const place = s.places[paper] ?? {};
          if (place.last === page) return s;
          // Further than ever before: those pages were read today. The
          // first page seen only sets where reading starts.
          const furthest = place.furthest ?? page;
          const read =
            place.furthest === undefined
              ? 0
              : Math.min(MOST_AT_ONCE, Math.max(0, page - furthest));
          const today = dayOf();
          return {
            places: {
              ...s.places,
              [paper]: {
                ...place,
                last: page,
                furthest: Math.max(furthest, page),
              },
            },
            pagesByDay: read
              ? { ...s.pagesByDay, [today]: (s.pagesByDay[today] ?? 0) + read }
              : s.pagesByDay,
          };
        }),
    }),
    {
      name: "latex4all-bookmarks",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
