//! A shared cloud folder (Dropbox, OneDrive, iCloud, Google Drive, Seafile…)
//! as a project's always-on store. Each copy writes only in its own
//! subfolder, `<folder>/<its id>/`, so the cloud service never has two
//! computers editing one file:
//!
//! - `NNNNNNNNNN.seg`: entries not yet in the folder, a batch per file, framed
//!   as on disk (see [`crate::store`]); any member's, so a member who also
//!   syncs elsewhere carries changes between the two;
//! - `snapshot.bin`: its latest snapshot; `has.json`: what it has (so others
//!   know whose changes reached whom);
//! - files (see [`crate::blobs`]) go in `<folder>/blobs/`, named by hash.
//!
//! Every file is written beside its place and then moved in, and nothing is
//! taken as read until it reads whole: cloud services deliver files late,
//! out of order, or as placeholders still downloading. Everything read is
//! checked like anything received from a member. If this copy's files are
//! deleted, it writes them again.

use crate::log::{Entry, Snapshot, Vector};
use crate::members;
use crate::Project;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// The file that marks a folder as a project's, with its id.
pub const MARKER: &str = "latex4all-project.json";

#[derive(Default, Serialize, Deserialize)]
struct State {
    /// Others' files read whole, with their size then.
    read: BTreeMap<String, u64>,
    /// What's known to be in the folder already.
    in_folder: Vector,
    /// This copy's files, and the next number.
    mine: Vec<String>,
    next: u64,
    snapshot_written: Option<Vector>,
}

fn write_atomic(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn frames(entries: &[Entry]) -> Vec<u8> {
    let mut out = Vec::new();
    for e in entries {
        out.extend_from_slice(&e.n.to_be_bytes());
        out.extend_from_slice(&(e.data.len() as u32).to_be_bytes());
        out.extend_from_slice(&e.sig);
        out.extend_from_slice(&e.data);
    }
    out
}

/// Entries in a segment of `author`'s; none if it isn't whole yet.
fn parse(bytes: &[u8], author: &str) -> Option<Vec<Entry>> {
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let head = bytes.get(at..at + 76)?;
        let n = u64::from_be_bytes(head[..8].try_into().ok()?);
        let len = u32::from_be_bytes(head[8..12].try_into().ok()?) as usize;
        let sig = head[12..76].to_vec();
        let data = bytes.get(at + 76..at + 76 + len)?.to_vec();
        out.push(Entry { author: author.to_string(), n, data, sig });
        at += 76 + len;
    }
    Some(out)
}

/// A segment holds entries of several authors: one block per author, each
/// `[u32 author length][author][u32 bytes][frames]`.
fn encode(entries: &[Entry]) -> Vec<u8> {
    let mut by: BTreeMap<&str, Vec<Entry>> = BTreeMap::new();
    for e in entries {
        by.entry(&e.author).or_default().push(e.clone());
    }
    let mut out = Vec::new();
    for (author, list) in by {
        let body = frames(&list);
        out.extend_from_slice(&(author.len() as u32).to_be_bytes());
        out.extend_from_slice(author.as_bytes());
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(&body);
    }
    out
}

fn decode(bytes: &[u8]) -> Option<Vec<Entry>> {
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let alen = u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize;
        let author = std::str::from_utf8(bytes.get(at + 4..at + 4 + alen)?).ok()?;
        at += 4 + alen;
        let blen = u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize;
        out.extend(parse(bytes.get(at + 4..at + 4 + blen)?, author)?);
        at += 4 + blen;
    }
    Some(out)
}

#[derive(Serialize, Deserialize)]
struct Has {
    has: Vector,
    at: u64,
}

#[derive(Serialize, Deserialize)]
struct SnapshotFile {
    author: String,
    covers: Vector,
    sig: Vec<u8>,
    data: Vec<u8>,
}

/// Finds a project's folder inside the cloud folders given (where each
/// service put a folder shared with this user), by its marker file.
pub fn find(roots: &[PathBuf], project: &str) -> Option<PathBuf> {
    fn walk(dir: &Path, project: &str, depth: usize) -> Option<PathBuf> {
        if let Ok(bytes) = fs::read(dir.join(MARKER)) {
            let id: Option<String> = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .and_then(|v| v.get("id")?.as_str().map(str::to_string));
            if id.as_deref() == Some(project) {
                return Some(dir.to_path_buf());
            }
        }
        if depth == 0 {
            return None;
        }
        for item in fs::read_dir(dir).ok()?.flatten() {
            let path = item.path();
            let hidden = item.file_name().to_string_lossy().starts_with('.');
            if path.is_dir() && !hidden {
                if let Some(found) = walk(&path, project, depth - 1) {
                    return Some(found);
                }
            }
        }
        None
    }
    roots.iter().find_map(|r| walk(r, project, 4))
}

