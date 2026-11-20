//! Latex4All's sync between copies of the app: no accounts, no central
//! server. See `docs/sync.md` for the design.
//!
//! - [`log`]: a shared project as a log of encrypted changes, each named by
//!   its author and a number; what a copy has, as a version vector.
//! - [`store`]: that log on disk.
//! - [`blobs`]: large files, apart from the log, fetched as needed.
//! - [`folder`]: a shared cloud folder as a project's always-on store.
//! - [`sign`]: each entry signed by its author, checked by everyone.
//! - [`members`]: what each member has, as far as a copy knows.
//! - [`proof`]: two copies show each other they hold the project's key
//!   without sending it.
//! - [`rekey`] and [`seal`]: removing a member, with a new key sealed for
//!   each member who stays.
//! - [`session`]: a live sync between two copies over an iroh connection.
//! - [`Node`]: a copy of the app on the network: its projects, the members
//!   it's joined, and those who join it.

pub mod blobs;
pub mod folder;
pub mod hub;
pub mod invite;
pub mod log;
pub mod members;
pub mod proof;
pub mod rekey;
pub mod seal;
pub mod session;
pub mod sign;
pub mod store;

use anyhow::Context;
use iroh::endpoint::presets::Preset;
use iroh::{Endpoint, EndpointAddr, SecretKey};
use log::{Entry, Log, Snapshot, Vector};
use members::Members;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use store::Store;
use tokio::sync::broadcast;

/// The protocol's name on the wire (iroh's ALPN). 2: copies that keep one
/// project's files out of another's (November 2026); copies speaking 1 wrote
/// one project's main.tex into another's, and are no longer synced with.
pub const ALPN: &[u8] = b"latex4all/sync/2";

/// Something new in a project: an entry, or a snapshot (which, if
/// `lacked`, has changes this copy didn't have: the app merges it in).
#[derive(Clone, Debug)]
pub enum Change {
    Entry(Entry),
    Snapshot { snapshot: Snapshot, lacked: bool },
    /// A file (by name) is here now.
    Blob(String),
    /// The creator removed members (or handed the role on): a new epoch,
    /// with its key for this copy (none for a hub). The app encrypts with
    /// it from now on, and keeps the old ones to read what came before.
    Rekey { epoch: u64, key: Option<Vec<u8>>, removed: Vec<String> },
    /// This copy was removed from the project: it no longer syncs.
    Removed,
    /// A member (this copy, or another) was left out of a new epoch without
    /// being removed: the creator's copy didn't know of it yet. The creator
    /// should rekey again, with the same token and key, to include it.
    LeftOut(String),
}

/// What the creator does to remove members, or hand the role on.
pub struct Rekeying {
    pub remove: Vec<String>,
    /// The member who becomes creator; none keeps it.
    pub creator: Option<String>,
    /// The new epoch's membership token and project key (made by the app).
    pub token: Vec<u8>,
    pub key: Vec<u8>,
    /// Members who get the token but not the key: hubs.
    pub token_only: Vec<String>,
}

/// Between a project's syncs: files someone has, and files wanted.
#[derive(Clone, Debug)]
pub(crate) enum BlobNews {
    /// This copy has it now (and which member it came from).
    Have(String, Option<String>),
    Want(String),
}

