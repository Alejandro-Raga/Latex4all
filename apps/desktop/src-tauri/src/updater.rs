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

use semver::Version;
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
    /// True when the offered build is older than the installed one, so the UI
    /// can present a rollback as a rollback rather than dressing it up as an
    /// update.
    pub is_downgrade: bool,
}

/// Unparseable versions should not happen, but if one appears the safe answer
/// is "not a downgrade": mislabelling an ordinary update as a rollback is
/// worse than the reverse, which the user has explicitly asked for anyway.
fn is_downgrade(current: &str, remote: &str) -> bool {
    match (Version::parse(current), Version::parse(remote)) {
        (Ok(current), Ok(remote)) => remote < current,
        _ => false,
    }
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
    allow_downgrade: bool,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let endpoint = channel
        .endpoint()
        .parse()
        .map_err(|e| format!("Invalid updater endpoint: {e}"))?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to set updater endpoint: {e}"))?;

    // The test channel always accepts any difference. Its builds are stamped
    // `<major>.<minor>.<ci-run-number>`, so they climb monotonically and the
    // default "remote > current" rule would usually work — but `!=` also keeps
    // the channel tracking the tip when a run is re-published under the same
    // number, and lets a stale test build move onto a fresh one.
    //
    // The release channel keeps the strict rule unless the user has explicitly
    // asked to roll back. That asymmetry is the point: a downgrade must never
    // be able to install itself behind the user's back, but a user who wants
    // off the test channel must not be stranded on it either.
    if matches!(channel, Channel::Test) || allow_downgrade {
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
    allow_downgrade: bool,
) -> Result<Option<UpdateInfo>, String> {
    let Some(update) = check_with(&app, channel, allow_downgrade).await? else {
        return Ok(None);
    };

    Ok(Some(UpdateInfo {
        is_downgrade: is_downgrade(&update.current_version, &update.version),
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
pub async fn updater_install(
    app: AppHandle,
    channel: Channel,
    allow_downgrade: bool,
) -> Result<(), String> {
    let Some(update) = check_with(&app, channel, allow_downgrade).await? else {
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


#[cfg(test)]
mod tests {
    use super::is_downgrade;

    #[test]
    fn older_remote_is_a_downgrade() {
        // The case this exists for: a test build rolling back to the release.
        assert!(is_downgrade("1.0.20", "1.0.0"));
    }

    #[test]
    fn newer_remote_is_not() {
        assert!(!is_downgrade("1.0.0", "1.0.20"));
    }

    #[test]
    fn the_same_version_is_not() {
        assert!(!is_downgrade("1.0.0", "1.0.0"));
    }

    #[test]
    fn unparseable_versions_are_not_downgrades() {
        assert!(!is_downgrade("not-a-version", "1.0.0"));
        assert!(!is_downgrade("1.0.0", "not-a-version"));
    }
}
