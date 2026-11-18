//! Removing a member: the project's creator writes a signed record that
//! starts a new *epoch* with a new key, sealed (see [`crate::seal`]) for
//! every member who stays: the key and the new membership token for
//! members, the token alone for hubs (which never read anything). The
//! removed member gets neither, so can't prove membership any more; and
//! their entries written after the record are refused everywhere.
//!
//! Only the creator writes these, so there's never two at once. A record can
//! also hand the creator's role to another member.

use crate::log::Vector;
use iroh::{PublicKey, SecretKey, Signature};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rekey {
    /// The epoch it starts: 1, 2, …
    pub epoch: u64,
    /// Who wrote it: the creator until now.
    pub author: String,
    /// The creator from now on (the same, or the member handed the role).
    pub creator: String,
    pub removed: Vec<String>,
    /// What the author had: a removed member's entries after this are refused.
    pub vector: Vector,
    /// For each member who stays, their [`Secret`], sealed for them.
    pub sealed: BTreeMap<String, Vec<u8>>,
    pub sig: Vec<u8>,
}

/// What a member who stays gets.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Secret {
    pub token: Vec<u8>,
    /// The new project key; none for a hub.
    pub key: Option<Vec<u8>>,
}

fn message(project: &str, r: &Rekey) -> anyhow::Result<Vec<u8>> {
    let mut m = b"latex4all-rekey\0".to_vec();
    m.extend_from_slice(&(project.len() as u32).to_be_bytes());
    m.extend_from_slice(project.as_bytes());
    // Postcard writes maps in their (sorted) order: the same everywhere.
    m.extend_from_slice(&postcard::to_stdvec(&Rekey { sig: Vec::new(), ..r.clone() })?);
    Ok(m)
}

/// Signs a record with the creator's key.
pub fn sign(key: &SecretKey, project: &str, mut r: Rekey) -> anyhow::Result<Rekey> {
    r.author = key.public().to_string();
    r.sig = key.sign(&message(project, &r)?).to_bytes().to_vec();
    Ok(r)
}

/// Whether `r` follows on from epoch `epoch - 1`, whose creator is `creator`.
pub fn verify(project: &str, r: &Rekey, epoch_before: u64, creator: &str) -> bool {
    if r.epoch != epoch_before + 1 || r.author != creator {
        return false;
    }
    let (Ok(author), Ok(msg)) = (r.author.parse::<PublicKey>(), message(project, r)) else {
        return false;
    };
    let Ok(sig) = <[u8; Signature::LENGTH]>::try_from(r.sig.as_slice()) else {
        return false;
    };
    author.verify(&msg, &Signature::from_bytes(&sig)).is_ok()
}

/// A project's membership as of now: its epoch's token (and the ones
/// before, to bring a member who's behind up to date), the creator, and the
/// records so far. Kept in `<project>/membership.json`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Membership {
    /// The token of each epoch, from 0.
    pub tokens: Vec<Vec<u8>>,
    pub creator: Option<String>,
    pub rekeys: Vec<Rekey>,
    /// This copy was removed: it no longer syncs.
    #[serde(default)]
    pub removed: bool,
    /// Records that missed this copy (not sealed for it, not removing it),
    /// in order, waiting for one that includes it.
    #[serde(default)]
    pub pending: Vec<Rekey>,
}

impl Membership {
    pub fn epoch(&self) -> u64 {
        self.tokens.len().saturating_sub(1) as u64
    }

    /// The epoch and creator the next record must follow on from.
    pub fn chain_end(&self) -> (u64, Option<&str>) {
        match self.pending.last() {
            Some(r) => (r.epoch, Some(r.creator.as_str())),
            None => (self.epoch(), self.creator.as_deref()),
        }
    }

    pub fn token(&self, epoch: u64) -> Option<&[u8]> {
        self.tokens.get(epoch as usize).map(Vec::as_slice)
    }

    /// Whether `member`, at `their_epoch`, should be brought up to date:
    /// it's among those the latest record was sealed for.
    pub fn stays(&self, member: &str) -> bool {
        self.rekeys.last().is_none_or(|r| r.sealed.contains_key(member) || r.creator == member)
    }

    /// Whether an entry of `author`'s numbered `n` comes from after its
    /// author was removed.
    pub fn refuses(&self, author: &str, n: u64) -> bool {
        self.rekeys.iter().any(|r| {
            r.removed.iter().any(|m| m == author) && n > r.vector.get(author).copied().unwrap_or(0)
        })
    }

    pub fn was_removed(&self, member: &str) -> bool {
        self.rekeys.iter().any(|r| r.removed.iter().any(|m| m == member))
    }
}
