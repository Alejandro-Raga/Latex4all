import { useCallback, useEffect } from "react";
import { useSettingsStore, type UpdateChannel } from "@/stores/settings-store";
import { useUpdaterStore, type UpdateStatus } from "@/stores/updater-store";

/** How often an open app looks for a new version. */
const RECHECK_EVERY = 4 * 60 * 60e3;
/** Back to the window after this long away: look again. */
const RECHECK_ON_RETURN = 60 * 60e3;
let rechecking = false;

export type { UpdateStatus };

/**
 * Thin binding between the settings-held channel choice and the shared
 * updater store. Safe to call from more than one component — the store keeps
 * a single status, and the launch check is guarded so it runs once per
 * session no matter how many consumers mount.
 *
 * The JS plugin's own `check()` is deliberately unused: its `CheckOptions`
 * cannot override the endpoint, so it could only ever read the single feed
 * baked into tauri.conf.json and could not honour the channel choice. The
 * channel-aware commands live in `src-tauri/src/updater.rs`.
 */
export function useUpdater() {
  const channel = useSettingsStore((s) => s.updateChannel);
  const autoCheck = useSettingsStore((s) => s.autoCheckForUpdates);

  const status = useUpdaterStore((s) => s.status);
  const setStatus = useUpdaterStore((s) => s.setStatus);
  const launchCheckDone = useUpdaterStore((s) => s.launchCheckDone);
  const markLaunchChecked = useUpdaterStore((s) => s.markLaunchChecked);
  const storeCheck = useUpdaterStore((s) => s.check);
  const storeCheckRequested = useUpdaterStore((s) => s.checkRequested);
  const storeInstall = useUpdaterStore((s) => s.install);
  const restart = useUpdaterStore((s) => s.restart);

  const checkForUpdate = useCallback(() => {
    // No channel chosen yet — the first-run picker hasn't been answered, so
    // there is no feed to ask.
    if (!channel) return Promise.resolve();
    return storeCheckRequested(channel);
  }, [channel, storeCheckRequested]);

  const installUpdate = useCallback(() => {
    if (!channel) return Promise.resolve();
    return storeInstall(channel);
  }, [channel, storeInstall]);

  /**
   * Check a channel by name rather than the one in settings.
   *
   * Switching channel calls this with the channel just picked: the settings
   * write has not landed in this render yet, so `channel` still holds the old
   * one. On release it is also what surfaces a rollback when the machine is
   * running a test build numbered above it.
   */
  const checkChannel = useCallback(
    (next: UpdateChannel) => storeCheckRequested(next),
    [storeCheckRequested],
  );

  useEffect(() => {
    if (!channel || !autoCheck || launchCheckDone) return;
    markLaunchChecked();
    void storeCheck(channel);
  }, [channel, autoCheck, launchCheckDone, markLaunchChecked, storeCheck]);

  // An app left open for days still hears of new versions: checked again
  // every few hours, and on coming back to it after a while away. Never
  // while an update is on offer or being installed.
  useEffect(() => {
    // Several components use this hook; one timer is enough.
    if (!channel || !autoCheck || rechecking) return;
    rechecking = true;
    let last = Date.now();
    const recheck = (minimum: number) => {
      if (Date.now() - last < minimum) return;
      const { state } = useUpdaterStore.getState().status;
      if (state !== "idle" && state !== "up-to-date" && state !== "error") {
        return;
      }
      last = Date.now();
      void storeCheck(channel);
    };
    const timer = setInterval(() => recheck(RECHECK_EVERY), 10 * 60e3);
    const onFocus = () => recheck(RECHECK_ON_RETURN);
    window.addEventListener("focus", onFocus);
    return () => {
      rechecking = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [channel, autoCheck, storeCheck]);

  return {
    status,
    checkForUpdate,
    installUpdate,
    checkChannel,
    restart,
    setStatus,
  };
}
