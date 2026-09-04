import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "@/lib/debug/logger";
import { useSettingsStore } from "@/stores/settings-store";

const log = createLogger("languagetool");

// ─── Types ───

/** Mirrors `LanguageToolStatus` in src-tauri/src/languagetool.rs. */
interface LanguageToolStatus {
  installed: boolean;
  running: boolean;
  /** True when the responding server is one this app started. */
  managed: boolean;
  javaPath: string | null;
  javaBundled: boolean;
  installDir: string;
  version: string;
}

/** Payload of the `languagetool-progress` event emitted during install. */
interface InstallProgress {
  phase: "java" | "languagetool" | "extract" | "done";
  message: string;
  percent: number | null;
}

/**
 * `not-installed` — nothing downloaded yet.
 * `stopped` — installed, but no server is answering.
 * `ready` — a server is answering on the configured URL.
 */
type LanguageToolSetupStatus =
  | "checking"
  | "not-installed"
  | "stopped"
  | "ready"
  | "error";

interface LanguageToolState {
  status: LanguageToolSetupStatus;
  isInstalling: boolean;
  isStarting: boolean;
  progress: InstallProgress | null;
  error: string | null;
  version: string | null;
  installDir: string | null;
  javaBundled: boolean;
  /** True when the reachable server was started outside this app (e.g. Homebrew). */
  externallyManaged: boolean;

  checkStatus: () => Promise<void>;
  install: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** The URL the grammar checker is configured to talk to. */
function serverUrl(): string {
  return useSettingsStore.getState().grammarCheckServerUrl;
}

// ─── Store ───

export const useLanguageToolStore = create<LanguageToolState>((set, get) => ({
  status: "checking",
  isInstalling: false,
  isStarting: false,
  progress: null,
  error: null,
  version: null,
  installDir: null,
  javaBundled: false,
  externallyManaged: false,

  checkStatus: async () => {
    set({ status: "checking", error: null });
    try {
      const result = await invoke<LanguageToolStatus>("language_tool_status", {
        serverUrl: serverUrl(),
      });

      set({
        // A reachable server is what actually matters, whether or not we
        // installed it — a user running their own is already done.
        status: result.running
          ? "ready"
          : result.installed
            ? "stopped"
            : "not-installed",
        version: result.version,
        installDir: result.installDir,
        javaBundled: result.javaBundled,
        externallyManaged: result.running && !result.managed,
      });
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  install: async () => {
    set({ isInstalling: true, error: null, progress: null });

    // The install streams progress; the command itself resolves when done.
    const unlisten = await listen<InstallProgress>(
      "languagetool-progress",
      (event) => set({ progress: event.payload }),
    );

    try {
      await invoke("install_language_tool");
      log.info("LanguageTool installed");
      set({ isInstalling: false, progress: null });
      await get().checkStatus();
      // Nothing is listening yet — bring the server up so grammar checking
      // works immediately rather than after another click.
      await get().start();
    } catch (err) {
      log.error("LanguageTool install failed", { error: String(err) });
      set({
        isInstalling: false,
        progress: null,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      unlisten();
    }
  },

  start: async () => {
    set({ isStarting: true, error: null });
    try {
      await invoke("start_language_tool", { serverUrl: serverUrl() });
      log.info("LanguageTool server started");
      set({ isStarting: false });
      await get().checkStatus();
    } catch (err) {
      log.error("LanguageTool failed to start", { error: String(err) });
      set({
        isStarting: false,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  stop: async () => {
    try {
      await invoke("stop_language_tool");
    } catch (err) {
      log.warn("Failed to stop LanguageTool", { error: String(err) });
    }
    await get().checkStatus();
  },
}));
