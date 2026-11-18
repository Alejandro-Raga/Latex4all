//! A hub: a copy that stays on, keeps every shared project's log and files,
//! and hands changes on between members who aren't online together. It
//! holds each project's membership token, never its key, so it can't read
//! anything.
//!
//! Setting one up: the hub prints a *hub code*, `<its id>.<a secret>`. An
//! app given the code proves it knows the secret once (an HMAC, so the
//! secret never travels) and becomes one of the hub's owners; owners add
//! projects to it. Kept in `<data>/hub.json`; projects in `<data>/projects/`.

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
}

#[derive(Serialize, Deserialize)]
enum Ask {
    /// Proof of the code's secret (empty for an owner already).
    Hello { proof: Vec<u8> },
    Add { id: String, token: Vec<u8>, creator: Option<String> },
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
}

impl Hub {
    /// Starts a hub on `node`, keeping its data in `dir`, with the projects
    /// already added.
    pub fn start(node: Node, dir: &Path) -> anyhow::Result<Arc<Self>> {
        std::fs::create_dir_all(dir.join("projects"))?;
        let mut book: Book = std::fs::read(dir.join("hub.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if book.secret.is_empty() {
            book.secret = proof::challenge().to_vec();
        }
        let hub = Arc::new(Self { node: Arc::new(node), dir: dir.to_path_buf(), book: Mutex::new(book.clone()) });
        hub.save()?;
        for p in &book.projects {
            hub.open(p)?;
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
        format!("{}.{}", self.node.id(), hex(&self.book.lock().unwrap().secret))
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
            let added = Added { id, token, creator };
            let reply = match self.open(&added) {
                Ok(()) => {
                    let mut book = self.book.lock().unwrap();
                    book.projects.retain(|p| p.id != added.id);
                    book.projects.push(added);
                    drop(book);
                    self.save()?;
                    Reply::Ok
                }
                Err(e) => Reply::No(e.to_string()),
            };
            send(&mut tx, &reply).await?;
        }
        Ok(())
    }
}

impl Node {
    /// Gives a hub (by its code) a project to keep: its id, its current
    /// membership token, and its creator. The hub then syncs it like any
    /// member, and this copy reaches it like one.
    pub async fn add_to_hub(&self, code: &str, id: &str, token: &[u8], creator: Option<&str>) -> anyhow::Result<()> {
        let (hub, secret) = code.trim().split_once('.').context("not a hub code")?;
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
}
