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
export const setSyncSettings = (settings: SyncSettings) =>
  invoke<void>("set_sync_settings", { settings });
export const cloudFolders = () => invoke<string[]>("sync_cloud_folders");

/** A hub code: the hub's id, a dot, its secret (64 hex digits). */
export function isHubCode(code: string): boolean {
  return /^[0-9a-z]{32,80}\.[0-9a-f]{64}$/i.test(code.trim());
}

export const SERVER_DOWNLOAD =
  "https://github.com/Alejandro-Raga/Latex4all/tree/main/crates/l4a-sync";
