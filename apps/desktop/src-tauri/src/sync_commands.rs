//! Settings → Sync, for the webview (see `p2p`).

use crate::p2p::{self, SyncSettings};

#[tauri::command]
pub fn sync_settings() -> SyncSettings {
    p2p::settings()
}

#[tauri::command]
pub fn set_sync_settings(mut settings: SyncSettings) -> Result<(), String> {
    // Which projects are on a server is the sync's to note, not the
    // window's: kept as on disk, whatever an older copy in the window says.
    let now = p2p::settings();
    for p in now.hubbed {
        if !settings.hubbed.contains(&p) {
            settings.hubbed.push(p);
        }
    }
    p2p::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_cloud_folders() -> Vec<String> {
    p2p::cloud_folders()
}
