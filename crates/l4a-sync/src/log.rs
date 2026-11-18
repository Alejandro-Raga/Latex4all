//! A shared project's changes: entries named by their author (a copy's node
//! id, or `relay` for what came from the old relay, numbered by its own
//! sequence) and a number the author counts up from 1. Every copy keeps the
//! whole log; what it has is its [`Vector`].

use std::collections::BTreeMap;

/// Who wrote an entry: a copy's node id (hex), or `relay`.
pub type Author = String;

/// The relay's log, imported: the same numbers for everyone.
pub const RELAY: &str = "relay";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub author: Author,
    /// 1, 2, 3… for each author.
    pub n: u64,
    /// The change, encrypted by the app. The log never reads it.
    pub data: Vec<u8>,
}

/// For each author, the highest number a copy has (it has all below too).
pub type Vector = BTreeMap<Author, u64>;

/// The entries of one project, kept in memory (the app persists them).
#[derive(Default, Debug, Clone)]
pub struct Log {
    entries: BTreeMap<Author, Vec<Entry>>,
}

impl Log {
    pub fn new() -> Self {
        Self::default()
    }

    /// What this copy has.
    pub fn vector(&self) -> Vector {
        self.entries
            .iter()
            .map(|(a, list)| (a.clone(), list.len() as u64))
            .collect()
    }

    /// Adds an entry if it's the next one of its author; one already here
    /// is ignored, one with a gap before it is refused (it comes later, in
    /// order). Returns whether it was added.
    pub fn add(&mut self, entry: Entry) -> bool {
        let list = self.entries.entry(entry.author.clone()).or_default();
        let next = list.len() as u64 + 1;
        if entry.n == next {
            list.push(entry);
            true
        } else {
            false
        }
    }

    /// Writes a new change of `author`'s, numbered after its last.
    pub fn append(&mut self, author: &str, data: Vec<u8>) -> Entry {
        let n = self.entries.get(author).map_or(0, |l| l.len() as u64) + 1;
        let entry = Entry {
            author: author.to_string(),
            n,
            data,
        };
        self.add(entry.clone());
        entry
    }

    /// What a copy with `theirs` lacks, in order.
    pub fn missing_for(&self, theirs: &Vector) -> Vec<Entry> {
        let mut out = Vec::new();
        for (author, list) in &self.entries {
            let have = theirs.get(author).copied().unwrap_or(0) as usize;
            out.extend(list.iter().skip(have).cloned());
        }
        out
    }

    pub fn len(&self) -> usize {
        self.entries.values().map(Vec::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_only_what_the_other_lacks() {
        let mut a = Log::new();
        a.append("alice", b"1".to_vec());
        a.append("alice", b"2".to_vec());
        a.append(RELAY, b"r1".to_vec());
        let mut b = Log::new();
        b.append("alice", b"1".to_vec());
        let missing = a.missing_for(&b.vector());
        assert_eq!(
            missing.iter().map(|e| (e.author.as_str(), e.n)).collect::<Vec<_>>(),
            vec![("alice", 2), (RELAY, 1)]
        );
        for e in missing {
            assert!(b.add(e));
        }
        assert_eq!(a.vector(), b.vector());
    }

    #[test]
    fn the_same_entry_twice_is_kept_once() {
        let mut a = Log::new();
        let e = a.append("bob", b"x".to_vec());
        assert!(!a.add(e));
        assert_eq!(a.len(), 1);
    }

    #[test]
    fn an_entry_after_a_gap_waits() {
        let mut a = Log::new();
        assert!(!a.add(Entry { author: "bob".into(), n: 2, data: vec![] }));
        assert!(a.is_empty());
    }
}
