import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("language-packs");

// ─── Types ───

/** Mirrors `LanguagePackInfo` in src-tauri/src/language_packs.rs. */
export interface LanguagePack {
  code: string;
  label: string;
  installed: boolean;
  hasThesaurus: boolean;
  offersThesaurus: boolean;
  /** The downloaded pack includes definitions. */
  hasDefinitions: boolean;
  /** This pack would also bring definitions if installed. */
  offersDefinitions: boolean;
  /** Attribution the data's licence obliges the app to show. */
  attribution: string | null;
  /** Installed, but missing something the pack now offers — a pack downloaded
   * before definitions existed still spell checks, so nothing else says so. */
  needsUpdate: boolean;
  /** The OS already spell checks this language, so a pack is optional. */
  systemSupported: boolean;
  approxBytes: number;
}

/** Payload of the `language-pack-progress` event emitted during install. */
interface InstallProgress {
  code: string;
  message: string;
  percent: number | null;
}

interface LanguagePacksState {
  packs: LanguagePack[];
  loading: boolean;
  /** Language code currently downloading, if any. */
  installing: string | null;
  /** Bumped whenever the installed set changes. The editor watches it to
   * re-check the open document, the way it already does when the language
   * itself changes — a pack that only takes effect after a restart would
   * look like it hadn't worked. */
  revision: number;
  progress: InstallProgress | null;
  error: string | null;

  refresh: () => Promise<void>;
  install: (code: string) => Promise<void>;
  remove: (code: string) => Promise<void>;
  packFor: (code: string) => LanguagePack | undefined;
}

// ─── Store ───

export const useLanguagePacksStore = create<LanguagePacksState>((set, get) => ({
  packs: [],
  loading: false,
  installing: null,
  revision: 0,
  progress: null,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const packs = await invoke<LanguagePack[]>("list_language_packs");
      set({ packs, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  install: async (code) => {
    if (get().installing) return;
    set({ installing: code, error: null, progress: null });

    const unlisten = await listen<InstallProgress>(
      "language-pack-progress",
      (event) => {
        if (event.payload.code === code) set({ progress: event.payload });
      },
    );

    try {
      await invoke("install_language_pack", { code });
      log.info("Language pack installed", { code });
      set({ installing: null, progress: null, revision: get().revision + 1 });
      await get().refresh();
    } catch (err) {
      log.error("Language pack install failed", { code, error: String(err) });
      set({
        installing: null,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      unlisten();
    }
  },

  remove: async (code) => {
    try {
      await invoke("remove_language_pack", { code });
      set({ revision: get().revision + 1 });
      await get().refresh();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  packFor: (code) => get().packs.find((pack) => pack.code === code),
}));
