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
  goHome: (section?: HomeSection) => void;
  backToProject: () => void;
}>((set) => ({
  away: false,
  section: null,
  goHome: (section) => set({ away: true, section: section ?? null }),
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
