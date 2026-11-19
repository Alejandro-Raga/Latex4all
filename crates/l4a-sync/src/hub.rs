//! A hub: a copy that stays on, keeps every shared project's log and files,
//! and hands changes on between members who aren't online together. It
//! holds each project's membership token, never its key, so it can't read
//! anything.
//!
//! Setting one up: the hub prints a *hub code*, `<its id>.<a secret>`. An
//! app given the code proves it knows the secret once (an HMAC, so the
//! secret never travels) and becomes one of the hub's owners; owners add
//! projects to it. Kept in `<data>/hub.json`; projects in `<data>/projects/`.
//!
//! A *public* hub (the Latex4All server, run beside the relay) takes
//! projects from anyone who proves they're in them: its code is
//! `<its id>.public`, and adding a project needs the project's relay access
//! token, checked against the relay's own record of it. It imports the
//! relay's history of each project (snapshot, updates and files, as the
//! encrypted bytes the relay holds) as its own signed entries, and keeps
//! importing what reaches the relay from copies not yet on peer-to-peer.

use crate::{proof, Node};
use anyhow::{bail, Context};
use hmac::{Hmac, Mac};
use iroh::endpoint::Connection;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const ALPN: &[u8] = b"latex4all/hub/1";

#[derive(Clone, Default, Serialize, Deserialize)]
struct Book {
    secret: Vec<u8>,
    owners: BTreeSet<String>,
    projects: Vec<Added>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Added {
    id: String,
    token: Vec<u8>,
    creator: Option<String>,
    /// The relay's history imported up to this seq (public hubs).
    #[serde(default)]
    imported: u64,
    /// The relay's files already imported.
    #[serde(default)]
    imported_blobs: BTreeSet<String>,
}

/// How a hub runs.
#[derive(Clone, Default)]
pub struct Options {
    /// Takes projects from anyone holding their relay access token.
    pub public: bool,
    /// The relay's data folder (its `projects/`), to check access against
    /// and import history from.
    pub relay: Option<PathBuf>,
}

/// The code that marks a public hub.
pub const PUBLIC: &str = "public";

#[derive(Serialize, Deserialize)]
enum Ask {
    /// Proof of the code's secret (empty for an owner already).
    Hello { proof: Vec<u8> },
    Add { id: String, token: Vec<u8>, creator: Option<String> },
    /// To a public hub: proof of membership is the relay access token.
    AddWithAccess { id: String, token: Vec<u8>, creator: Option<String>, access: Vec<u8> },
}

#[derive(Serialize, Deserialize)]
enum Reply {
    Ok,
    No(String),
}

fn pair_proof(secret: &[u8], client: &str, hub: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("any key length");
    mac.update(b"latex4all-hub-pair");
    mac.update(client.as_bytes());
    mac.update(b"|");
    mac.update(hub.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

fn safe(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

async fn send<T: Serialize>(s: &mut iroh::endpoint::SendStream, v: &T) -> anyhow::Result<()> {
    let body = postcard::to_stdvec(v)?;
    s.write_all(&(body.len() as u32).to_be_bytes()).await?;
    s.write_all(&body).await?;
    Ok(())
}

async fn recv<T: for<'a> Deserialize<'a>>(r: &mut iroh::endpoint::RecvStream) -> anyhow::Result<T> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).await?;
    let len = u32::from_be_bytes(len) as usize;
    anyhow::ensure!(len <= 1 << 20, "too large");
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok(postcard::from_bytes(&body)?)
}

pub struct Hub {
    pub node: Arc<Node>,
    dir: PathBuf,
    book: Mutex<Book>,
    options: Options,
}

fn sha256_hex(b: &[u8]) -> String {
    use sha2::Digest;
    hex(&Sha256::digest(b))
}

/// The relay's records of a project: `[u64 seq][u32 len][bytes]…`.
fn relay_log(dir: &Path) -> Vec<(u64, Vec<u8>)> {
    let Ok(buf) = std::fs::read(dir.join("log.bin")) else { return Vec::new() };
    let mut out = Vec::new();
    let mut at = 0;
    while at + 12 <= buf.len() {
        let seq = u64::from_be_bytes(buf[at..at + 8].try_into().unwrap());
        let len = u32::from_be_bytes(buf[at + 8..at + 12].try_into().unwrap()) as usize;
        if at + 12 + len > buf.len() {
            break;
        }
        out.push((seq, buf[at + 12..at + 12 + len].to_vec()));
        at += 12 + len;
    }
    out
}

impl Hub {
    /// Starts a hub on `node`, keeping its data in `dir`, with the projects
    /// already added.
    pub fn start(node: Node, dir: &Path) -> anyhow::Result<Arc<Self>> {
        Self::start_with(node, dir, Options::default())
    }

    /// As [`Hub::start`], public and importing from a relay as `options` say.
    pub fn start_with(node: Node, dir: &Path, options: Options) -> anyhow::Result<Arc<Self>> {
        std::fs::create_dir_all(dir.join("projects"))?;
        let mut book: Book = std::fs::read(dir.join("hub.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if book.secret.is_empty() {
            book.secret = proof::challenge().to_vec();
        }
        let hub = Arc::new(Self { node: Arc::new(node), dir: dir.to_path_buf(), book: Mutex::new(book.clone()), options });
        hub.save()?;
        for p in &book.projects {
            hub.open(p)?;
        }
        // What reaches the relay from copies not yet on peer-to-peer.
        if hub.options.relay.is_some() {
            let weak = Arc::downgrade(&hub);
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    let Some(hub) = weak.upgrade() else { return };
                    hub.import_all();
                }
            });
        }
        let weak = Arc::downgrade(&hub);
        hub.node.on_admin(Arc::new(move |conn| {
            if let Some(hub) = weak.upgrade() {
                tokio::spawn(async move {
                    let _ = hub.answer(conn).await;
                });
            }
        }));
        Ok(hub)
    }

