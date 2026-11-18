//! A live sync between two copies of the same project, on one
//! bidirectional stream of `[u32 length][frame]` frames (postcard, a compact
//! binary encoding):
//!
//!   dialer → `Hello { project, challenge, epoch }`
//!   listener → `Welcome { challenge, answer, epoch }`
//!   dialer → `Proof { answer }`
//!   then, if one's epoch is behind, `Rekeys` to it, and they reconnect;
//!   otherwise both `Ready { vector, members, … }`, and for as long as the
//!   connection lasts `Entries` (first what the other lacks, then each new
//!   change), acknowledgements, snapshots and files.
//!
//! Each copy proves it holds the project's key before anything about the
//! project is sent.

use crate::log::{Entry, Snapshot, Vector};
use crate::members::Members;
use crate::rekey::Rekey;
use crate::proof;
use crate::{BlobNews, Change, Project};
use std::collections::HashMap;
use anyhow::{bail, Context};
use iroh::endpoint::{Connection, RecvStream, SendStream};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

#[derive(Serialize, Deserialize)]
enum Frame {
    Hello { project: String, challenge: Vec<u8>, epoch: u64 },
    Welcome { challenge: Vec<u8>, answer: Vec<u8>, epoch: u64 },
    Proof { answer: Vec<u8> },
    /// Once both are proven, if they're at the same epoch.
    Ready { vector: Vector, peers: Vec<String>, members: Members, snapshot: Option<Vector> },
    /// Records the other lacks: a member removed, a new key.
    Rekeys { records: Vec<Rekey> },
    /// Members the sender knows of, sent whenever it hears of a new one.
    Members { peers: Vec<String>, members: Members },
    Entries { entries: Vec<WireEntry> },
    Snapshot { author: String, covers: Vector, data: Vec<u8>, sig: Vec<u8> },
    /// What the sender has now: an acknowledgement of entries received.
    Have { vector: Vector },
    /// Files the sender has.
    Blobs { names: Vec<String> },
    /// Files the sender asks for.
    Want { names: Vec<String> },
    /// A piece of a file: `total` bytes in all, this from `at`.
    Piece { name: String, total: u64, at: u64, data: Vec<u8> },
}

#[derive(Serialize, Deserialize)]
struct WireEntry {
    author: String,
    n: u64,
    data: Vec<u8>,
    sig: Vec<u8>,
}

const MAX_FRAME: usize = 64 * 1024 * 1024;
/// The largest file taken.
const MAX_FILE: u64 = 2 * 1024 * 1024 * 1024;

/// What the reading side asks the writing side to send.
enum Out {
    Ack(Vector),
    Frame(Frame),
    File(String),
}

async fn send(stream: &mut SendStream, frame: &Frame) -> anyhow::Result<()> {
    let body = postcard::to_stdvec(frame)?;
    stream.write_all(&(body.len() as u32).to_be_bytes()).await?;
    stream.write_all(&body).await?;
    Ok(())
}

async fn recv(stream: &mut RecvStream) -> anyhow::Result<Frame> {
    let mut len = [0u8; 4];
    stream.read_exact(&mut len).await.context("connection closed")?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME {
        bail!("frame too large");
    }
    let mut body = vec![0u8; len];
    stream.read_exact(&mut body).await?;
    Ok(postcard::from_bytes(&body)?)
}

fn wire(entries: Vec<Entry>) -> Vec<WireEntry> {
    entries
        .into_iter()
        .map(|e| WireEntry { author: e.author, n: e.n, data: e.data, sig: e.sig })
        .collect()
}

/// Opens a sync of `project` with the copy at the other end of `conn`.
pub async fn dial(conn: Connection, me: String, project: Arc<Project>) -> anyhow::Result<()> {
    let them = conn.remote_id().to_string();
    let (mut tx, mut rx) = conn.open_bi().await?;
    let mine = proof::challenge();
    let my_epoch = project.epoch();
    send(&mut tx, &Frame::Hello { project: project.id.clone(), challenge: mine.to_vec(), epoch: my_epoch }).await?;
    let Frame::Welcome { challenge, answer, epoch: their_epoch } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    // Both prove membership as of the earlier of their epochs.
    let token = project.token(my_epoch.min(their_epoch)).context("no token for that epoch")?;
    if !proof::check(&token, &mine, &them, &me, &answer) {
        bail!("the other copy doesn't hold this project's key");
    }
    send(&mut tx, &Frame::Proof { answer: proof::answer(&token, &challenge, &me, &them) }).await?;
    proven(tx, rx, me, them, my_epoch, their_epoch, project).await
}