/// A shared project on this copy: its log (on disk and in memory) and who
/// hears of its changes.
pub struct Project {
    pub id: String,
    /// Its tokens (one per epoch), creator and records; kept on disk.
    membership: Mutex<rekey::Membership>,
    membership_file: PathBuf,
    /// This copy's key: to sign, and to open what's sealed for it.
    key: SecretKey,
    /// New records, to bring connected members up to date.
    pub(crate) rekeys: broadcast::Sender<rekey::Rekey>,
    /// A member newly heard of: passed on to every connected copy.
    pub(crate) roster: broadcast::Sender<()>,
    log: Mutex<Log>,
    store: Store,
    /// The other members this copy knows of (their node ids), kept on disk
    /// so it can reach them again next time.
    peers: Mutex<BTreeSet<String>>,
    peers_file: PathBuf,
    /// Each new entry, and which copy it came from (none: made here).
    changes: broadcast::Sender<(Change, Option<String>)>,
    /// This copy's id, to tell its own entries.
    me: String,
    pub(crate) blobs: blobs::Blobs,
    pub(crate) blob_news: broadcast::Sender<BlobNews>,
    /// Files asked for and not here yet.
    pub(crate) wanted: Mutex<HashSet<String>>,
    /// Fetch every file any member has (a hub), not only those asked for.
    pub(crate) keep_all: AtomicBool,
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
    fn open(id: &str, token: &[u8], dir: &Path, key: &SecretKey) -> anyhow::Result<Self> {
        let me = key.public().to_string();
        let membership_file = dir.join("membership.json");
        let mut membership: rekey::Membership = std::fs::read(&membership_file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if membership.tokens.is_empty() {
            membership.tokens.push(token.to_vec());
        }
        let (rekeys, _) = broadcast::channel(16);
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
        let (blob_news, _) = broadcast::channel(1024);
        Ok(Project {
            blobs: blobs::Blobs::open(dir)?,
            blob_news,
            wanted: Mutex::new(HashSet::new()),
            keep_all: AtomicBool::new(false),
            members: Mutex::new(members),
            members_file,
            members_saved: AtomicU64::new(0),
            id: id.to_string(),
            membership: Mutex::new(membership),
            membership_file,
            key: key.clone(),
            rekeys,
            roster: broadcast::channel(16).0,
            log: Mutex::new(log),
            store,
            peers: Mutex::new(peers),
            peers_file,
            changes,
            me,
            refused: AtomicU64::new(0),
            clashed: AtomicBool::new(false),
        })
    }

    pub fn vector(&self) -> Vector {
        self.log.lock().unwrap().vector()
    }

    pub fn missing_for(&self, theirs: &Vector, their_snap: Option<&Vector>) -> (Option<Snapshot>, Vec<Entry>) {
        self.log.lock().unwrap().missing_for(theirs, their_snap)
    }

    /// Keeps a file of this project's (encrypted by the app), for members
    /// to fetch; returns its name, to refer to it in a change.
    pub fn put_blob(&self, data: &[u8]) -> anyhow::Result<String> {
        let name = self.blobs.put(data)?;
        let _ = self.blob_news.send(BlobNews::Have(name.clone(), None));
        Ok(name)
    }

    /// A file, if it's here.
    pub fn blob(&self, name: &str) -> Option<Vec<u8>> {
        self.blobs.get(name)
    }

    /// Asks connected members for a file (and those who connect later);
    /// [`Change::Blob`] says when it's here.
    pub fn want_blob(&self, name: &str) {
        if self.blobs.has(name) {
            return;
        }
        self.wanted.lock().unwrap().insert(name.to_string());
        let _ = self.blob_news.send(BlobNews::Want(name.to_string()));
    }

    /// Whether to fetch every file members have: for a hub, so it can hand
    /// them on to members who aren't online at the same time.
    pub fn keep_all_blobs(&self, on: bool) {
        self.keep_all.store(on, Ordering::Relaxed);
    }

    /// A file received from `from`: kept if it's what its name says.
    pub(crate) fn receive_blob(&self, name: &str, data: &[u8], from: &str) -> anyhow::Result<()> {
        if !self.blobs.put_named(name, data)? {
            self.refused.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }
        self.wanted.lock().unwrap().remove(name);
        let _ = self.blob_news.send(BlobNews::Have(name.to_string(), Some(from.to_string())));
        let _ = self.changes.send((Change::Blob(name.to_string()), Some(from.to_string())));
        Ok(())
    }

    /// Whether to ask for a file a member has.
    pub(crate) fn should_fetch(&self, name: &str) -> bool {
        !self.blobs.has(name)
            && (self.keep_all.load(Ordering::Relaxed) || self.wanted.lock().unwrap().contains(name))
    }

    /// The latest snapshot: the document as of it, to build on.
    pub fn snapshot(&self) -> Option<Snapshot> {
        self.log.lock().unwrap().snapshot().cloned()
    }

    /// The project's epoch: 0, then one more each time a member is removed.
    pub fn epoch(&self) -> u64 {
        self.membership.lock().unwrap().epoch()
    }

    pub(crate) fn token(&self, epoch: u64) -> Option<Vec<u8>> {
        self.membership.lock().unwrap().token(epoch).map(<[u8]>::to_vec)
    }

    /// Who can remove members: the member who shared the project first, or
    /// whoever they handed the role to.
    pub fn creator(&self) -> Option<String> {
        self.membership.lock().unwrap().creator.clone()
    }

    /// The creator, as the share link says (only taken while none is
    /// known: after that, records say who it is).
    pub fn set_creator(&self, creator: &str) -> anyhow::Result<()> {
        let mut m = self.membership.lock().unwrap();
        if m.creator.is_none() {
            m.creator = Some(creator.to_string());
            self.save_membership(&m)?;
        }
        Ok(())
    }

    /// Whether this copy was removed from the project.
    pub fn removed(&self) -> bool {
        self.membership.lock().unwrap().removed
    }

    /// Records after `epoch`, to bring a member up to date.
    pub(crate) fn rekeys_after(&self, epoch: u64) -> Vec<rekey::Rekey> {
        let m = self.membership.lock().unwrap();
        m.rekeys.iter().filter(|r| r.epoch > epoch).cloned().collect()
    }

    fn save_membership(&self, m: &rekey::Membership) -> anyhow::Result<()> {
        let tmp = self.membership_file.with_extension("json.new");
        std::fs::write(&tmp, serde_json::to_vec(m)?)?;
        std::fs::rename(&tmp, &self.membership_file)?;
        Ok(())
    }

    /// The creator removes members (or hands the role on): a new epoch,
    /// its secret sealed for every member who stays.
    fn rekey(&self, plan: Rekeying) -> anyhow::Result<rekey::Rekey> {
        anyhow::ensure!(
            self.creator().as_deref() == Some(self.me.as_str()),
            "only the project's creator can remove members"
        );
        // Gathered before taking the lock: these take it themselves.
        let (known, vector) = (self.known_peers(), self.vector());
        let creator = plan.creator.unwrap_or_else(|| self.me.clone());
        let mut stay: BTreeSet<String> = known.into_iter().collect();
        stay.insert(creator.clone());
        stay.remove(&self.me);
        for gone in &plan.remove {
            stay.remove(gone);
        }
        let mut sealed = BTreeMap::new();
        for member in stay {
            let key = (!plan.token_only.contains(&member)).then(|| plan.key.clone());
            let secret = postcard::to_stdvec(&rekey::Secret { token: plan.token.clone(), key })?;
            sealed.insert(member.clone(), seal::seal(&member, &secret)?);
        }
        let mut m = self.membership.lock().unwrap();
        let record = rekey::sign(
            &self.key,
            &self.id,
            rekey::Rekey {
                epoch: m.epoch() + 1,
                author: String::new(),
                creator: creator.clone(),
                removed: plan.remove,
                vector,
                sealed,
                sig: Vec::new(),
            },
        )?;
        m.tokens.push(plan.token);
        m.creator = Some(creator);
        m.rekeys.push(record.clone());
        self.save_membership(&m)?;
        drop(m);
        let _ = self.rekeys.send(record.clone());
        Ok(record)
    }

    /// A record from another copy: checked against the chain, and opened if
    /// it's sealed for this copy. Returns whether it moved this copy on.
    pub(crate) fn receive_rekey(&self, r: rekey::Rekey) -> anyhow::Result<bool> {
        let mut m = self.membership.lock().unwrap();
        let (epoch, creator) = m.chain_end();
        let creator = creator.unwrap_or_default().to_string();
        if !rekey::verify(&self.id, &r, epoch, &creator) {
            return Ok(false);
        }
        let opened = r
            .sealed
            .get(&self.me)
            .and_then(|s| seal::open(&self.key, s))
            .and_then(|b| postcard::from_bytes::<rekey::Secret>(&b).ok());
        let Some(secret) = opened else {
            if r.removed.contains(&self.me) {
                m.removed = true;
                self.save_membership(&m)?;
                drop(m);
                let _ = self.changes.send((Change::Removed, None));
            } else {
                // Not removed, only missed: kept, waiting for the creator
                // to include it in a later one.
                m.pending.push(r);
                self.save_membership(&m)?;
                drop(m);
                self.left_out(&self.me.clone());
            }
            return Ok(false);
        };
        // Records that missed it first: their epochs pass with no token
        // (it can't prove membership as of them, and needn't).
        for skipped in std::mem::take(&mut m.pending) {
            m.tokens.push(Vec::new());
            m.creator = Some(skipped.creator.clone());
            m.rekeys.push(skipped);
        }
        m.tokens.push(secret.token);
        m.creator = Some(r.creator.clone());
        m.rekeys.push(r.clone());
        self.save_membership(&m)?;
        drop(m);
        let change = Change::Rekey { epoch: r.epoch, key: secret.key, removed: r.removed.clone() };
        let _ = self.changes.send((change, None));
        let _ = self.rekeys.send(r);
        Ok(true)
    }

    fn snapshot_covers(&self) -> Option<Vector> {
        self.log.lock().unwrap().snapshot().map(|s| s.covers.clone())
    }

    /// Drops the entries the snapshot covers, if every member who has been
    /// heard from in the last `active_within` seconds is known to have them
    /// (one longer gone gets the snapshot instead, as a newcomer would).
    /// Returns how many were dropped.
    pub fn prune(&self, active_within: u64) -> anyhow::Result<usize> {
        let Some(covers) = self.snapshot_covers() else { return Ok(0) };
        let since = members::now().saturating_sub(active_within);
        let everyone_has = self
            .members
            .lock()
            .unwrap()
            .values()
            .filter(|k| k.at >= since)
            .all(|k| log::covers(&k.has, &covers));
        if !everyone_has {
            return Ok(0);
        }
        let mut log = self.log.lock().unwrap();
        let mut smaller = log.clone();
        let dropped = smaller.drop_covered();
        if dropped > 0 {
            self.store.rewrite(&smaller)?;
            *log = smaller;
        }
        Ok(dropped)
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
    pub(crate) fn heard(&self, member: &str, has: &Vector, others: Option<&Members>) {
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
        // Not those removed.
        let m = self.membership.lock().unwrap();
        all.retain(|p| !m.was_removed(p));
        drop(m);
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
        let mut new = Vec::new();
        for id in ids {
            if id != me && !id.is_empty() && peers.insert(id.clone()) {
                new.push(id);
            }
        }
        // A member the latest record missed (not removed): the creator
        // should include it.
        for id in &new {
            let m = self.membership.lock().unwrap();
            let missed = !m.rekeys.is_empty() && !m.stays(id) && !m.was_removed(id);
            drop(m);
            if missed {
                self.left_out(id);
            }
        }
        if peers.len() != before {
            if let Ok(json) = serde_json::to_vec(&*peers) {
                let _ = std::fs::write(&self.peers_file, json);
            }
            let _ = self.roster.send(());
        }
    }

    pub(crate) fn me(&self) -> &str {
        &self.me
    }

    pub(crate) fn left_out(&self, member: &str) {
        let _ = self.changes.send((Change::LeftOut(member.to_string()), None));
    }

    /// Everything, in order by author: to rebuild the document from.
    pub fn entries(&self) -> Vec<Entry> {
        self.log.lock().unwrap().entries()
    }

    /// New changes as they arrive (made here or received).
    pub fn subscribe(&self) -> broadcast::Receiver<(Change, Option<String>)> {
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
    pub(crate) fn receive(&self, entry: Entry, from: &str) -> anyhow::Result<()> {
        if !sign::verify(&self.id, &entry)
            || self.membership.lock().unwrap().refuses(&entry.author, entry.n)
        {
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
        let _ = self.changes.send((Change::Entry(entry), Some(from.to_string())));
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
        let _ = self.changes.send((Change::Entry(entry.clone()), None));
        Ok(entry)
    }

    /// A snapshot from another copy: checked, taken in, kept if it's the
    /// newest, and passed on.
    pub(crate) fn receive_snapshot(&self, s: Snapshot, from: &str) -> anyhow::Result<()> {
        if !sign::verify_snapshot(&self.id, &s) {
            self.refused.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }
        let mut log = self.log.lock().unwrap();
        let (lacked, kept) = log.take_snapshot(s.clone());
        if kept {
            self.store.put_snapshot(&s)?;
        }
        drop(log);
        if lacked || kept {
            let _ = self
                .changes
                .send((Change::Snapshot { snapshot: s, lacked }, Some(from.to_string())));
        }
        Ok(())
    }

    /// A snapshot made here, of the document as of everything this copy
    /// has (`data`, encrypted by the app): kept, then sent to every copy.
    fn write_snapshot(&self, key: &SecretKey, data: Vec<u8>) -> anyhow::Result<Snapshot> {
        let mut log = self.log.lock().unwrap();
        let s = sign::snapshot(key, &self.id, log.vector(), data);
        self.store.put_snapshot(&s)?;
        log.take_snapshot(s.clone());
        drop(log);
        let _ = self
            .changes
            .send((Change::Snapshot { snapshot: s.clone(), lacked: false }, None));
        Ok(s)
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
    /// What answers connections for setting up a hub, if this is one.
    admin: Admin,
}

type Admin = Arc<Mutex<Option<Arc<dyn Fn(iroh::endpoint::Connection) + Send + Sync>>>>;

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
            .alpns(vec![ALPN.to_vec(), hub::ALPN.to_vec()]);
        if let Some(lookup) = lookup {
            builder = builder.address_lookup(lookup);
        }
        let endpoint = builder.bind().await.context("starting sync")?;
        let me = endpoint.id().to_string();
        let projects: Arc<Mutex<HashMap<String, Arc<Project>>>> = Default::default();
        let live: Arc<Mutex<HashSet<(String, String)>>> = Default::default();
        let accepting = endpoint.clone();
        let admin: Admin = Default::default();
        let admin2 = admin.clone();
        let (found, me2, live2) = (projects.clone(), me.clone(), live.clone());
        tokio::spawn(async move {
            while let Some(incoming) = accepting.accept().await {
                let (found, me, live) = (found.clone(), me2.clone(), live2.clone());
                let admin = admin2.clone();
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else { return };
                    if conn.alpn() == hub::ALPN {
                        let handler = admin.lock().unwrap().clone();
                        if let Some(handler) = handler {
                            handler(conn);
                        }
                        return;
                    }
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
        Ok(Self { endpoint, key, me, projects, live, retry, admin })
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
        let project = Arc::new(Project::open(id, token, dir.as_ref(), &self.key)?);
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
                if !open || project.removed() {
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

    /// A snapshot of a project: `data` is the whole document as of
    /// everything this copy has, encrypted by the app. The app should make
    /// one now and then (and whenever a received one `lacked`), so
    /// newcomers needn't read the whole history.
    pub fn snapshot(&self, id: &str, data: Vec<u8>) -> anyhow::Result<Snapshot> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        project.write_snapshot(&self.key, data)
    }

    /// The creator removes members from a project, or hands the role on:
    /// connected members are brought up to date at once, others when they
    /// next connect to anyone who has the record.
    pub fn rekey(&self, id: &str, plan: Rekeying) -> anyhow::Result<()> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        project.rekey(plan)?;
        Ok(())
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

    /// Syncs a project through a shared cloud folder as well, every
    /// `every` and after each change made here, while the project is open.
    /// `state` is a file of this copy's (not in the folder).
    pub fn use_folder(&self, id: &str, folder: PathBuf, state: PathBuf, every: Duration) -> anyhow::Result<()> {
        let project = self.projects.lock().unwrap().get(id).cloned().context("project not open")?;
        let projects = self.projects.clone();
        let mut changes = project.subscribe();
        tokio::spawn(async move {
            loop {
                let open = projects.lock().unwrap().get(&project.id).is_some_and(|p| Arc::ptr_eq(p, &project));
                if !open || project.removed() {
                    return;
                }
                let (p, f, s) = (project.clone(), folder.clone(), state.clone());
                let _ = tokio::task::spawn_blocking(move || folder::sync(&p, &f, &s)).await;
                // Until it's time, or something's made here.
                let _ = tokio::time::timeout(every, async {
                    while let Ok((_, from)) = changes.recv().await {
                        if from.is_none() {
                            break;
                        }
                    }
                })
                .await;
            }
        });
        Ok(())
    }

    /// Answers hub set-up connections (see [`hub`]).
    pub(crate) fn on_admin(&self, handler: Arc<dyn Fn(iroh::endpoint::Connection) + Send + Sync>) {
        *self.admin.lock().unwrap() = Some(handler);
    }

    pub(crate) fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// A project already open on this copy.
    pub fn project(&self, id: &str) -> Option<Arc<Project>> {
        self.projects.lock().unwrap().get(id).cloned()
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
        Project::open("paper", b"t", dir, key).unwrap()
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