    /// The code to give an app: this hub's id and its secret.
    pub fn code(&self) -> String {
        if self.options.public {
            return format!("{}.{PUBLIC}", self.node.id());
        }
        format!("{}.{}", self.node.id(), hex(&self.book.lock().unwrap().secret))
    }

    /// Whether `access` is the project's relay access token.
    fn relay_allows(&self, id: &str, access: &[u8]) -> bool {
        let Some(relay) = &self.options.relay else { return false };
        if !id.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
        let Ok(meta) = std::fs::read(relay.join(id).join("meta.json")) else { return false };
        let Ok(meta) = serde_json::from_slice::<serde_json::Value>(&meta) else { return false };
        meta.get("accessHash").and_then(|h| h.as_str()) == Some(sha256_hex(access).as_str())
    }

    /// The relay's history of every project, as far as it goes now.
    pub fn import_all(&self) {
        let ids: Vec<String> = self.book.lock().unwrap().projects.iter().map(|p| p.id.clone()).collect();
        for id in ids {
            if let Err(e) = self.import(&id) {
                eprintln!("[hub] importing {id}: {e:#}");
            }
        }
    }

    /// One project's relay history since the last import: its snapshot if
    /// newer, its updates in order, and files not yet here; each written as
    /// this hub's entry (the bytes as the relay holds them, still sealed).
    fn import(&self, id: &str) -> anyhow::Result<()> {
        let Some(relay) = &self.options.relay else { return Ok(()) };
        let dir = relay.join(id);
        if !dir.is_dir() {
            return Ok(());
        }
        let Some(project) = self.node.project(id) else { return Ok(()) };
        let (mut upto, mut have_blobs) = {
            let book = self.book.lock().unwrap();
            let p = book.projects.iter().find(|p| p.id == id).context("not added")?;
            (p.imported, p.imported_blobs.clone())
        };
        let before = upto;
        if let Ok(snap) = std::fs::read(dir.join("snapshot.bin")) {
            if snap.len() > 8 {
                let at = u64::from_be_bytes(snap[..8].try_into().unwrap());
                if at > upto {
                    self.node.write(id, snap[8..].to_vec())?;
                    upto = at;
                }
            }
        }
        for (seq, data) in relay_log(&dir) {
            if seq > upto {
                self.node.write(id, data)?;
                upto = seq;
            }
        }
        let mut new_blobs = false;
        if let Ok(items) = std::fs::read_dir(dir.join("blobs")) {
            for item in items.flatten() {
                let name = item.file_name().to_string_lossy().to_string();
                if name.len() != 64 || have_blobs.contains(&name) {
                    continue;
                }
                if let Ok(bytes) = std::fs::read(item.path()) {
                    project.put_blob(&bytes)?;
                    have_blobs.insert(name);
                    new_blobs = true;
                }
            }
        }
        if upto != before || new_blobs {
            let mut book = self.book.lock().unwrap();
            if let Some(p) = book.projects.iter_mut().find(|p| p.id == id) {
                p.imported = upto;
                p.imported_blobs = have_blobs;
            }
            drop(book);
            self.save()?;
        }
        Ok(())
    }

    pub fn projects(&self) -> Vec<String> {
        self.book.lock().unwrap().projects.iter().map(|p| p.id.clone()).collect()
    }

