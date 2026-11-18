//! Every entry is signed by the copy that wrote it, with its node key (its
//! id is the public half), so no member can write as another, or change an
//! entry on its way: through a member, a hub or a shared folder. The
//! signature covers the project, the author, the number and the data.

use crate::log::Entry;
use iroh::{PublicKey, SecretKey, Signature};
use sha2::{Digest, Sha256};

fn message(project: &str, author: &str, n: u64, data: &[u8]) -> Vec<u8> {
    let mut m = b"latex4all-entry\0".to_vec();
    for part in [project.as_bytes(), author.as_bytes()] {
        m.extend_from_slice(&(part.len() as u32).to_be_bytes());
        m.extend_from_slice(part);
    }
    m.extend_from_slice(&n.to_be_bytes());
    m.extend_from_slice(&Sha256::digest(data));
    m
}

/// A new entry of `key`'s, signed.
pub fn entry(key: &SecretKey, project: &str, n: u64, data: Vec<u8>) -> Entry {
    let author = key.public().to_string();
    let sig = key.sign(&message(project, &author, n, &data)).to_bytes().to_vec();
    Entry { author, n, data, sig }
}

/// Whether `entry` was written by its author, unchanged, for this project.
pub fn verify(project: &str, entry: &Entry) -> bool {
    let Ok(author) = entry.author.parse::<PublicKey>() else {
        return false;
    };
    let Ok(sig) = <[u8; Signature::LENGTH]>::try_from(entry.sig.as_slice()) else {
        return false;
    };
    author
        .verify(
            &message(project, &entry.author, entry.n, &entry.data),
            &Signature::from_bytes(&sig),
        )
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_author_signs_and_nothing_changes_unseen() {
        let alice = SecretKey::generate();
        let e = entry(&alice, "paper", 1, b"hello".to_vec());
        assert!(verify("paper", &e));
        // Another project, another number, other data, another author:
        assert!(!verify("other", &e));
        assert!(!verify("paper", &Entry { n: 2, ..e.clone() }));
        assert!(!verify("paper", &Entry { data: b"hellO".to_vec(), ..e.clone() }));
        let bob = SecretKey::generate().public().to_string();
        assert!(!verify("paper", &Entry { author: bob, ..e.clone() }));
        assert!(!verify("paper", &Entry { sig: vec![0; 64], ..e }));
    }
}
