//! Settings → Sync, for the webview (see `p2p`).

use crate::p2p::{self, SyncSettings};

#[tauri::command]
pub fn sync_settings() -> SyncSettings {
    p2p::settings()
}

#[tauri::command]
pub fn set_sync_settings(settings: SyncSettings) -> Result<(), String> {
    p2p::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_cloud_folders() -> Vec<String> {
    p2p::cloud_folders()
}
