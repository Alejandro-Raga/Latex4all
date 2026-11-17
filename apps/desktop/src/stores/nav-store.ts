import { create } from "zustand";
import { useDocumentStore } from "@/stores/document-store";

/** The start page's parts: projects, Library & Vault, the Planner… */
export type HomeSection =
  | "projects"
  | "library"
  | "planner"
  | "settings"
  | "help";

/**
 * Where you are: in the open project, or away from it on the start page
 * (the project kept open, as it was, one click from coming back). Any part
 * of the app is reachable from any other without closing anything.
 */
export const useNav = create<{
  /** On the start page while a project is open. */
  away: boolean;
  /** Which part of the start page to show on getting there. */
  section: HomeSection | null;
  /** Counts the asks, so asking for the same part again still goes there. */
  asked: number;
  /** What to show there: a project's list in the Planner, its folder in
   *  the Library (the project you came from, say). */
  focus: string | null;
  goHome: (section?: HomeSection, focus?: string | null) => void;
  backToProject: () => void;
}>((set) => ({
  away: false,
  section: null,
  asked: 0,
  focus: null,
  goHome: (section, focus) =>
    set((s) => ({
      away: true,
      section: section ?? null,
      focus: focus ?? null,
      asked: s.asked + 1,
    })),
  backToProject: () => set({ away: false, section: null }),
}));

/** In the project's own view (not on the start page). */
export const inProject = () =>
  !!useDocumentStore.getState().projectRoot && !useNav.getState().away;

/**
 * A project opened (or closed): you're in it (or on the start page).
 * Started by the app once it's running, not on import: the stores import
 * each other, and the open project's may not be ready yet then.
 */
export function followProjectNav() {
  return useDocumentStore.subscribe((s, prev) => {
    if (s.projectRoot !== prev.projectRoot) {
      useNav.setState({ away: false });
    }
  });
}

/** To a project: back to it if it's the one open, else opened. */
export async function goToProject(root: string) {
  const doc = useDocumentStore.getState();
  if (doc.projectRoot === root) {
    useNav.getState().backToProject();
    return;
  }
  await doc.openProject(root);
  const { useProjectStore } = await import("@/stores/project-store");
  useProjectStore.getState().addRecentProject(root);
}

/** The app's parts, from anywhere: ⌘1 projects, ⌘2 Library & Vault, ⌘3
 *  Planner, ⌘4 back to the open project (Ctrl on Windows and Linux). */
export const PLACES: {
  key: string;
  section: HomeSection | null;
  label: string;
}[] = [
  { key: "1", section: "projects", label: "All projects" },
  { key: "2", section: "library", label: "Library & Vault" },
  { key: "3", section: "planner", label: "Planner" },
  { key: "4", section: null, label: "Back to the project" },
];

/**
 * To a part of the app. From a project, the Planner opens on its list and
 * the Library on its folder: where you were, in the new place.
 */
export function goToPlace(section: HomeSection | null) {
  const root = useDocumentStore.getState().projectRoot;
  const here = root && !useNav.getState().away ? root : null;
  if (section === "planner") {
    useNav.getState().goHome("planner", here ? `project:${here}` : null);
  } else if (section === "library") {
    useNav.getState().goHome("library", here);
  } else if (section) useNav.getState().goHome(section);
  else if (useDocumentStore.getState().projectRoot) {
    useNav.getState().backToProject();
  }
}

export function followPlaceKeys() {
  const key = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const place = PLACES.find((p) => p.key === e.key);
    if (!place) return;
    e.preventDefault();
    goToPlace(place.section);
  };
  window.addEventListener("keydown", key);
  return () => window.removeEventListener("keydown", key);
}

/** A project's list in the Planner, from anywhere (its card, its strip…). */
export function openInPlanner(root: string) {
  useNav.getState().goHome("planner", `project:${root}`);
}
