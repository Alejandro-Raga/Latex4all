//! Channel-aware update checking.
//!
//! The JS `@tauri-apps/plugin-updater` `check()` takes no endpoint override —
//! its `CheckOptions` only carries headers/timeout/proxy/target — so the
//! release/test split has to happen here, where `updater_builder()` lets us
//! swap the endpoint per call.
//!
//! Both channels are served by the same GitHub repo and verified against the
//! same pubkey in `tauri.conf.json`; only the manifest they read differs. The
//! release channel follows `releases/latest`, which GitHub resolves to the
//! newest *non-prerelease* tag, so publishing test builds as prereleases keeps
//! them invisible to release-channel users automatically.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const RELEASE_ENDPOINT: &str =
    "https://github.com/Alejandro-Raga/Latex4all/releases/latest/download/latest.json";

/// Rolling prerelease tag that testing-branch builds overwrite in place, so the
/// URL stays constant while the artifacts behind it change. The tag is
/// `testing-latest`, not `testing`, so it cannot collide with the branch of
/// that name — a tag and branch sharing a name makes bare refs ambiguous.
const TEST_ENDPOINT: &str =
    "https://github.com/Alejandro-Raga/Latex4all/releases/download/testing-latest/latest-test.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Release,
    Test,
}

impl Channel {
    fn endpoint(self) -> &'static str {
        match self {
            Channel::Release => RELEASE_ENDPOINT,
            Channel::Test => TEST_ENDPOINT,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// Built per call rather than cached: the endpoint depends on the channel, and
/// the user can switch channels without restarting.
async fn check_with(
    app: &AppHandle,
    channel: Channel,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let endpoint = channel
        .endpoint()
        .parse()
        .map_err(|e| format!("Invalid updater endpoint: {e}"))?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to set updater endpoint: {e}"))?;

    if matches!(channel, Channel::Test) {
        // Test builds are stamped `<major>.<minor>.<ci-run-number>`, so they
        // climb monotonically and the default "remote > current" rule would
        // usually work. `!=` is used instead so the channel still tracks the
        // tip when a run is re-run and re-published under the same number, and
        // so switching *down* from a stale test build onto a fresh one works.
        // Deliberately not applied to the release channel, where accepting any
        // difference would let a downgrade install itself silently.
        builder = builder.version_comparator(|current, remote| remote.version != current);
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build updater: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))
}

/// Ask the given channel whether a newer build exists. `Ok(None)` means the
/// app is current — that is the common case and is not an error.
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    channel: Channel,
) -> Result<Option<UpdateInfo>, String> {
    let Some(update) = check_with(&app, channel).await? else {
        return Ok(None);
    };

    Ok(Some(UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    }))
}

/// Download and install the pending update, emitting `updater://progress` as
/// bytes arrive and `updater://finished` once the installer has been staged.
///
/// Re-checks rather than holding the `Update` from `updater_check` in managed
/// state: `Update` is not `Clone`, and keeping one alive across commands would
/// mean guarding it behind a mutex whose contents can silently go stale when
/// the user switches channels. One extra manifest fetch is cheaper than that.
#[tauri::command]
pub async fn updater_install(app: AppHandle, channel: Channel) -> Result<(), String> {
    let Some(update) = check_with(&app, channel).await? else {
        return Err("No update available to install".to_string());
    };

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;

    let finish_app = app.clone();

    update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded += chunk_length as u64;
                let _ = progress_app.emit(
                    "updater://progress",
                    DownloadProgress {
                        downloaded,
                        total: content_length,
                    },
                );
            },
            move || {
                let _ = finish_app.emit("updater://finished", ());
            },
        )
        .await
        .map_err(|e| format!("Update install failed: {e}"))?;

    Ok(())
}
