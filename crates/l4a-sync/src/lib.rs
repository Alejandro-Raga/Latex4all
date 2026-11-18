//! Latex4All's sync between copies of the app: no accounts, no central
//! server. See `docs/sync.md` for the design.
//!
//! - [`log`]: a shared project as a log of encrypted changes, each named by
//!   its author and a number; what a copy has, as a version vector.
//! - [`store`]: that log on disk.
//! - [`sign`]: each entry signed by its author, checked by everyone.
//! - [`members`]: what each member has, as far as a copy knows.
//! - [`proof`]: two copies show each other they hold the project's key
//!   without sending it.
//! - [`session`]: a live sync between two copies over an iroh connection.
//! - [`Node`]: a copy of the app on the network: its projects, the members
//!   it's joined, and those who join it.

pub mod log;
pub mod members;
pub mod proof;
pub mod session;
pub mod sign;
pub mod store;

use anyhow::Context;
use iroh::endpoint::presets::Preset;
use iroh::{Endpoint, EndpointAddr, SecretKey};
use log::{Entry, Log, Vector};
use members::Members;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    /// The other members this copy knows of (their node ids), kept on disk
    /// so it can reach them again next time.
    peers: Mutex<BTreeSet<String>>,
    peers_file: PathBuf,
    /// Each new entry, and which copy it came from (none: made here).
    changes: broadcast::Sender<(Entry, Option<String>)>,
    /// This copy's id, to tell its own entries.
    me: String,
    /// What each member has, as far as this copy knows; kept on disk.
    members: Mutex<Members>,
    members_file: PathBuf,
    members_saved: AtomicU64,
    /// Entries refused for a bad signature.
    refused: AtomicU64,
    /// Another computer writes with this copy's identity (its app data was
    /// copied over): this copy must stop writing and take a new one.
    clashed: AtomicBool,
}

