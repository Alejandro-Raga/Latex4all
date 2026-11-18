//! Large files (PDFs, figures, data), kept apart from the log: each stored
//! once, named by the SHA-256 of its bytes (already encrypted by the app),
//! in `<project>/blobs/`. An entry refers to a file by that name, so the
//! history stays small; copies fetch the files they need, and a hub keeps
//! them all. A file is only kept if its bytes match its name, so no copy
//! can pass off one file as another.

use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Files are sent in pieces this big.
pub const PIECE: usize = 1 << 20;

pub struct Blobs {
    dir: PathBuf,
}

/// A file's name: the SHA-256 of its bytes, in hex.
pub fn name_of(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

fn valid(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl Blobs {
    pub fn open(project_dir: &Path) -> anyhow::Result<Self> {
        let dir = project_dir.join("blobs");
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    /// Keeps a file; returns its name.
    pub fn put(&self, data: &[u8]) -> anyhow::Result<String> {
        let name = name_of(data);
        self.put_named(&name, data)?;
        Ok(name)
    }

    /// Keeps a file received under `name`, if its bytes are that file.
    pub fn put_named(&self, name: &str, data: &[u8]) -> anyhow::Result<bool> {
        if !valid(name) || name_of(data) != name {
            return Ok(false);
        }
        let path = self.dir.join(name);
        if path.exists() {
            return Ok(true);
        }
        let tmp = self.dir.join(format!("{name}.part"));
        let mut f = File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        fs::rename(&tmp, &path)?;
        Ok(true)
    }

    pub fn get(&self, name: &str) -> Option<Vec<u8>> {
        if !valid(name) {
            return None;
        }
        fs::read(self.dir.join(name)).ok()
    }

    pub fn has(&self, name: &str) -> bool {
        valid(name) && self.dir.join(name).exists()
    }

    /// Every file kept.
    pub fn names(&self) -> Vec<String> {
        fs::read_dir(&self.dir)
            .map(|items| {
                items
                    .filter_map(|i| i.ok()?.file_name().into_string().ok())
                    .filter(|n| valid(n))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_is_kept_only_under_its_own_name() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let blobs = Blobs::open(dir.path())?;
        let name = blobs.put(b"figure")?;
        assert_eq!(blobs.get(&name), Some(b"figure".to_vec()));
        assert!(!blobs.put_named(&name_of(b"other"), b"figure")?);
        assert!(blobs.get("../../etc/passwd").is_none());
        assert_eq!(blobs.names(), vec![name]);
        Ok(())
    }
}