    fn save(&self) -> anyhow::Result<()> {
        let path = self.dir.join("hub.json");
        let tmp = self.dir.join("hub.json.new");
        std::fs::write(&tmp, serde_json::to_vec(&*self.book.lock().unwrap())?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    fn open(&self, p: &Added) -> anyhow::Result<()> {
        let project = self.node.open(&p.id, &p.token, self.dir.join("projects").join(safe(&p.id)))?;
        project.keep_all_blobs(true);
        if let Some(c) = &p.creator {
            project.set_creator(c)?;
        }
        Ok(())
    }

    async fn answer(&self, conn: Connection) -> anyhow::Result<()> {
        let them = conn.remote_id().to_string();
        let (mut tx, mut rx) = conn.accept_bi().await?;
        let Ask::Hello { proof } = recv(&mut rx).await? else { bail!("unexpected") };
        if self.options.public && proof.is_empty() {
            // Anyone, project by project, with its relay access token.
            send(&mut tx, &Reply::Ok).await?;
            while let Ok(Ask::AddWithAccess { id, token, creator, access }) = recv(&mut rx).await {
                let reply = if !self.relay_allows(&id, &access) {
                    Reply::No("not a member of that project".into())
                } else {
                    self.add(Added { id, token, creator, imported: 0, imported_blobs: BTreeSet::new() })
                };
                send(&mut tx, &reply).await?;
            }
            return Ok(());
        }
        let known = {
            let mut book = self.book.lock().unwrap();
            let good = proof == pair_proof(&book.secret, &them, self.node.id());
            if good {
                book.owners.insert(them.clone());
            }
            book.owners.contains(&them)
        };
        if !known {
            send(&mut tx, &Reply::No("wrong hub code".into())).await?;
            return Ok(());
        }
        self.save()?;
        send(&mut tx, &Reply::Ok).await?;
        while let Ok(Ask::Add { id, token, creator }) = recv(&mut rx).await {
            let reply = self.add(Added { id, token, creator, imported: 0, imported_blobs: BTreeSet::new() });
            send(&mut tx, &reply).await?;
        }
        Ok(())
    }

    /// Keeps a project (again, with a newer token: its import goes on).
    fn add(&self, mut added: Added) -> Reply {
        if self.node.project(&added.id).is_none() {
            if let Err(e) = self.open(&added) {
                return Reply::No(e.to_string());
            }
        }
        {
            let mut book = self.book.lock().unwrap();
            if let Some(old) = book.projects.iter().find(|p| p.id == added.id) {
                added.imported = old.imported;
                added.imported_blobs = old.imported_blobs.clone();
            }
            book.projects.retain(|p| p.id != added.id);
            book.projects.push(added.clone());
        }
        if let Err(e) = self.save() {
            return Reply::No(e.to_string());
        }
        if let Err(e) = self.import(&added.id) {
            eprintln!("[hub] importing {}: {e:#}", added.id);
        }
        Reply::Ok
    }
}

impl Node {
    /// Gives a hub (by its code) a project to keep: its id, its current
    /// membership token, and its creator. The hub then syncs it like any
    /// member, and this copy reaches it like one.
    pub async fn add_to_hub(&self, code: &str, id: &str, token: &[u8], creator: Option<&str>) -> anyhow::Result<()> {
        let (hub, secret) = code.trim().split_once('.').context("not a hub code")?;
        anyhow::ensure!(secret != PUBLIC, "a public hub needs the project's access token");
        let secret = unhex(secret).context("not a hub code")?;
        let hub_id: iroh::EndpointId = hub.parse().context("not a hub code")?;
        let conn = self.endpoint().connect(hub_id, ALPN).await.context("reaching the hub")?;
        let (mut tx, mut rx) = conn.open_bi().await?;
        send(&mut tx, &Ask::Hello { proof: pair_proof(&secret, self.id(), hub) }).await?;
        if let Reply::No(why) = recv(&mut rx).await? {
            bail!(why);
        }
        send(&mut tx, &Ask::Add { id: id.into(), token: token.into(), creator: creator.map(Into::into) }).await?;
        if let Reply::No(why) = recv(&mut rx).await? {
            bail!(why);
        }
        tx.finish()?;
        // A member to reach from now on.
        self.join(id, hub_id).await?;
        Ok(())
    }

    /// Gives a public hub (`<id>.public`, the Latex4All server) a project,
    /// proving membership with the project's relay access token.
    pub async fn add_to_public_hub(&self, code: &str, id: &str, token: &[u8], access: &[u8], creator: Option<&str>) -> anyhow::Result<()> {
        let (hub, mark) = code.trim().split_once('.').context("not a hub code")?;
        anyhow::ensure!(mark == PUBLIC, "not a public hub");
        let hub_id: iroh::EndpointId = hub.parse().context("not a hub code")?;
        let conn = self.endpoint().connect(hub_id, ALPN).await.context("reaching the hub")?;
        let (mut tx, mut rx) = conn.open_bi().await?;
        send(&mut tx, &Ask::Hello { proof: Vec::new() }).await?;
        if let Reply::No(why) = recv(&mut rx).await? {
            bail!(why);
        }
        send(&mut tx, &Ask::AddWithAccess { id: id.into(), token: token.into(), creator: creator.map(Into::into), access: access.into() }).await?;
        if let Reply::No(why) = recv(&mut rx).await? {
            bail!(why);
        }
        tx.finish()?;
        self.join(id, hub_id).await?;
        Ok(())
    }
}
