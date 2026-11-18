//! Latex4All's sync between copies of the app: no accounts, no central
//! server. See `docs/sync.md` for the design.
//!
//! - [`log`]: a shared project as a log of encrypted changes, each named by
//!   its author and a number; what a copy has, as a version vector.
//! - [`store`]: that log on disk.
//! - [`proof`]: two copies show each other they hold the project's key
//!   without sending it.
//! - [`session`]: a live sync between two copies over an iroh connection.
//! - [`Node`]: a copy of the app on the network: its projects, the members
//!   it's joined, and those who join it.

pub mod log;
pub mod proof;
pub mod session;
pub mod store;

use anyhow::Context;
use iroh::endpoint::presets::Preset;
use iroh::{Endpoint, EndpointAddr, SecretKey};
use log::{Entry, Log, Vector};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use store::Store;
use tokio::sync::broadcast;

/// The protocol's name on the wire (iroh's ALPN).
pub const ALPN: &[u8] = b"latex4all/sync/1";

/// A shared project on this copy: its log (on disk and in memory) and who
/// hears of its changes.
pub struct Project {
    pub id: String,
    /// Derived from the project's key; proves membership.
    pub token: Vec<u8>,
    log: Mutex<Log>,
    store: Store,
    /// Each new entry, and which copy it came from (none: made here).
    changes: broadcast::Sender<(Entry, Option<String>)>,
}

impl Project {
    pub fn vector(&self) -> Vector {
        self.log.lock().unwrap().vector()
    }

    pub fn missing_for(&self, theirs: &Vector) -> Vec<Entry> {
        self.log.lock().unwrap().missing_for(theirs)
    }

    pub fn len(&self) -> usize {
        self.log.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Everything, in order by author: to rebuild the document from.
    pub fn entries(&self) -> Vec<Entry> {
        self.log.lock().unwrap().missing_for(&Vector::new())
    }

    /// New changes as they arrive (made here or received).
    pub fn subscribe(&self) -> broadcast::Receiver<(Entry, Option<String>)> {
        self.changes.subscribe()
    }

    /// An entry from another copy: kept (on disk first) and passed on, if
    /// it's new here.
    fn receive(&self, entry: Entry, from: &str) -> anyhow::Result<()> {
        let mut log = self.log.lock().unwrap();
        let next = log.vector().get(&entry.author).copied().unwrap_or(0) + 1;
        if entry.n != next {
            return Ok(());
        }
        self.store.append(&entry)?;
        log.add(entry.clone());
        drop(log);
        let _ = self.changes.send((entry, Some(from.to_string())));
        Ok(())
    }

    /// A change made here, by `me`: on disk, then to every connected copy.
    fn write(&self, me: &str, data: Vec<u8>) -> anyhow::Result<Entry> {
        let mut log = self.log.lock().unwrap();
        let n = log.vector().get(me).copied().unwrap_or(0) + 1;
        let entry = Entry { author: me.to_string(), n, data };
        self.store.append(&entry)?;
        log.add(entry.clone());
        drop(log);
        let _ = self.changes.send((entry.clone(), None));
        Ok(entry)
    }
}

/// A copy of the app on the network.
pub struct Node {
    endpoint: Endpoint,
    me: String,
    projects: Arc<Mutex<HashMap<String, Arc<Project>>>>,
}

impl Node {
    /// Starts this copy with its identity, and answers other copies.
    pub async fn start(secret: SecretKey, preset: impl Preset) -> anyhow::Result<Self> {
        let endpoint = Endpoint::builder(preset)
            .secret_key(secret)
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .context("starting sync")?;
        let me = endpoint.id().to_string();
        let projects: Arc<Mutex<HashMap<String, Arc<Project>>>> = Default::default();
        let accepting = endpoint.clone();
        let (found, me2) = (projects.clone(), me.clone());
        tokio::spawn(async move {
            while let Some(incoming) = accepting.accept().await {
                let (found, me) = (found.clone(), me2.clone());
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else { return };
                    let _ = session::answer(conn, me, |id| found.lock().unwrap().get(id).cloned()).await;
                });
            }
        });
        Ok(Self { endpoint, me, projects })
    }

    /// This copy's id: its public key.
    pub fn id(&self) -> &str {
        &self.me
    }

    /// How to reach this copy (for a link, or a test).
    pub fn addr(&self) -> EndpointAddr {
        self.endpoint.addr()
    }

    /// Opens a shared project kept in `dir`, with what's already there.
    pub fn open(&self, id: &str, token: &[u8], dir: impl AsRef<Path>) -> anyhow::Result<Arc<Project>> {
        let store = Store::open(dir)?;
        let log = store.load()?;
        let (changes, _) = broadcast::channel(1024);
        let project = Arc::new(Project {
            id: id.to_string(),
            token: token.to_vec(),
            log: Mutex::new(log),
            store,
            changes,
        });
        self.projects.lock().unwrap().insert(id.to_string(), project.clone());
        Ok(project)
    }

    /// A change made here to a project: kept and sent to every copy
    /// connected to it.
    pub fn write(&self, id: &str, data: Vec<u8>) -> anyhow::Result<Entry> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        project.write(&self.me, data)
    }

    /// Joins the copy at `peer` for a project: catches up both ways, then
    /// stays connected, passing changes as they come, in the background.
    pub async fn join(&self, id: &str, peer: impl Into<EndpointAddr>) -> anyhow::Result<()> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        let conn = self.endpoint.connect(peer, ALPN).await.context("reaching the other copy")?;
        let me = self.me.clone();
        tokio::spawn(async move {
            let _ = session::dial(conn, me, project).await;
        });
        Ok(())
    }

    /// Stops answering and closes every connection.
    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}
