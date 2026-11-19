//! The Latex4All hub, without a window: for a server, a NAS or a Raspberry
//! Pi. `l4a-hub [data folder]` (default `./hub-data`, or `$L4A_HUB_DATA`).
//! Prints the hub code to paste in the app (Settings → Sync), then runs
//! until stopped.
//!
//! `L4A_HUB_PUBLIC=1` makes it public (anyone may add a project they're in);
//! `L4A_RELAY_DATA=<relay's projects folder>` lets it check membership
//! against the relay and bring each project's relay history over.

use iroh::endpoint::presets::N0;
use iroh::SecretKey;
use l4a_sync::{
    hub::{Hub, Options},
    Node,
};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dir: PathBuf = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("L4A_HUB_DATA").ok())
        .unwrap_or_else(|| "hub-data".into())
        .into();
    std::fs::create_dir_all(&dir)?;
    // Its identity, kept so the code stays the same across restarts.
    let key_file = dir.join("key");
    let key = match std::fs::read(&key_file) {
        Ok(b) if b.len() == 32 => SecretKey::from_bytes(b[..32].try_into()?),
        _ => {
            let k = SecretKey::generate();
            std::fs::write(&key_file, k.to_bytes())?;
            k
        }
    };
    let options = Options {
        public: std::env::var("L4A_HUB_PUBLIC").is_ok_and(|v| v == "1"),
        relay: std::env::var("L4A_RELAY_DATA").ok().map(PathBuf::from),
    };
    let hub = Hub::start_with(Node::start(key, N0).await?, &dir, options.clone())?;
    println!("Latex4All hub running. {} project(s).", hub.projects().len());
    println!();
    if options.public {
        println!("Public hub (apps add their projects themselves). Its code:");
    } else {
        println!("Hub code (paste it in Latex4All → Settings → Sync → Your own server):");
    }
    println!();
    println!("  {}", hub.code());
    println!();
    tokio::signal::ctrl_c().await?;
    hub.node.close().await;
    Ok(())
}
