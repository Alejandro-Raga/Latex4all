//! Peer-to-peer sync (crates/l4a-sync), alongside the relay while it's
//! being tried: off unless `L4A_P2P=1` or the file `sync/enabled` exists in
//! the app's data folder. Every update sent to the relay is also written,
//! encrypted the same way, to the project's peer-to-peer log; updates from
//! other members arrive through it too, and go to the editor like the
//! relay's (Yjs takes each once, whichever way it came).
//!
//! Members find each other through the shared document: each copy writes
//! its sync id there (the webview does), and passes the ids it sees here.

use l4a_sync::{Change, Node};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, OnceCell};

static NODE: OnceCell<Arc<Node>> = OnceCell::const_new();
/// The identity file was damaged at start and a new one made (P02).
static KEY_REPLACED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn base() -> Option<PathBuf> {
    Some(dirs::data_local_dir()?.join("Latex4All").join("sync"))
}

/// Settings → Sync, kept in `sync/settings.json`.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncSettings {
    /// Peer-to-peer sync on (beta).
    pub enabled: bool,
    /// Where changes wait: `server` (the Latex4All server, as now),
    /// `folder`, `computer` (this one, always on) or `hub` (your own).
    pub storage: String,
    /// The cloud folder chosen, for `folder`.
    pub folder: Option<String>,
    /// The code of your own server, for `hub`.
    pub hub_code: Option<String>,
    /// Projects already given to that hub.
    pub hubbed: Vec<String>,
    /// Whether the choice was made (asked at the first share otherwise).
    pub chosen: bool,
}

pub fn settings() -> SyncSettings {
    base()
        .and_then(|b| std::fs::read(b.join("settings.json")).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save_settings(s: &SyncSettings) -> anyhow::Result<()> {
    let dir = base().ok_or_else(|| anyhow::anyhow!("no data folder"))?;
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join("settings.json.new");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
    std::fs::rename(tmp, dir.join("settings.json"))?;
    Ok(())
}

pub fn enabled() -> bool {
    std::env::var("L4A_P2P").is_ok_and(|v| v == "1") || settings().enabled
}

/// Cloud folders on this computer (Dropbox, OneDrive, iCloud Drive, Google
/// Drive, Seafile…), to offer for `folder`.
pub fn cloud_folders() -> Vec<String> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let mut found = Vec::new();
    let mut look = |p: PathBuf| {
        if p.is_dir() && !found.contains(&p) {
            found.push(p);
        }
    };
    // macOS keeps most under ~/Library/CloudStorage.
    if let Ok(items) = std::fs::read_dir(home.join("Library/CloudStorage")) {
        for item in items.flatten() {
            look(item.path());
        }
    }
    look(home.join("Library/Mobile Documents/com~apple~CloudDocs"));
    if let Ok(items) = std::fs::read_dir(&home) {
        for item in items.flatten() {
            let name = item.file_name().to_string_lossy().to_lowercase();
            if ["dropbox", "onedrive", "google drive", "googledrive", "icloud", "seafile", "box", "nextcloud", "pcloud"]
                .iter()
                .any(|k| name.starts_with(k))
            {
                look(item.path());
            }
        }
    }
    for var in ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"] {
        if let Ok(p) = std::env::var(var) {
            look(PathBuf::from(p));
        }
    }
    found.into_iter().map(|p| p.to_string_lossy().to_string()).collect()
}

/// This computer's sync node: its identity kept in the app's data folder.
async fn node() -> anyhow::Result<Arc<Node>> {
    NODE.get_or_try_init(|| async {
        let dir = base().ok_or_else(|| anyhow::anyhow!("no data folder"))?;
        std::fs::create_dir_all(&dir)?;
        let key_file = dir.join("key");
        let key = match std::fs::read(&key_file) {
            Ok(b) if b.len() == 32 => {
                let bytes: [u8; 32] = b[..32].try_into()?;
                iroh::SecretKey::from_bytes(&bytes)
            }
            other => {
                if other.is_ok() {
                    // Damaged: kept aside, a new identity made.
                    let _ = std::fs::rename(&key_file, dir.join("key.damaged"));
                    KEY_REPLACED.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                let k = iroh::SecretKey::generate();
                std::fs::write(&key_file, k.to_bytes())?;
                k
            }
        };
        let node = Node::start(key, iroh::endpoint::presets::N0).await?;
        anyhow::Ok(Arc::new(node))
    })
    .await
    .cloned()
}

/// Keeps a project's file (its sealed bytes, as the relay has them) for
/// peer-to-peer too; its name there, if peer-to-peer is running.
pub fn keep_blob(project: &str, sealed: &[u8]) -> Option<String> {
    NODE.get()?.project(project)?.put_blob(sealed).ok()
}

/// A project's file by its peer-to-peer name: from here, or asked of the
/// members (and the hub) for up to `wait`.
pub async fn fetch_blob(project: &str, name: &str, wait: std::time::Duration) -> Option<Vec<u8>> {
    let log = NODE.get()?.project(project)?;
    if let Some(b) = log.blob(name) {
        return Some(b);
    }
    let mut changes = log.subscribe();
    log.want_blob(name);
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        if let Some(b) = log.blob(name) {
            return Some(b);
        }
        match tokio::time::timeout_at(deadline, changes.recv()).await {
            Ok(Ok((Change::Blob(n), _))) if n == name => return log.blob(name),
            Ok(Ok(_)) | Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {}
            _ => return log.blob(name),
        }
    }
}

