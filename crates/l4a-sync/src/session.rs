//! A live sync between two copies of the same project, on one
//! bidirectional stream of `[u32 length][JSON]` frames:
//!
//!   dialer → `Hello { project, challenge }`
//!   listener → `Welcome { challenge, answer, vector }`
//!   dialer → `Proof { answer, vector }`
//!   then both, for as long as the connection lasts: `Entries` (first what
//!   the other lacks, then each new change as it's made or received).
//!
//! Each copy proves it holds the project's key before anything is sent.

use crate::log::{Entry, Snapshot, Vector};
use crate::members::Members;
use crate::proof;
use crate::{Change, Project};
use anyhow::{bail, Context};
use iroh::endpoint::{Connection, RecvStream, SendStream};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Frame {
    Hello { project: String, challenge: Vec<u8> },
    Welcome { challenge: Vec<u8>, answer: Vec<u8>, vector: Vector, peers: Vec<String>, members: Members, snapshot: Option<Vector> },
    Proof { answer: Vec<u8>, vector: Vector, peers: Vec<String>, members: Members, snapshot: Option<Vector> },
    Entries { entries: Vec<WireEntry> },
    Snapshot { author: String, covers: Vector, data: Vec<u8>, sig: Vec<u8> },
    /// What the sender has now: an acknowledgement of entries received.
    Have { vector: Vector },
}

#[derive(Serialize, Deserialize)]
struct WireEntry {
    author: String,
    n: u64,
    data: Vec<u8>,
    sig: Vec<u8>,
}

const MAX_FRAME: usize = 64 * 1024 * 1024;

async fn send(stream: &mut SendStream, frame: &Frame) -> anyhow::Result<()> {
    let body = serde_json::to_vec(frame)?;
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
    Ok(serde_json::from_slice(&body)?)
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
    send(&mut tx, &Frame::Hello { project: project.id.clone(), challenge: mine.to_vec() }).await?;
    let Frame::Welcome { challenge, answer, vector, peers, members, snapshot } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    if !proof::check(&project.token, &mine, &them, &me, &answer) {
        bail!("the other copy doesn't hold this project's key");
    }
    send(
        &mut tx,
        &Frame::Proof {
            answer: proof::answer(&project.token, &challenge, &me, &them),
            vector: project.vector(),
            peers: project.known_peers(),
            members: project.account(),
            snapshot: project.snapshot_covers(),
        },
    )
    .await?;
    // A member, proven: it, and the members it knows, are worth reaching.
    project.learn(std::iter::once(them.clone()).chain(peers), &me);
    project.heard(&them, &vector, Some(&members));
    live(tx, rx, them, vector, snapshot, project).await
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
    let Frame::Hello { project: id, challenge } = recv(&mut rx).await? else {
        bail!("unexpected opening");
    };
    let Some(project) = find(&id) else {
        bail!("not a project here");
    };
    let mine = proof::challenge();
    send(
        &mut tx,
        &Frame::Welcome {
            challenge: mine.to_vec(),
            answer: proof::answer(&project.token, &challenge, &me, &them),
            vector: project.vector(),
            peers: project.known_peers(),
            members: project.account(),
            snapshot: project.snapshot_covers(),
        },
    )
    .await?;
    let Frame::Proof { answer, vector, peers, members, snapshot } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    if !proof::check(&project.token, &mine, &them, &me, &answer) {
        bail!("the other copy doesn't hold this project's key");
    }
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

    let writer_project = project.clone();
    let writer_them = them.clone();
    // What we have after taking in their entries, to acknowledge them.
    let (ack, mut acks) = tokio::sync::mpsc::unbounded_channel::<Vector>();
    let writer = tokio::spawn(async move {
        loop {
            let change = tokio::select! {
                change = changes.recv() => change,
                Some(mut vector) = acks.recv() => {
                    while let Ok(newer) = acks.try_recv() {
                        vector = newer;
                    }
                    send(&mut tx, &Frame::Have { vector }).await?;
                    continue;
                }
            };
            match change {
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
                        let _ = ack.send(project.vector());
                    }
                }
                Frame::Have { vector } => project.heard(&them, &vector, None),
                Frame::Snapshot { author, covers, data, sig } => {
                    project.receive_snapshot(Snapshot { author, covers, data, sig }, &them)?;
                    let _ = ack.send(project.vector());
                }
                _ => bail!("unexpected frame"),
            }
        }
    };
    let result: anyhow::Result<()> = reading.await;
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