impl Project {
    /// A project kept in `dir`, as seen by copy `me`.
    fn open(id: &str, token: &[u8], dir: &Path, me: &str) -> anyhow::Result<Self> {
        let store = Store::open(dir)?;
        let log = store.load()?;
        let peers_file = dir.join("peers.json");
        let peers: BTreeSet<String> = std::fs::read(&peers_file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let members_file = dir.join("members.json");
        let members: Members = std::fs::read(&members_file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let (changes, _) = broadcast::channel(1024);
        Ok(Project {
            members: Mutex::new(members),
            members_file,
            members_saved: AtomicU64::new(0),
            id: id.to_string(),
            token: token.to_vec(),
            log: Mutex::new(log),
            store,
            peers: Mutex::new(peers),
            peers_file,
            changes,
            me: me.to_string(),
            refused: AtomicU64::new(0),
            clashed: AtomicBool::new(false),
        })
    }

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

    /// What each other member has, as far as this copy knows.
    pub fn members(&self) -> Members {
        self.members.lock().unwrap().clone()
    }

    /// How many of this copy's entries `member` is known to lack: changes
    /// that haven't reached them yet.
    pub fn waiting_for(&self, member: &str) -> u64 {
        let theirs = self.members.lock().unwrap().get(member).map(|k| k.has.clone()).unwrap_or_default();
        members::lacking(&self.vector(), &theirs)
    }

    /// This copy's account of everyone, itself included, to pass on.
    fn account(&self) -> Members {
        let mut all = self.members();
        all.insert(self.me.clone(), members::Known { has: self.vector(), at: members::now() });
        all
    }

    /// What a member has (they said so, or another copy did).
    fn heard(&self, member: &str, has: &Vector, others: Option<&Members>) {
        let mut m = self.members.lock().unwrap();
        let mut changed = false;
        if member != self.me {
            changed |= members::note(&mut m, member, has, members::now());
        }
        if let Some(others) = others {
            changed |= members::merge(&mut m, others, &self.me);
        }
        // Saved when something's new, at most every 30 seconds while it
        // only moves forward (acknowledgements come with every change).
        let now = members::now();
        let last = self.members_saved.load(Ordering::Relaxed);
        if changed && (others.is_some() || now >= last + 30) {
            if let Ok(json) = serde_json::to_vec(&*m) {
                let _ = std::fs::write(&self.members_file, json);
                self.members_saved.store(now, Ordering::Relaxed);
            }
        }
        drop(m);
        if let Some(others) = others {
            self.learn(others.keys().cloned(), &self.me.clone());
        }
    }

    /// The members this copy knows of: those who wrote, and those met.
    pub fn known_peers(&self) -> Vec<String> {
        let mut all = self.peers.lock().unwrap().clone();
        all.extend(self.members.lock().unwrap().keys().cloned());
        for author in self.vector().keys() {
            if *author != self.me {
                all.insert(author.clone());
            }
        }
        all.into_iter().collect()
    }

    /// Members heard of from another copy, kept to reach later.
    fn learn(&self, ids: impl IntoIterator<Item = String>, me: &str) {
        let mut peers = self.peers.lock().unwrap();
        let before = peers.len();
        for id in ids {
            if id != me && !id.is_empty() {
                peers.insert(id);
            }
        }
        if peers.len() != before {
            if let Ok(json) = serde_json::to_vec(&*peers) {
                let _ = std::fs::write(&self.peers_file, json);
            }
        }
    }

    /// Everything, in order by author: to rebuild the document from.
    pub fn entries(&self) -> Vec<Entry> {
        self.log.lock().unwrap().missing_for(&Vector::new())
    }

    /// New changes as they arrive (made here or received).
    pub fn subscribe(&self) -> broadcast::Receiver<(Entry, Option<String>)> {
        self.changes.subscribe()
    }

    /// Entries refused so far for not being signed by their author.
    pub fn refused(&self) -> u64 {
        self.refused.load(Ordering::Relaxed)
    }

    /// Whether another computer writes as this one (its app data copied
    /// over). Then this copy writes nothing more under its id; the app makes
    /// it a new identity and opens the project again.
    pub fn clashed(&self) -> bool {
        self.clashed.load(Ordering::Relaxed)
    }

    /// An entry from another copy: checked, kept (on disk first) and passed
    /// on, if it's new here.
    fn receive(&self, entry: Entry, from: &str) -> anyhow::Result<()> {
        if !sign::verify(&self.id, &entry) {
            self.refused.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }
        let mut log = self.log.lock().unwrap();
        if entry.author == self.me {
            // Our own entries coming back are fine; one we didn't write, or
            // one we wrote differently, means another computer has our key.
            let same = log.get(&entry.author, entry.n).is_some_and(|e| e.data == entry.data);
            if !same {
                self.clashed.store(true, Ordering::Relaxed);
            }
            return Ok(());
        }
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

    /// A change made here, signed with this copy's key: on disk, then to
    /// every connected copy.
    fn write(&self, key: &SecretKey, data: Vec<u8>) -> anyhow::Result<Entry> {
        anyhow::ensure!(!self.clashed(), "another computer is using this copy's identity");
        let mut log = self.log.lock().unwrap();
        let n = log.vector().get(&self.me).copied().unwrap_or(0) + 1;
        let entry = sign::entry(key, &self.id, n, data);
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
    key: SecretKey,
    me: String,
    projects: Arc<Mutex<HashMap<String, Arc<Project>>>>,
    /// Live syncs, by project and member, so each is reached once.
    live: Arc<Mutex<HashSet<(String, String)>>>,
    /// How often to try members not connected yet.
    retry: Duration,
}

impl Node {
    /// Starts this copy with its identity, and answers other copies.
    pub async fn start(secret: SecretKey, preset: impl Preset) -> anyhow::Result<Self> {
        Self::start_with(secret, preset, None, Duration::from_secs(30)).await
    }

    /// As [`Node::start`], with addresses known in advance (tests, or a
    /// local network) and how often to retry members not reached.
    pub async fn start_with(
        secret: SecretKey,
        preset: impl Preset,
        lookup: Option<iroh::address_lookup::memory::MemoryLookup>,
        retry: Duration,
    ) -> anyhow::Result<Self> {
        let key = secret.clone();
        let mut builder = Endpoint::builder(preset)
            .secret_key(secret)
            .alpns(vec![ALPN.to_vec()]);
        if let Some(lookup) = lookup {
            builder = builder.address_lookup(lookup);
        }
        let endpoint = builder.bind().await.context("starting sync")?;
        let me = endpoint.id().to_string();
        let projects: Arc<Mutex<HashMap<String, Arc<Project>>>> = Default::default();
        let live: Arc<Mutex<HashSet<(String, String)>>> = Default::default();
        let accepting = endpoint.clone();
        let (found, me2, live2) = (projects.clone(), me.clone(), live.clone());
        tokio::spawn(async move {
            while let Some(incoming) = accepting.accept().await {
                let (found, me, live) = (found.clone(), me2.clone(), live2.clone());
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else { return };
                    let them = conn.remote_id().to_string();
                    let mut joined: Option<(String, String)> = None;
                    let _ = session::answer(conn, me, |id| {
                        let project = found.lock().unwrap().get(id).cloned()?;
                        // Reached by them: no need to reach them too.
                        let key = (id.to_string(), them.clone());
                        live.lock().unwrap().insert(key.clone());
                        joined = Some(key);
                        Some(project)
                    })
                    .await;
                    if let Some(key) = joined {
                        live.lock().unwrap().remove(&key);
                    }
                });
            }
        });
        Ok(Self { endpoint, key, me, projects, live, retry })
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
        let project = Arc::new(Project::open(id, token, dir.as_ref(), &self.me)?);
        self.projects.lock().unwrap().insert(id.to_string(), project.clone());
        self.keep_connected(project.clone());
        Ok(project)
    }

    /// In the background, for as long as the project is open: every member
    /// this copy knows of and isn't syncing with yet is tried again.
    fn keep_connected(&self, project: Arc<Project>) {
        let (endpoint, me, live, projects) = (
            self.endpoint.clone(),
            self.me.clone(),
            self.live.clone(),
            self.projects.clone(),
        );
        let retry = self.retry;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(retry).await;
                let open = projects
                    .lock()
                    .unwrap()
                    .get(&project.id)
                    .is_some_and(|p| Arc::ptr_eq(p, &project));
                if !open {
                    return;
                }
                for peer in project.known_peers() {
                    let Ok(id) = peer.parse::<iroh::EndpointId>() else { continue };
                    spawn_sync(&endpoint, &me, &live, project.clone(), id);
                }
            }
        });
    }

    /// A change made here to a project: kept and sent to every copy
    /// connected to it.
    pub fn write(&self, id: &str, data: Vec<u8>) -> anyhow::Result<Entry> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        project.write(&self.key, data)
    }

    /// Joins the copy at `peer` for a project: catches up both ways, then
    /// stays connected, passing changes as they come, in the background.
    pub async fn join(&self, id: &str, peer: impl Into<EndpointAddr>) -> anyhow::Result<()> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        let peer: EndpointAddr = peer.into();
        let key = (id.to_string(), peer.id.to_string());
        if !self.live.lock().unwrap().insert(key.clone()) {
            return Ok(()); // Already syncing with it.
        }
        let conn = match self.endpoint.connect(peer, ALPN).await {
            Ok(conn) => conn,
            Err(err) => {
                self.live.lock().unwrap().remove(&key);
                return Err(err).context("reaching the other copy");
            }
        };
        let (me, live) = (self.me.clone(), self.live.clone());
        tokio::spawn(async move {
            let _ = session::dial(conn, me, project).await;
            live.lock().unwrap().remove(&key);
        });
        Ok(())
    }

    /// Whether this copy is syncing a project with a member right now.
    pub fn is_syncing_with(&self, project: &str, peer: &str) -> bool {
        self.live.lock().unwrap().contains(&(project.to_string(), peer.to_string()))
    }

    /// Stops answering and closes every connection.
    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}

