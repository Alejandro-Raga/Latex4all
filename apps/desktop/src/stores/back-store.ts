import { create } from "zustand";

/**
 * Where to go back to after following a link elsewhere in the app (a
 * project from a task, a paper from the reading list): shown as a pill
 * until used, dismissed, or replaced by the next jump.
 */
export const useBack = create<{
  back: { label: string; go: () => void } | null;
  set: (label: string, go: () => void) => void;
  clear: () => void;
}>((set) => ({
  back: null,
  set: (label, go) => set({ back: { label, go } }),
  clear: () => set({ back: null }),
}));
