//! One sync between two copies of the same project: each proves it holds
//! the project's key, then each sends what the other lacks.
//!
//! On one bidirectional stream, frames of `[u32 length][JSON]`:
//!   dialer → `Hello { project, challenge }`
//!   listener → `Welcome { challenge, answer, vector }`
//!   dialer → `Proof { answer, vector }` then `Entries`
//!   listener → `Entries`
//! Entries' data are carried as base64 in JSON for now.

use crate::log::{Entry, Log, Vector};
use crate::proof;
use anyhow::{bail, Context};
use iroh::endpoint::{RecvStream, SendStream};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Frame {
    Hello { project: String, challenge: Vec<u8> },
    Welcome { challenge: Vec<u8>, answer: Vec<u8>, vector: Vector },
    Proof { answer: Vec<u8>, vector: Vector },
    Entries { entries: Vec<WireEntry> },
}

#[derive(Serialize, Deserialize)]
struct WireEntry {
    author: String,
    n: u64,
    data: Vec<u8>,
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
        .map(|e| WireEntry { author: e.author, n: e.n, data: e.data })
        .collect()
}

fn take(log: &mut Log, entries: Vec<WireEntry>) -> usize {
    let mut added = 0;
    for e in entries {
        if log.add(Entry { author: e.author, n: e.n, data: e.data }) {
            added += 1;
        }
    }
    added
}

/// The project as a session sees it.
pub struct Project<'a> {
    pub id: &'a str,
    /// Derived from the project's key; proves membership.
    pub token: &'a [u8],
    pub log: &'a mut Log,
}

/// Syncs as the copy that called. Returns how many entries it received.
pub async fn dial(
    conn: &iroh::endpoint::Connection,
    me: &str,
    them: &str,
    project: Project<'_>,
) -> anyhow::Result<usize> {
    let (mut tx, mut rx) = conn.open_bi().await?;
    let mine = proof::challenge();
    send(&mut tx, &Frame::Hello { project: project.id.into(), challenge: mine.to_vec() }).await?;
    let Frame::Welcome { challenge, answer, vector } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    if !proof::check(project.token, &mine, them, me, &answer) {
        bail!("the other copy doesn't hold this project's key");
    }
    send(
        &mut tx,
        &Frame::Proof {
            answer: proof::answer(project.token, &challenge, me, them),
            vector: project.log.vector(),
        },
    )
    .await?;
    send(&mut tx, &Frame::Entries { entries: wire(project.log.missing_for(&vector)) }).await?;
    tx.finish()?;
    let Frame::Entries { entries } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    Ok(take(project.log, entries))
}

/// Syncs as the copy that was called, for the project the caller names
/// (`find` gives it, if this copy has it). Returns how many entries it got.
pub async fn answer<'a>(
    conn: &iroh::endpoint::Connection,
    me: &str,
    them: &str,
    find: impl FnOnce(&str) -> Option<Project<'a>>,
) -> anyhow::Result<usize> {
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
            answer: proof::answer(project.token, &challenge, me, them),
            vector: project.log.vector(),
        },
    )
    .await?;
    let Frame::Proof { answer, vector } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    if !proof::check(project.token, &mine, them, me, &answer) {
        bail!("the other copy doesn't hold this project's key");
    }
    let Frame::Entries { entries } = recv(&mut rx).await? else {
        bail!("unexpected reply");
    };
    let got = take(project.log, entries);
    send(&mut tx, &Frame::Entries { entries: wire(project.log.missing_for(&vector)) }).await?;
    tx.finish()?;
    Ok(got)
}