/// One pass: takes in what others wrote, writes what the folder lacks.
/// Called now and then (and after local changes); safe to call any time.
pub fn sync(project: &Project, folder: &Path, state_file: &Path) -> anyhow::Result<()> {
    let me = project.me().to_string();
    let mut state: State = fs::read(state_file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    fs::create_dir_all(folder.join(&me))?;
    fs::create_dir_all(folder.join("blobs"))?;
    if !folder.join(MARKER).exists() {
        write_atomic(&folder.join(MARKER), &serde_json::to_vec(&serde_json::json!({ "id": project.id }))?)?;
    }

    // Others' writing.
    let mut writers: Vec<String> = fs::read_dir(folder)?
        .flatten()
        .filter(|i| i.path().is_dir())
        .filter_map(|i| i.file_name().into_string().ok())
        .filter(|n| n != &me && n != "blobs" && !n.starts_with('.'))
        .collect();
    writers.sort();
    for writer in &writers {
        let dir = folder.join(writer);
        if let Ok(s) = fs::read(dir.join("snapshot.bin")).map_err(anyhow::Error::from).and_then(|b| Ok(postcard::from_bytes::<SnapshotFile>(&b)?)) {
            let s = Snapshot { author: s.author, covers: s.covers, data: s.data, sig: s.sig };
            project.receive_snapshot(s, &format!("folder:{writer}"))?;
        }
        let mut segs: Vec<PathBuf> = fs::read_dir(&dir)?
            .flatten()
            .map(|i| i.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("seg"))
            .collect();
        segs.sort();
        for seg in segs {
            let key = format!("{writer}/{}", seg.file_name().unwrap().to_string_lossy());
            let size = fs::metadata(&seg).map(|m| m.len()).unwrap_or(0);
            if state.read.get(&key) == Some(&size) {
                continue;
            }
            // Not whole yet (still downloading, a placeholder): next time.
            let Some(entries) = fs::read(&seg).ok().and_then(|b| decode(&b)) else { continue };
            let mut whole = true;
            for e in entries {
                let (author, n) = (e.author.clone(), e.n);
                let refused = project.refused();
                project.receive(e, &format!("folder:{writer}"))?;
                let have = project.vector().get(&author).copied().unwrap_or(0);
                // Refused (forged): skipped for good. Not yet in order: later.
                if have < n && project.refused() == refused {
                    // One before it hasn't arrived: read this again later.
                    whole = false;
                }
                let f = state.in_folder.entry(author).or_insert(0);
                *f = (*f).max(n.min(have));
            }
            if whole {
                state.read.insert(key, size);
            }
        }
        if let Ok(h) = fs::read(dir.join("has.json")).map_err(anyhow::Error::from).and_then(|b| Ok(serde_json::from_slice::<Has>(&b)?)) {
            let mut m = members::Members::new();
            m.insert(writer.clone(), members::Known { has: h.has, at: h.at });
            project.heard(writer, &Vector::new(), Some(&m));
        }
    }

    // Ours, written again if someone deleted them.
    let mine_dir = folder.join(&me);
    if state.mine.iter().any(|n| !mine_dir.join(n).exists()) {
        state.mine.clear();
        state.in_folder = Vector::new();
        state.snapshot_written = None;
        for writer in &writers {
            state.read.retain(|k, _| !k.starts_with(&format!("{writer}/")));
        }
    }
    if let Some(s) = project.snapshot() {
        if state.snapshot_written.as_ref() != Some(&s.covers) || !mine_dir.join("snapshot.bin").exists() {
            let file = SnapshotFile { author: s.author, covers: s.covers.clone(), sig: s.sig, data: s.data };
            write_atomic(&mine_dir.join("snapshot.bin"), &postcard::to_stdvec(&file)?)?;
            state.snapshot_written = Some(s.covers);
        }
    }
    let (_, missing) = project.missing_for(&state.in_folder, None);
    if !missing.is_empty() {
        let name = format!("{:010}.seg", state.next);
        write_atomic(&mine_dir.join(&name), &encode(&missing))?;
        state.next += 1;
        state.mine.push(name);
        for e in &missing {
            let f = state.in_folder.entry(e.author.clone()).or_insert(0);
            *f = (*f).max(e.n);
        }
    }
    write_atomic(
        &mine_dir.join("has.json"),
        &serde_json::to_vec(&Has { has: project.vector(), at: members::now() })?,
    )?;

    // Files: ours in, wanted ones out.
    for name in project.blobs.names() {
        let path = folder.join("blobs").join(&name);
        if !path.exists() {
            if let Some(data) = project.blob(&name) {
                write_atomic(&path, &data)?;
            }
        }
    }
    for item in fs::read_dir(folder.join("blobs"))?.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if project.should_fetch(&name) {
            if let Ok(data) = fs::read(item.path()) {
                project.receive_blob(&name, &data, "folder")?;
            }
        }
    }

    fs::write(state_file, serde_json::to_vec(&state)?)?;
    Ok(())
}
