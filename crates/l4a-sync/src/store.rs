//! A project's log on disk: one append-only file per author in the
//! project's folder, each entry `[u64 n][u32 length][data]`. Written as
//! entries arrive and flushed to disk each time; on reading, an entry cut
//! short by a crash is dropped (and the file trimmed back to the last whole
//! one), so a log is never left unreadable.

use crate::log::{Entry, Log};
use anyhow::Context;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

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
            while at + 12 <= bytes.len() {
                let n = u64::from_be_bytes(bytes[at..at + 8].try_into().unwrap());
                let len = u32::from_be_bytes(bytes[at + 8..at + 12].try_into().unwrap()) as usize;
                if at + 12 + len > bytes.len() {
                    break;
                }
                let data = bytes[at + 12..at + 12 + len].to_vec();
                // The author's real id is kept in each entry's file by name;
                // ids are already safe as names, so the stem is the id.
                log.add(Entry { author: author_file.to_string(), n, data });
                at += 12 + len;
                whole = at;
            }
            if whole < bytes.len() {
                // Cut short by a crash: trimmed back to the last whole entry.
                OpenOptions::new().write(true).open(&path)?.set_len(whole as u64)?;
            }
        }
        Ok(log)
    }

    /// Adds an entry to its author's file, on disk before it returns.
    pub fn append(&self, entry: &Entry) -> anyhow::Result<()> {
        let path = self.dir.join(file_name(&entry.author));
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        let mut frame = Vec::with_capacity(12 + entry.data.len());
        frame.extend_from_slice(&entry.n.to_be_bytes());
        frame.extend_from_slice(&(entry.data.len() as u32).to_be_bytes());
        frame.extend_from_slice(&entry.data);
        file.write_all(&frame)?;
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
            let e = log.append("alice", data);
            store.append(&e)?;
        }
        // A crash halfway through a third.
        let mut f = OpenOptions::new().append(true).open(dir.path().join("alice.log"))?;
        f.write_all(&3u64.to_be_bytes())?;
        f.write_all(&100u32.to_be_bytes())?;
        f.write_all(b"partial")?;
        drop(f);

        let again = Store::open(dir.path())?.load()?;
        assert_eq!(again.len(), 2);
        // And it's whole again: the next entry follows on.
        let store = Store::open(dir.path())?;
        let mut log = again;
        let e = log.append("alice", b"three".to_vec());
        store.append(&e)?;
        assert_eq!(Store::open(dir.path())?.load()?.len(), 3);
        Ok(())
    }
}
