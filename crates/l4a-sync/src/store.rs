//! A project's log on disk: one append-only file per author in the
//! project's folder, each entry `[u64 n][u32 length][64-byte signature][data]`. Written as
//! entries arrive and flushed to disk each time; on reading, an entry cut
//! short by a crash is dropped (and the file trimmed back to the last whole
//! one), so a log is never left unreadable.
//!
//! The snapshot, if any, is `snapshot.bin`: `[u32 length][JSON of author,
//! covers, signature][data]`. It and the files rewritten when old entries
//! are dropped are written to a temporary file first and then put in place,
//! so a crash leaves the old or the new, never half of either.

use crate::log::{Entry, Log, Snapshot, Vector};
use serde::{Deserialize, Serialize};
use anyhow::Context;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
struct SnapshotHead {
    author: String,
    covers: Vector,
    sig: Vec<u8>,
}

fn frame(entry: &Entry) -> anyhow::Result<Vec<u8>> {
    anyhow::ensure!(entry.sig.len() == 64, "an entry without its signature");
    let mut frame = Vec::with_capacity(HEAD + entry.data.len());
    frame.extend_from_slice(&entry.n.to_be_bytes());
    frame.extend_from_slice(&(entry.data.len() as u32).to_be_bytes());
    frame.extend_from_slice(&entry.sig);
    frame.extend_from_slice(&entry.data);
    Ok(frame)
}

/// n, length, signature.
const HEAD: usize = 8 + 4 + 64;

pub struct Store {
    dir: PathBuf,
}

/// An author's file name: its id with anything but letters, digits and `-`
/// replaced, so no id can reach outside the folder.
fn file_name(author: &str) -> String {
    let safe: String = author
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    format!("{safe}.log")
}

impl Store {
    pub fn open(dir: impl AsRef<Path>) -> anyhow::Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        Ok(Self { dir })
    }

    /// Everything kept, as a log.
    pub fn load(&self) -> anyhow::Result<Log> {
        let mut log = Log::new();
        if let Some(s) = self.read_snapshot()? {
            log.take_snapshot(s);
        }
        for item in fs::read_dir(&self.dir)? {
            let path = item?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("log") {
                continue;
            }
            let author_file = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
            let mut bytes = Vec::new();
            File::open(&path)?.read_to_end(&mut bytes)?;
            let mut at = 0usize;
            let mut whole = 0usize;
            while at + HEAD <= bytes.len() {
                let n = u64::from_be_bytes(bytes[at..at + 8].try_into().unwrap());
                let len = u32::from_be_bytes(bytes[at + 8..at + 12].try_into().unwrap()) as usize;
                if at + HEAD + len > bytes.len() {
                    break;
                }
                let sig = bytes[at + 12..at + HEAD].to_vec();
                let data = bytes[at + HEAD..at + HEAD + len].to_vec();
                // Ids are already safe as names, so the stem is the id.
                log.add_loaded(Entry { author: author_file.to_string(), n, data, sig });
                at += HEAD + len;
                whole = at;
            }
            if whole < bytes.len() {
                // Cut short by a crash: trimmed back to the last whole entry.
                OpenOptions::new().write(true).open(&path)?.set_len(whole as u64)?;
            }
        }
        Ok(log)
    }

    fn read_snapshot(&self) -> anyhow::Result<Option<Snapshot>> {
        let Ok(bytes) = fs::read(self.dir.join("snapshot.bin")) else {
            return Ok(None);
        };
        anyhow::ensure!(bytes.len() >= 4, "snapshot cut short");
        let len = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
        anyhow::ensure!(bytes.len() >= 4 + len, "snapshot cut short");
        let head: SnapshotHead = serde_json::from_slice(&bytes[4..4 + len])?;
        Ok(Some(Snapshot {
            author: head.author,
            covers: head.covers,
            sig: head.sig,
            data: bytes[4 + len..].to_vec(),
        }))
    }

    /// Keeps a snapshot (in place of the one before).
    pub fn put_snapshot(&self, s: &Snapshot) -> anyhow::Result<()> {
        let head = serde_json::to_vec(&SnapshotHead {
            author: s.author.clone(),
            covers: s.covers.clone(),
            sig: s.sig.clone(),
        })?;
        let mut bytes = Vec::with_capacity(4 + head.len() + s.data.len());
        bytes.extend_from_slice(&(head.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&head);
        bytes.extend_from_slice(&s.data);
        self.replace("snapshot.bin", &bytes)
    }

    /// Writes the log's entries again, without those it dropped.
    pub fn rewrite(&self, log: &Log) -> anyhow::Result<()> {
        for (author, entries) in log.chains() {
            let mut bytes = Vec::new();
            for e in entries {
                bytes.extend_from_slice(&frame(e)?);
            }
            self.replace(&file_name(author), &bytes)?;
        }
        Ok(())
    }

    /// A file's new contents: written beside it, synced, then moved over it.
    fn replace(&self, name: &str, bytes: &[u8]) -> anyhow::Result<()> {
        let tmp = self.dir.join(format!("{name}.new"));
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, self.dir.join(name))?;
        Ok(())
    }

    /// Adds an entry to its author's file, on disk before it returns.
    pub fn append(&self, entry: &Entry) -> anyhow::Result<()> {
        let path = self.dir.join(file_name(&entry.author));
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        file.write_all(&frame(entry)?)?;
        file.sync_data()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_entries_and_survives_a_cut_short_one() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let store = Store::open(dir.path())?;
        let mut log = Log::new();
        for data in [b"one".to_vec(), b"two".to_vec()] {
            let mut e = log.append("alice", data);
            e.sig = vec![7; 64];
            store.append(&e)?;
        }
        // A crash halfway through a third.
        let mut f = OpenOptions::new().append(true).open(dir.path().join("alice.log"))?;
        f.write_all(&3u64.to_be_bytes())?;
        f.write_all(&100u32.to_be_bytes())?;
        f.write_all(&[7; 64])?;
        f.write_all(b"partial")?;
        drop(f);

        let again = Store::open(dir.path())?.load()?;
        assert_eq!(again.len(), 2);
        // And it's whole again: the next entry follows on.
        let store = Store::open(dir.path())?;
        let mut log = again;
        let mut e = log.append("alice", b"three".to_vec());
        e.sig = vec![7; 64];
        store.append(&e)?;
        assert_eq!(Store::open(dir.path())?.load()?.len(), 3);
        Ok(())
    }
}