/// Answers a sync opened by the copy at the other end of `conn`, for the
/// project it names (`find` gives it, if this copy has it).
pub async fn answer(
    conn: Connection,
    me: String,
    find: impl FnOnce(&str) -> Option<Arc<Project>>,
) -> anyhow::Result<()> {
    let them = conn.remote_id().to_string();
    let (mut tx, mut rx) = conn.accept_bi().await?;
    let Frame::Hello { project: id, challenge, epoch: their_epoch } = recv(&mut rx).await? else {
        bail!("unexpected opening");
    };
    let Some(project) = find(&id) else {
        bail!("not a project here");
    };
    let my_epoch = project.epoch();
    let token = project.token(my_epoch.min(their_epoch)).context("no token for that epoch")?;
    let mine = proof::challenge();
    send(
        &mut tx,
        &Frame::Welcome {
            challenge: mine.to_vec(),
            answer: proof::answer(&token, &challenge, &me, &them),
            epoch: my_epoch,
        },
    )
    .await?;
    let Frame::Proof { answer } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    if !proof::check(&token, &mine, &them, &me, &answer) {
        bail!("the other copy doesn't hold this project's key");
    }
    proven(tx, rx, me, them, my_epoch, their_epoch, project).await
}

/// After both have proven membership. Only now is anything about the
/// project sent. If one is a member removal behind, it gets the records (if
/// it stays a member) and reconnects; otherwise they sync.
async fn proven(
    mut tx: SendStream,
    mut rx: RecvStream,
    me: String,
    them: String,
    my_epoch: u64,
    their_epoch: u64,
    project: Arc<Project>,
) -> anyhow::Result<()> {
    if my_epoch > their_epoch {
        // Heard of, so the creator hears of it too (and of it being left out).
        project.learn([them.clone()], &me);
        // A member removed gets the records too, so it knows: nothing in
        // them is sealed for it.
        send(&mut tx, &Frame::Rekeys { records: project.rekeys_after(their_epoch) }).await?;
        tx.finish()?;
        // Until they've taken it in and hung up.
        let _ = recv(&mut rx).await;
        return Ok(());
    }
    if my_epoch < their_epoch {
        let Frame::Rekeys { records } = recv(&mut rx).await? else {
            bail!("unexpected frame");
        };
        for r in records {
            project.receive_rekey(r)?;
        }
        return Ok(());
    }
    send(
        &mut tx,
        &Frame::Ready {
            vector: project.vector(),
            peers: project.known_peers(),
            members: project.account(),
            snapshot: project.snapshot_covers(),
        },
    )
    .await?;
    let Frame::Ready { vector, peers, members, snapshot } = recv(&mut rx).await? else {
        bail!("unexpected frame");
    };
    // A member, proven: it, and the members it knows, are worth reaching.
    project.learn(std::iter::once(them.clone()).chain(peers), &me);
    project.heard(&them, &vector, Some(&members));
    live(tx, rx, them, vector, snapshot, project).await
}

fn snapshot_frame(s: Snapshot) -> Frame {
    Frame::Snapshot { author: s.author, covers: s.covers, data: s.data, sig: s.sig }
}

