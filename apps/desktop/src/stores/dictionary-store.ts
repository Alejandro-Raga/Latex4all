import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("dictionary");

// ─── Types ───

/** Mirrors `DictionaryStatus` in src-tauri/src/dictionary.rs. */
interface DictionaryStatus {
  installed: boolean;
  /** Where the database came from: shipped with the app, downloaded here, or absent. */
  source: "bundled" | "user" | "none";
  installDir: string;
  /** macOS answers definitions from Dictionary Services regardless of WordNet. */
  hasSystemDictionary: boolean;
  version: string;
}

/** Payload of the `dictionary-progress` event emitted during install. */
interface InstallProgress {
  phase: "download" | "extract" | "done";
  message: string;
  percent: number | null;
}

/**
 * `unknown` — not asked yet.
 * `missing` — no database, so lookups can only come back empty.
 * `ready` — a database is available (bundled or user-installed).
 */
type DictionarySetupStatus =
  | "unknown"
  | "checking"
  | "missing"
  | "ready"
  | "error";

interface DictionaryState {
  status: DictionarySetupStatus;
  source: DictionaryStatus["source"];
  installDir: string | null;
  version: string | null;
  hasSystemDictionary: boolean;
  isInstalling: boolean;
  progress: InstallProgress | null;
  error: string | null;

  checkStatus: () => Promise<void>;
  install: () => Promise<void>;
}

// ─── Store ───

export const useDictionaryStore = create<DictionaryState>((set, get) => ({
  status: "unknown",
  source: "none",
  installDir: null,
  version: null,
  hasSystemDictionary: false,
  isInstalling: false,
  progress: null,
  error: null,

  checkStatus: async () => {
    set({ status: "checking", error: null });
    try {
      const result = await invoke<DictionaryStatus>("dictionary_status");
      set({
        status: result.installed ? "ready" : "missing",
        source: result.source,
        installDir: result.installDir,
        version: result.version,
        hasSystemDictionary: result.hasSystemDictionary,
      });
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  install: async () => {
    if (get().isInstalling) return;
    set({ isInstalling: true, error: null, progress: null });

    // The install streams progress; the command itself resolves when done.
    const unlisten = await listen<InstallProgress>(
      "dictionary-progress",
      (event) => set({ progress: event.payload }),
    );

    try {
      await invoke("install_dictionary");
      log.info("Dictionary database installed");
      set({ isInstalling: false, progress: null });
      await get().checkStatus();
    } catch (err) {
      log.error("Dictionary install failed", { error: String(err) });
      set({
        isInstalling: false,
        progress: null,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      unlisten();
    }
  },
}));