/// Starts a sync of `project` with member `peer` (by id), unless one runs.
fn spawn_sync(
    endpoint: &Endpoint,
    me: &str,
    live: &Arc<Mutex<HashSet<(String, String)>>>,
    project: Arc<Project>,
    peer: iroh::EndpointId,
) {
    let key = (project.id.clone(), peer.to_string());
    if key.1 == me || !live.lock().unwrap().insert(key.clone()) {
        return;
    }
    let (endpoint, me, live) = (endpoint.clone(), me.to_string(), live.clone());
    tokio::spawn(async move {
        if let Ok(conn) = endpoint.connect(peer, ALPN).await {
            let _ = session::dial(conn, me, project).await;
        }
        live.lock().unwrap().remove(&key);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(dir: &Path, key: &SecretKey) -> Project {
        Project::open("paper", b"t", dir, &key.public().to_string()).unwrap()
    }

    #[test]
    fn forged_or_altered_entries_are_refused() {
        let (alice, mallory) = (SecretKey::generate(), SecretKey::generate());
        let dir = tempfile::tempdir().unwrap();
        let p = project(dir.path(), &SecretKey::generate());
        let real = sign::entry(&alice, "paper", 1, b"hi".to_vec());
        // Mallory writing as Alice; Alice's entry with its data changed.
        let forged = Entry { author: alice.public().to_string(), ..sign::entry(&mallory, "paper", 1, b"x".to_vec()) };
        let altered = Entry { data: b"HI".to_vec(), ..real.clone() };
        for e in [forged, altered] {
            p.receive(e, "someone").unwrap();
        }
        assert_eq!((p.len(), p.refused()), (0, 2));
        p.receive(real, "someone").unwrap();
        assert_eq!(p.len(), 1);
    }

    #[test]
    fn notices_another_computer_with_its_identity() {
        let key = SecretKey::generate();
        let (d1, d2) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (here, copied) = (project(d1.path(), &key), project(d2.path(), &key));
        let mine = here.write(&key, b"mine".to_vec()).unwrap();
        // Its own entry coming back through another member: fine.
        here.receive(mine, "hub").unwrap();
        assert!(!here.clashed());
        // The same number, written differently on the other computer.
        let theirs = copied.write(&key, b"theirs".to_vec()).unwrap();
        here.receive(theirs, "hub").unwrap();
        assert!(here.clashed());
        assert!(here.write(&key, b"more".to_vec()).is_err(), "writes nothing more as that id");
    }
}
