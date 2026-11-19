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

fn base() -> Option<PathBuf> {
    Some(dirs::data_local_dir()?.join("Latex4All").join("sync"))
}

pub fn enabled() -> bool {
    std::env::var("L4A_P2P").is_ok_and(|v| v == "1")
        || base().is_some_and(|b| b.join("enabled").exists())
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
            _ => {
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
    seal: impl Fn(&[u8]) -> Option<Vec<u8>> + Send + 'static,
    open: impl Fn(&[u8]) -> Option<Vec<u8>> + Send + 'static,
    deliver: impl Fn(Vec<u8>) + Send + 'static,
    ready: impl FnOnce(String) + Send + 'static,
) -> mpsc::UnboundedSender<Input> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Input>();
    tauri::async_runtime::spawn(async move {
        let Ok(node) = node().await else { return };
        let Some(dir) = base().map(|b| b.join("projects").join(safe(&project))) else { return };
        let Ok(log) = node.open(&project, &token, &dir) else { return };
        ready(node.id().to_string());
        let mut changes = log.subscribe();
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