/// Both ways at once until the connection ends: what they lack first, then
/// every new change; what they send is kept and passed on to other copies.
async fn live(
    mut tx: SendStream,
    mut rx: RecvStream,
    them: String,
    their_vector: Vector,
    their_snapshot: Option<Vector>,
    project: Arc<Project>,
) -> anyhow::Result<()> {
    // Listening before catching them up, so nothing made meanwhile is missed.
    let mut changes = project.changes.subscribe();
    let (snap, catch_up) = project.missing_for(&their_vector, their_snapshot.as_ref());
    let mut sent = their_vector;
    if let Some(s) = snap {
        for (a, &n) in &s.covers {
            let e = sent.entry(a.clone()).or_insert(0);
            *e = (*e).max(n);
        }
        send(&mut tx, &snapshot_frame(s)).await?;
    }
    note_sent(&mut sent, &catch_up);
    send(&mut tx, &Frame::Entries { entries: wire(catch_up) }).await?;

    // Files: what we have, and what we're after.
    let mut news = project.blob_news.subscribe();
    let mut rekeys = project.rekeys.subscribe();
    let mut roster = project.roster.subscribe();
    send(&mut tx, &Frame::Blobs { names: project.blobs.names() }).await?;
    let wanted: Vec<String> = project.wanted.lock().unwrap().iter().cloned().collect();
    if !wanted.is_empty() {
        send(&mut tx, &Frame::Want { names: wanted }).await?;
    }

    let writer_project = project.clone();
    let writer_them = them.clone();
    // Replies from the reading side: acknowledgements, requests, files.
    let (out, mut outs) = tokio::sync::mpsc::unbounded_channel::<Out>();
    let writer = tokio::spawn(async move {
        loop {
            let change = tokio::select! {
                change = changes.recv() => change,
                Some(o) = outs.recv() => {
                    match o {
                        Out::Ack(vector) => send(&mut tx, &Frame::Have { vector }).await?,
                        Out::Frame(f) => send(&mut tx, &f).await?,
                        Out::File(name) => {
                            // Read when it's its turn, sent in pieces.
                            if let Some(data) = writer_project.blob(&name) {
                                let total = data.len() as u64;
                                for (i, piece) in data.chunks(crate::blobs::PIECE).enumerate() {
                                    let at = (i * crate::blobs::PIECE) as u64;
                                    send(&mut tx, &Frame::Piece { name: name.clone(), total, at, data: piece.to_vec() }).await?;
                                }
                                if data.is_empty() {
                                    send(&mut tx, &Frame::Piece { name, total: 0, at: 0, data: vec![] }).await?;
                                }
                            }
                        }
                    }
                    continue;
                }
                Ok(record) = rekeys.recv() => {
                    // A new epoch: they get the record if they stay, and the
                    // sync ends; they reconnect as of it.
                    send(&mut tx, &Frame::Rekeys { records: vec![record] }).await?;
                    tx.finish()?;
                    return anyhow::Ok(());
                }
                Ok(()) = roster.recv() => {
                    let p = &writer_project;
                    send(&mut tx, &Frame::Members { peers: p.known_peers(), members: p.account() }).await?;
                    continue;
                }
                n = news.recv() => {
                    match n {
                        Ok(BlobNews::Have(name, from)) if from.as_deref() != Some(writer_them.as_str()) => {
                            send(&mut tx, &Frame::Blobs { names: vec![name] }).await?;
                        }
                        Ok(BlobNews::Want(name)) => {
                            send(&mut tx, &Frame::Want { names: vec![name] }).await?;
                        }
                        _ => {}
                    }
                    continue;
                }
            };
            match change {
                Ok((Change::Blob(_) | Change::Rekey { .. } | Change::Removed | Change::LeftOut(_), _)) => {}
                Ok((Change::Snapshot { snapshot, .. }, from)) => {
                    if from.as_deref() != Some(writer_them.as_str()) {
                        send(&mut tx, &snapshot_frame(snapshot)).await?;
                    }
                }
                Ok((Change::Entry(entry), from)) => {
                    // Not back to the copy it came from.
                    if from.as_deref() == Some(writer_them.as_str()) {
                        continue;
                    }
                    if sent.get(&entry.author).copied().unwrap_or(0) >= entry.n {
                        continue;
                    }
                    note_sent(&mut sent, std::slice::from_ref(&entry));
                    send(&mut tx, &Frame::Entries { entries: wire(vec![entry]) }).await?;
                }
                // Fell behind: whatever they may lack, from the log itself.
                Err(RecvError::Lagged(_)) => {
                    let (_, missing) = writer_project.missing_for(&sent, None);
                    note_sent(&mut sent, &missing);
                    send(&mut tx, &Frame::Entries { entries: wire(missing) }).await?;
                }
                Err(RecvError::Closed) => return anyhow::Ok(()),
            }
        }
    });

    let mut partial: HashMap<String, Vec<u8>> = HashMap::new();
    let reading = async {
        loop {
            match recv(&mut rx).await? {
                Frame::Entries { entries } => {
                    let any = !entries.is_empty();
                    for e in entries {
                        let entry = Entry { author: e.author, n: e.n, data: e.data, sig: e.sig };
                        project.receive(entry, &them)?;
                    }
                    if any {
                        let _ = out.send(Out::Ack(project.vector()));
                    }
                }
                Frame::Blobs { names } => {
                    let fetch: Vec<String> = names.into_iter().filter(|n| project.should_fetch(n)).collect();
                    if !fetch.is_empty() {
                        let _ = out.send(Out::Frame(Frame::Want { names: fetch }));
                    }
                }
                Frame::Want { names } => {
                    for name in names {
                        if project.blobs.has(&name) {
                            let _ = out.send(Out::File(name));
                        }
                    }
                }
                Frame::Piece { name, total, at, data } => {
                    // Pieces come in order; a file too big, or out of step, is dropped.
                    if total > MAX_FILE || at != partial.get(&name).map_or(0, |p| p.len() as u64) {
                        partial.remove(&name);
                        continue;
                    }
                    let buf = partial.entry(name.clone()).or_default();
                    buf.extend_from_slice(&data);
                    if buf.len() as u64 >= total {
                        let buf = partial.remove(&name).unwrap_or_default();
                        project.receive_blob(&name, &buf, &them)?;
                    }
                }
                Frame::Have { vector } => project.heard(&them, &vector, None),
                Frame::Members { peers, members } => {
                    project.learn(peers, &project.me().to_string());
                    project.heard(&them, &Vector::new(), Some(&members));
                }
                Frame::Rekeys { records } => {
                    for r in records {
                        project.receive_rekey(r)?;
                    }
                    return Ok(());
                }
                Frame::Snapshot { author, covers, data, sig } => {
                    project.receive_snapshot(Snapshot { author, covers, data, sig }, &them)?;
                    let _ = out.send(Out::Ack(project.vector()));
                }
                _ => bail!("unexpected frame"),
            }
        }
    };
    // Until either side ends: the connection closes, or a new epoch.
    let mut writer = writer;
    let result: anyhow::Result<()> = tokio::select! {
        r = reading => r,
        w = &mut writer => w.unwrap_or(Ok(())),
    };
    writer.abort();
    result
}

fn note_sent(sent: &mut Vector, entries: &[Entry]) {
    for e in entries {
        let n = sent.entry(e.author.clone()).or_insert(0);
        if e.n > *n {
            *n = e.n;
        }
    }
}
