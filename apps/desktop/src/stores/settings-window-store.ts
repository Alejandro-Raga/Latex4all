import { create } from "zustand";

export type SettingsSection =
  | "provider"
  | "ai-usage"
  | "appearance"
  | "editor"
  | "pdf"
  | "zotero"
  | "vault"
  | "environment"
  | "languages"
  | "updates";

/** The Settings window over a project, and which section it shows. */
export const useSettingsWindow = create<{
  open: boolean;
  section: SettingsSection;
  show: (section?: SettingsSection) => void;
  close: () => void;
}>((set) => ({
  open: false,
  section: "editor",
  show: (section) =>
    set((s) => ({ open: true, section: section ?? s.section })),
  close: () => set({ open: false }),
}));
