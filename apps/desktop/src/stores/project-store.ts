import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProjectSort } from "@/lib/project-grouping";

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

interface ProjectState {
  recentProjects: RecentProject[];
  lastProjectFolder: string | null;
  /** Normalised paths the user has starred. */
  favorites: string[];
  /** Path to when it first appeared here. Absent for anything added before
   *  this was recorded, where last-opened stands in. */
  addedAt: Record<string, number>;
  /** Path to type, mirroring what is on disk in each project. A cache, not the
   *  source of truth: it exists so the grid can group immediately instead of
   *  reflowing as a read per project comes back. */
  projectTypes: Record<string, string>;
  /** Path to the folder's own creation time, read from disk. A cache, like
   *  projectTypes — ordering by it must not wait on a stat per project. */
  createdAt: Record<string, number>;
  /** How the grid is ordered. Persisted: opening a project unmounts the picker,
   *  and coming back to a different order than you left is disorienting. */
  projectSort: ProjectSort;
  /**
   * `times` is for projects the app discovered rather than watched being
   * opened: without it every one is stamped with the same instant and ordering
   * by recency or by date added shows the same arbitrary list.
   */
  addRecentProject: (
    path: string,
    times?: { lastOpened?: number; addedAt?: number },
  ) => void;
  removeRecentProject: (path: string) => void;
  renameRecentProject: (oldPath: string, newPath: string) => void;
  setLastProjectFolder: (path: string) => void;
  toggleFavorite: (path: string) => void;
  cacheProjectType: (path: string, type: string | null) => void;
  cacheProjectCreatedAt: (path: string, created: number) => void;
  setProjectSort: (sort: ProjectSort) => void;
}

/**
 * How many non-favourite projects to remember.
 *
 * Favourites are held outside this limit. Starring something and then losing it
 * because ten other projects were opened would make the star meaningless.
 */
const MAX_RECENT = 10;

function normalizeRecentPath(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function recentProjectName(path: string): string {
  const normalized = normalizeRecentPath(path);
  return normalized.split(/[/\\]/).pop() || normalized;
}

/** Trim to MAX_RECENT, but never drop a favourite. */
function capRecents(
  projects: RecentProject[],
  favorites: string[],
): RecentProject[] {
  const isFavorite = (path: string) =>
    favorites.some((f) => isSameProjectPath(f, path));

  let kept = 0;
  return projects.filter((project) => {
    if (isFavorite(project.path)) return true;
    kept += 1;
    return kept <= MAX_RECENT;
  });
}

function movePathKey<T>(
  record: Record<string, T>,
  from: string,
  to: string,
): Record<string, T> {
  const next = { ...record };
  const existing = Object.keys(next).find((key) =>
    isSameProjectPath(key, from),
  );
  if (existing === undefined) return next;
  const value = next[existing];
  delete next[existing];
  next[to] = value;
  return next;
}

function isSameProjectPath(a: string, b: string): boolean {
  return (
    normalizeRecentPath(a).toLowerCase() ===
    normalizeRecentPath(b).toLowerCase()
  );
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      recentProjects: [],
      lastProjectFolder: null,
      favorites: [],
      addedAt: {},
      projectTypes: {},
      createdAt: {},
      projectSort: "recent",

      setLastProjectFolder: (path) => set({ lastProjectFolder: path }),

      setProjectSort: (sort) => set({ projectSort: sort }),

      addRecentProject: (path, times) => {
        const normalizedPath = normalizeRecentPath(path);
        const name = recentProjectName(normalizedPath);
        const now = Date.now();
        set((state) => {
          const filtered = state.recentProjects.filter(
            (p) => !isSameProjectPath(p.path, normalizedPath),
          );
          const next = [
            {
              path: normalizedPath,
              name,
              lastOpened: times?.lastOpened ?? now,
            },
            ...filtered,
          ];
          return {
            recentProjects: capRecents(next, state.favorites),
            addedAt: {
              ...state.addedAt,
              // Only on first sight: reopening a project does not re-add it.
              [normalizedPath]:
                state.addedAt[normalizedPath] ?? times?.addedAt ?? now,
            },
          };
        });
      },

      toggleFavorite: (path) => {
        const normalizedPath = normalizeRecentPath(path);
        set((state) => {
          const isFavorite = state.favorites.some((f) =>
            isSameProjectPath(f, normalizedPath),
          );
          const favorites = isFavorite
            ? state.favorites.filter(
                (f) => !isSameProjectPath(f, normalizedPath),
              )
            : [...state.favorites, normalizedPath];
          return {
            favorites,
            // Un-starring can push a long-untouched project past the cap, which
            // is the point of the cap — so re-apply it here too.
            recentProjects: capRecents(state.recentProjects, favorites),
          };
        });
      },

      cacheProjectCreatedAt: (path, created) => {
        const normalizedPath = normalizeRecentPath(path);
        set((state) => ({
          createdAt: { ...state.createdAt, [normalizedPath]: created },
        }));
      },

      cacheProjectType: (path, type) => {
        const normalizedPath = normalizeRecentPath(path);
        set((state) => {
          const projectTypes = { ...state.projectTypes };
          if (type === null) delete projectTypes[normalizedPath];
          else projectTypes[normalizedPath] = type;
          return { projectTypes };
        });
      },

      removeRecentProject: (path) => {
        const normalizedPath = normalizeRecentPath(path);
        set((state) => {
          const projectTypes = { ...state.projectTypes };
          const addedAt = { ...state.addedAt };
          const createdAt = { ...state.createdAt };
          delete projectTypes[normalizedPath];
          delete addedAt[normalizedPath];
          delete createdAt[normalizedPath];
          return {
            recentProjects: state.recentProjects.filter(
              (p) => !isSameProjectPath(p.path, normalizedPath),
            ),
            // Forgetting a project forgets everything about it, or re-adding it
            // later would silently come back starred.
            favorites: state.favorites.filter(
              (f) => !isSameProjectPath(f, normalizedPath),
            ),
            projectTypes,
            addedAt,
            createdAt,
          };
        });
      },

      renameRecentProject: (oldPath, newPath) => {
        const normalizedNewPath = normalizeRecentPath(newPath);
        const name = recentProjectName(normalizedNewPath);
        set((state) => ({
          recentProjects: [
            { path: normalizedNewPath, name, lastOpened: Date.now() },
            ...state.recentProjects.filter(
              (p) =>
                !isSameProjectPath(p.path, oldPath) &&
                !isSameProjectPath(p.path, normalizedNewPath),
            ),
          ],
          // A rename is the same project at a new path, so everything recorded
          // against the old one moves with it.
          favorites: state.favorites.map((f) =>
            isSameProjectPath(f, oldPath) ? normalizedNewPath : f,
          ),
          projectTypes: movePathKey(
            state.projectTypes,
            oldPath,
            normalizedNewPath,
          ),
          addedAt: movePathKey(state.addedAt, oldPath, normalizedNewPath),
          createdAt: movePathKey(state.createdAt, oldPath, normalizedNewPath),
        }));
      },
    }),
    {
      name: "latex4all-projects",
      partialize: (state) => ({
        recentProjects: state.recentProjects,
        lastProjectFolder: state.lastProjectFolder,
        favorites: state.favorites,
        addedAt: state.addedAt,
        projectTypes: state.projectTypes,
        createdAt: state.createdAt,
        projectSort: state.projectSort,
      }),
    },
  ),
);
