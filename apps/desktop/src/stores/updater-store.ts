import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdateChannel } from "@/stores/settings-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("updater");

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | {
      state: "available";
      version: string;
      notes?: string;
      isDowngrade: boolean;
    }
  | { state: "downloading"; percent: number }
  | { state: "installing" }
  | { state: "ready" }
  | { state: "error"; message: string };

interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  isDowngrade: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

interface UpdaterState {
  status: UpdateStatus;
  /** True once the automatic launch check has run, so mounting another
   *  consumer (e.g. opening Settings → Updates) doesn't re-check. */
  launchCheckDone: boolean;
  setStatus: (status: UpdateStatus) => void;
  markLaunchChecked: () => void;
  /**
   * `allowDowngrade` lets the release channel offer a build older than the one
   * installed, which is how a tester gets back off the test channel. It is
   * never set by the launch check — a rollback only ever happens because
   * somebody asked for one.
   */
  check: (channel: UpdateChannel, allowDowngrade?: boolean) => Promise<void>;
  install: (channel: UpdateChannel, allowDowngrade?: boolean) => Promise<void>;
  restart: () => Promise<void>;
}

/**
 * Single source of truth for updater state.
 *
 * Deliberately a store rather than per-component hook state: the update prompt
 * and the Settings → Updates panel are mounted independently, and with local
 * state a "Check now" in Settings would resolve into a copy the prompt never
 * sees. One store means one status and one in-flight check.
 */
export const useUpdaterStore = create<UpdaterState>()((set, get) => ({
  status: { state: "idle" },
  launchCheckDone: false,

  setStatus: (status) => set({ status }),
  markLaunchChecked: () => set({ launchCheckDone: true }),

  check: async (channel, allowDowngrade = false) => {
    if (get().status.state === "checking") return;

    set({ status: { state: "checking" } });
    try {
      const update = await invoke<UpdateInfo | null>("updater_check", {
        channel,
        allowDowngrade,
      });
      if (!update) {
        set({ status: { state: "up-to-date" } });
        return;
      }
      log.info("Update available", {
        channel,
        version: update.version,
        isDowngrade: update.isDowngrade,
      });
      set({
        status: {
          state: "available",
          version: update.version,
          notes: update.notes ?? undefined,
          isDowngrade: update.isDowngrade,
        },
      });
    } catch (err) {
      log.warn("Update check failed", { error: String(err) });
      set({ status: { state: "error", message: String(err) } });
    }
  },

  install: async (channel, allowDowngrade = false) => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;

    try {
      set({ status: { state: "downloading", percent: 0 } });

      unlistenProgress = await listen<DownloadProgress>(
        "updater://progress",
        (event) => {
          const { downloaded, total } = event.payload;
          if (total && total > 0) {
            set({
              status: {
                state: "downloading",
                percent: Math.min(100, Math.round((downloaded / total) * 100)),
              },
            });
          }
        },
      );

      unlistenFinished = await listen("updater://finished", () => {
        set({ status: { state: "installing" } });
      });

      await invoke("updater_install", { channel, allowDowngrade });
      set({ status: { state: "ready" } });
    } catch (err) {
      log.error("Update install failed", { error: String(err) });
      set({ status: { state: "error", message: String(err) } });
    } finally {
      unlistenProgress?.();
      unlistenFinished?.();
    }
  },

  restart: () => relaunch(),
}));
