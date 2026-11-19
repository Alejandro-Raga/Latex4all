import { invoke } from "@tauri-apps/api/core";

/** Settings → Sync (kept by the app, read by its sync). */
export interface SyncSettings {
  /** Peer-to-peer sync on (beta). */
  enabled: boolean;
  /** Where changes wait while collaborators are offline. */
  storage: "" | "server" | "folder" | "computer" | "hub";
  folder: string | null;
  hubCode: string | null;
  hubbed: string[];
  /** The choice was made (otherwise it's asked at the first share). */
  chosen: boolean;
}

export const getSyncSettings = () => invoke<SyncSettings>("sync_settings");
const setSyncSettings = (settings: SyncSettings) =>
  invoke<void>("set_sync_settings", { settings });

/**
 * Saves only what changed, onto the settings as they are on disk now: a
 * copy held on screen since before something else changed them (the first
 * share's question, the sync noting projects on a server) mustn't write
 * the older values back. Returns the settings as saved.
 */
export async function patchSyncSettings(
  patch: Partial<SyncSettings>,
): Promise<SyncSettings> {
  const now = await getSyncSettings();
  const { hubbed: _kept, ...mine } = patch;
  const next = { ...now, ...mine };
  await setSyncSettings(next);
  return next;
}

/** What differs between two versions of the settings (the user's change). */
export function changed(
  before: SyncSettings,
  after: SyncSettings,
): Partial<SyncSettings> {
  const out: Partial<SyncSettings> = {};
  for (const key of Object.keys(after) as (keyof SyncSettings)[]) {
    if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
      (out as Record<string, unknown>)[key] = after[key];
    }
  }
  return out;
}
export const cloudFolders = () => invoke<string[]>("sync_cloud_folders");

const ASKED = "latex4all-sync-storage-asked";

/** Whether to ask where changes wait: only if never answered, here or in
 * the settings (a choice of storage counts as an answer). */
export function needsStorageQuestion(s: SyncSettings): boolean {
  if (!s.enabled || s.chosen || s.storage) return false;
  try {
    return localStorage.getItem(ASKED) !== "1";
  } catch {
    return true;
  }
}

/** The question was answered on this computer: not asked again. */
export function storageQuestionAnswered() {
  try {
    localStorage.setItem(ASKED, "1");
  } catch {
    // The settings file still says so.
  }
}

/** A hub code: the hub's id, a dot, its secret (64 hex digits). */
export function isHubCode(code: string): boolean {
  return /^[0-9a-z]{32,80}\.[0-9a-f]{64}$/i.test(code.trim());
}

export const SERVER_DOWNLOAD =
  "https://github.com/Alejandro-Raga/Latex4all/tree/main/crates/l4a-sync";
