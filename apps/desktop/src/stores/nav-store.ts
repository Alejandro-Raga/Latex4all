import { create } from "zustand";
import { keepPlace, loadPlace } from "@/lib/place-memory";
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
  /** Which part of the start page shows (when it shows). */
  section: HomeSection;
  /** Counts the asks, so asking for the same part again still goes there. */
  asked: number;
  /** What to show there: a project's list in the Planner, its folder in
   *  the Library (the project you came from, say). */
  focus: string | null;
  goHome: (section?: HomeSection, focus?: string | null) => void;
  /** Another part of the start page, staying there. */
  setSection: (section: HomeSection) => void;
  backToProject: () => void;
}>((set) => ({
  away: false,
  section: "projects",
  asked: 0,
  focus: null,
  goHome: (section, focus) =>
    set((s) => ({
      away: true,
      section: section ?? s.section,
      focus: focus ?? null,
      asked: s.asked + 1,
    })),
  setSection: (section) => set({ section, away: true }),
  backToProject: () => set({ away: false }),
}));

/** In the project's own view (not on the start page). */
export const inProject = () =>
  !!useDocumentStore.getState().projectRoot && !useNav.getState().away;

/**
 * A project opened (or closed): you're in it (or on the start page).
 * Started by the app once it's running, not on import: the stores import
 * each other, and the open project's may not be ready yet then.
 */
/** Where you were: a part of the start page, or writing in a project. */
function savePlace() {
  const { away, section } = useNav.getState();
  const writing = !!useDocumentStore.getState().projectRoot && !away;
  keepPlace("last", writing ? "writing" : section);
}

/** Back where you left off on launch: that part, or your last project. */
async function restorePlace() {
  // Settings → General: a fresh start at Home.
  const { useSettingsStore } = await import("@/stores/settings-store");
  if (useSettingsStore.getState().memory.start === "home") return;
  const { last } = await loadPlace();
  // Moved somewhere already (a link, a shortcut): that wins.
  if (useNav.getState().section !== "projects") return;
  if (useDocumentStore.getState().projectRoot) return;
  if (last === "writing") void toWriting();
  else if (
    last === "planner" ||
    last === "library" ||
    last === "settings" ||
    last === "help"
  ) {
    useNav.setState({ section: last });
  }
}

export function followProjectNav() {
  void restorePlace();
  const offDoc = useDocumentStore.subscribe((s, prev) => {
    if (s.projectRoot !== prev.projectRoot) {
      useNav.setState({ away: false });
    }
    savePlace();
  });
  const offNav = useNav.subscribe(savePlace);
  return () => {
    offDoc();
    offNav();
  };
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
  { key: "4", section: null, label: "Writing" },
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
  else void toWriting();
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

/** Writing: the open project, else the last one you worked on. */
export async function toWriting() {
  const doc = useDocumentStore.getState();
  if (doc.projectRoot) {
    useNav.getState().backToProject();
    return;
  }
  const { useProjectStore } = await import("@/stores/project-store");
  const last = [...useProjectStore.getState().recentProjects].sort(
    (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
  )[0];
  const { toast } = await import("sonner");
  if (!last) {
    useNav.getState().setSection("projects");
    toast.info("Open or create a project to write.");
    return;
  }
  try {
    await doc.openProject(last.path);
    useProjectStore.getState().addRecentProject(last.path);
  } catch {
    useNav.getState().setSection("projects");
    toast.error(`Couldn't open “${last.name}”. Pick a project to write.`);
  }
}