/// The Latex4All server's public hub (`<id>.public`), beside the relay.
pub const DEFAULT_HUB: Option<&str> = None;

/// How peer-to-peer sync stands for a project, now and then.
#[derive(Clone, Debug, serde::Serialize)]
pub struct Status {
    /// Other members this copy knows of.
    pub members: usize,
    /// Connected to right now.
    pub connected: usize,
    /// Known to lack some of this copy's changes.
    pub waiting: usize,
    /// Problem codes now (docs/sync.md, "Error codes").
    pub problems: Vec<String>,
}

impl Status {
    fn problem(code: &str) -> Self {
        Status { members: 0, connected: 0, waiting: 0, problems: vec![code.to_string()] }
    }
}

/// After a clash (this identity in use on another computer too): a new one
/// for the next start, so the two stop writing as one.
fn renew_identity() {
    if let Some(dir) = base() {
        let k = iroh::SecretKey::generate();
        let _ = std::fs::write(dir.join("key"), k.to_bytes());
    }
}

/// For "this computer as a server": every shared project this computer has
/// synced, opened at start and kept in sync (with all its files), whether
/// or not a window has it open.
pub fn serve_all() {
    let s = settings();
    if !enabled() || s.storage != "computer" {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let Ok(node) = node().await else { return };
        let Some(dir) = base().map(|b| b.join("projects")) else { return };
        let Ok(items) = std::fs::read_dir(dir) else { return };
        for item in items.flatten() {
            let Ok(id) = std::fs::read_to_string(item.path().join("id")) else { continue };
            if node.project(&id).is_some() {
                continue;
            }
            // Its tokens are kept beside it, so none is needed here.
            if let Ok(log) = node.open(&id, &[], item.path()) {
                log.keep_all_blobs(true);
            }
        }
    });
}

/// Whether closing the last window should keep the app running.
pub fn keeps_running() -> bool {
    enabled() && settings().storage == "computer"
}

/// What the relay side hands to a project's peer-to-peer sync.
pub enum Input {
    /// An update made here (plain; sealed before it's written).
    Publish(Vec<u8>),
    /// Members' sync ids, from the shared document.
    Peers(Vec<String>),
}

