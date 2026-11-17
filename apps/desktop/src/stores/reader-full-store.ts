import { create } from "zustand";

/**
 * The Library's reader across the whole window: the paper list, the vault
 * and the app's sidebar make way while it's on.
 */
export const useReaderFull = create<{
  on: boolean;
  set: (on: boolean) => void;
}>((set) => ({ on: false, set: (on) => set({ on }) }));
