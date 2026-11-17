import { flushSync } from "react-dom";
import { create } from "zustand";

/**
 * The Library's reader across the whole window: the paper list, the vault
 * and the app's sidebar make way while it's on.
 */
export const useReaderFull = create<{
  on: boolean;
  set: (on: boolean) => void;
}>((set) => ({ on: false, set: (on) => set({ on }) }));

/**
 * Into the full window or out of it, the change eased rather than a jump:
 * the reader grows into (or back from) the room the rest leaves, as the
 * window's view transition draws it. Without one, or with reduced motion
 * asked for, at once.
 */
export function setReaderFull(on: boolean) {
  const store = useReaderFull.getState();
  if (store.on === on) return;
  const apply = () => flushSync(() => store.set(on));
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => unknown;
  };
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (doc.startViewTransition && !still) doc.startViewTransition(apply);
  else apply();
}

/**
 * In a project: the PDF pane across the whole window (the code, the
 * sidebar and the side panels make way), to read a paper or the draft.
 */
export const useEditorFull = create<{ on: boolean }>(() => ({ on: false }));

export function setEditorFull(on: boolean) {
  if (useEditorFull.getState().on === on) return;
  const apply = () => flushSync(() => useEditorFull.setState({ on }));
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => unknown;
  };
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (doc.startViewTransition && !still) doc.startViewTransition(apply);
  else apply();
}