/// Starts a project's peer-to-peer sync. `seal` and `open` encrypt and
/// decrypt as for the relay; `deliver` gets each update from another
/// member (plain); `ready` gets this copy's sync id, for the document.
pub fn start(
    project: String,
    token: Vec<u8>,
    // The project's relay access token: proves membership to the public hub.
    access: Vec<u8>,
    seal: impl Fn(&[u8]) -> Option<Vec<u8>> + Send + 'static,
    open: impl Fn(&[u8]) -> Option<Vec<u8>> + Send + 'static,
    deliver: impl Fn(Vec<u8>) + Send + 'static,
    ready: impl FnOnce(String) + Send + 'static,
    status: impl Fn(Status) + Send + 'static,
) -> mpsc::UnboundedSender<Input> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Input>();
    tauri::async_runtime::spawn(async move {
        let node = match node().await {
            Ok(node) => node,
            Err(e) => {
                eprintln!("[sync] peer-to-peer can't start: {e:#}");
                status(Status::problem("P01"));
                return;
            }
        };
        let Some(dir) = base().map(|b| b.join("projects").join(safe(&project))) else { return };
        // Opened once per run (a server opens them all at start), so two
        // never write the same files.
        let log = match node.project(&project) {
            Some(log) => log,
            None => match node.open(&project, &token, &dir) {
                Ok(log) => log,
                Err(e) => {
                    eprintln!("[sync] couldn't open the project's log: {e:#}");
                    status(Status::problem("F02"));
                    return;
                }
            },
        };
        // Problems found while setting up, reported with every status.
        let mut setup: Vec<String> = Vec::new();
        let _ = std::fs::write(dir.join("id"), &project);
        ready(node.id().to_string());
        // The always-on store chosen in Settings → Sync.
        let choice = settings();
        match choice.storage.as_str() {
            "folder" => {
                if let Some(root) = choice.folder.as_deref().map(PathBuf::from) {
                    // A co-author's shared folder, wherever their service put
                    // it; otherwise one of ours, in the app's own subfolder.
                    let place = l4a_sync::folder::find(&[root.clone()], &project)
                        .unwrap_or_else(|| root.join("Latex4All").join(safe(&project)));
                    if !root.is_dir() {
                        setup.push("F01".into());
                    } else if let Err(e) = node.use_folder(&project, place, dir.join("folder-state.json"), std::time::Duration::from_secs(30)) {
                        eprintln!("[sync] folder: {e:#}");
                        setup.push("F02".into());
                    }
                }
            }
            "computer" => log.keep_all_blobs(true),
            "hub" => {
                if let Some(code) = choice.hub_code.as_deref() {
                    if !choice.hubbed.contains(&project) {
                        match node.add_to_hub(code, &project, &token, None).await {
                            Ok(()) => {
                                let mut s = settings();
                                s.hubbed.push(project.clone());
                                let _ = save_settings(&s);
                            }
                            Err(e) => {
                                eprintln!("[sync] hub: {e:#}");
                                let text = format!("{e:#}").to_lowercase();
                                setup.push(if text.contains("pair") || text.contains("secret") || text.contains("refus") {
                                    "H02".into()
                                } else {
                                    "H01".into()
                                });
                            }
                        }
                    }
                    // The hub, as a member to reach.
                    if let Some(hub) = code.split('.').next().and_then(|h| h.parse::<iroh::EndpointId>().ok()) {
                        let _ = node.join(&project, hub).await;
                    }
                }
            }
            _ => {}
        }
        // The Latex4All server's hub, for every project whatever else is
        // chosen: while anyone in a group uses the server, everyone syncs
        // with it too, so a group split between a folder and the server
        // never drifts apart. Added once; reached as a member after.
        if let Some(code) = DEFAULT_HUB {
            let mark = format!("pub:{project}");
            if !settings().hubbed.contains(&mark) {
                match node.add_to_public_hub(code, &project, &token, &access, None).await {
                    Ok(()) => {
                        let mut s = settings();
                        s.hubbed.push(mark);
                        let _ = save_settings(&s);
                    }
                    Err(e) => eprintln!("[sync] Latex4All server hub: {e:#}"),
                }
            } else if let Some(hub) = code.split('.').next().and_then(|h| h.parse::<iroh::EndpointId>().ok()) {
                let _ = node.join(&project, hub).await;
            }
        }
        let mut changes = log.subscribe();
        let mut every = tokio::time::interval(std::time::Duration::from_secs(10));
        let mut renewed = false;
        // What arrived while the app was closed.
        for e in log.entries() {
            if e.author != node.id() {
                if let Some(plain) = open(&e.data) {
                    deliver(plain);
                }
            }
        }
        loop {
            tokio::select! {
                _ = every.tick() => {
                    let members = log.members();
                    let waiting = members.keys().filter(|m| log.waiting_for(m) > 0).count();
                    let connected = members.keys().filter(|m| node.is_syncing_with(&project, m)).count();
                    let mut problems = setup.clone();
                    if log.clashed() {
                        if !renewed {
                            renewed = true;
                            renew_identity();
                        }
                        problems.push("P03".into());
                    }
                    if KEY_REPLACED.load(std::sync::atomic::Ordering::Relaxed) {
                        problems.push("P02".into());
                    }
                    if log.refused() > 0 {
                        problems.push("P04".into());
                    }
                    status(Status { members: members.len(), connected, waiting, problems });
                }
                input = rx.recv() => match input {
                    None => return,
                    Some(Input::Publish(update)) => {
                        if let Some(sealed) = seal(&update) {
                            let _ = node.write(&project, sealed);
                        }
                    }
                    Some(Input::Peers(ids)) => {
                        for id in ids {
                            if id == node.id() {
                                continue;
                            }
                            if let Ok(peer) = id.parse::<iroh::EndpointId>() {
                                let _ = node.join(&project, peer).await;
                            }
                        }
                    }
                },
                change = changes.recv() => match change {
                    Ok((Change::Entry(e), Some(_))) => {
                        if let Some(plain) = open(&e.data) {
                            deliver(plain);
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Fell behind: everything again (Yjs ignores repeats).
                        for e in log.entries() {
                            if e.author != node.id() {
                                if let Some(plain) = open(&e.data) {
                                    deliver(plain);
                                }
                            }
                        }
                    }
                    Err(_) => return,
                },
            }
        }
    });
    tx
}

fn safe(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}
