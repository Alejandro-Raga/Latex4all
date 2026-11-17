import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProjectFolder {
  id: string;
  name: string;
  color?: string;
  favorite?: boolean;
}

interface FoldersState {
  folders: ProjectFolder[];
  /** Which folder each project is in, by its path. */
  of: Record<string, string>;
  add: (name: string) => string | null;
  rename: (id: string, name: string) => void;
  setColor: (id: string, color?: string) => void;
  toggleFavorite: (id: string) => void;
  /** Gone; its projects back at the top. */
  remove: (id: string) => void;
  /** Into a folder, or out of any (null). */
  put: (path: string, id: string | null) => void;
}

/**
 * Folders on the projects page, to sort projects by what they're for
 * (a thesis, teaching…). Only how the list is shown: nothing moves on disk.
 */
export const useProjectFolders = create<FoldersState>()(
  persist(
    (set) => ({
      folders: [],
      of: {},
      add: (name) => {
        const clean = name.replace(/\s+/g, " ").trim();
        if (!clean) return null;
        const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        set((s) => ({ folders: [...s.folders, { id, name: clean }] }));
        return id;
      },
      rename: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id && name.trim() ? { ...f, name: name.trim() } : f,
          ),
        })),
      setColor: (id, color) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, color } : f)),
        })),
      toggleFavorite: (id) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, favorite: !f.favorite } : f,
          ),
        })),
      remove: (id) =>
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          of: Object.fromEntries(
            Object.entries(s.of).filter(([, f]) => f !== id),
          ),
        })),
      put: (path, id) =>
        set((s) => {
          const of = { ...s.of };
          if (id) of[path] = id;
          else delete of[path];
          return { of };
        }),
    }),
    { name: "project-folders" },
  ),
);
