//! A shared project's changes: entries named by their author (a copy's node
//! id) and a number the author counts up from 1, each signed by its author
//! (see [`crate::sign`]). What a copy has is its [`Vector`]. (The old
//! relay's log comes in as the entries of the server that took its place,
//! signed by it.)
//!
//! So the log doesn't grow forever, a member now and then writes a
//! [`Snapshot`]: the whole document as of a vector. A copy far behind (a
//! newcomer) gets the snapshot and the entries after it, and entries a
//! snapshot covers can be dropped once every member has them.

use std::collections::BTreeMap;

/// Who wrote an entry: a copy's node id.
pub type Author = String;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub author: Author,
    /// 1, 2, 3… for each author.
    pub n: u64,
    /// The change, encrypted by the app. The log never reads it.
    pub data: Vec<u8>,
    /// The author's signature of it (64 bytes).
    pub sig: Vec<u8>,
}

/// The whole document as of `covers`, encrypted by the app, signed by the
/// member who wrote it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub author: Author,
    pub covers: Vector,
    pub data: Vec<u8>,
    pub sig: Vec<u8>,
}

/// For each author, the highest number a copy has (it has all below too).
pub type Vector = BTreeMap<Author, u64>;

/// Whether `a` has everything `b` has.
pub fn covers(a: &Vector, b: &Vector) -> bool {
    b.iter().all(|(k, &n)| a.get(k).copied().unwrap_or(0) >= n)
}

/// One author's entries still kept: numbers `base + 1` on.
#[derive(Default, Debug, Clone)]
struct Chain {
    base: u64,
    list: Vec<Entry>,
}

impl Chain {
    fn top(&self) -> u64 {
        self.base + self.list.len() as u64
    }
}

#[derive(Default, Debug, Clone)]
pub struct Log {
    chains: BTreeMap<Author, Chain>,
    snapshot: Option<Snapshot>,
}

impl Log {
    pub fn new() -> Self {
        Self::default()
    }

    /// The highest number of `author`'s this copy has, in entries or in
    /// its snapshot.
    fn have(&self, author: &str) -> u64 {
        let chain = self.chains.get(author).map_or(0, Chain::top);
        let snap = self
            .snapshot
            .as_ref()
            .and_then(|s| s.covers.get(author).copied())
            .unwrap_or(0);
        chain.max(snap)
    }

    /// What this copy has.
    pub fn vector(&self) -> Vector {
        let mut v: Vector = self.chains.iter().map(|(a, c)| (a.clone(), c.top())).collect();
        if let Some(s) = &self.snapshot {
            for (a, &n) in &s.covers {
                let e = v.entry(a.clone()).or_insert(0);
                *e = (*e).max(n);
            }
        }
        v.retain(|_, n| *n > 0);
        v
    }

    pub fn snapshot(&self) -> Option<&Snapshot> {
        self.snapshot.as_ref()
    }

    /// Adds an entry if it's the next one of its author; one already here
    /// is ignored, one with a gap before it is refused (it comes later, in
    /// order). Returns whether it was added.
    pub fn add(&mut self, entry: Entry) -> bool {
        let have = self.have(&entry.author);
        if entry.n != have + 1 {
            return false;
        }
        let chain = self.chains.entry(entry.author.clone()).or_default();
        if chain.top() < have {
            // The snapshot has what came before: the chain starts after it.
            *chain = Chain { base: have, list: Vec::new() };
        }
        chain.list.push(entry);
        true
    }

    /// An entry read back from disk: its file may start after a snapshot
    /// (older entries were dropped), so the first one sets where it begins.
    pub(crate) fn add_loaded(&mut self, entry: Entry) -> bool {
        let chain = self.chains.entry(entry.author.clone()).or_default();
        if chain.list.is_empty() && chain.base == 0 && entry.n > 1 {
            chain.base = entry.n - 1;
        }
        if entry.n != chain.top() + 1 {
            return false;
        }
        chain.list.push(entry);
        true
    }

    /// Writes a new (unsigned) change of `author`'s, numbered after its
    /// last. For tests; real entries are made by [`crate::sign::entry`].
    pub fn append(&mut self, author: &str, data: Vec<u8>) -> Entry {
        let entry = Entry {
            author: author.to_string(),
            n: self.have(author) + 1,
            data,
            sig: Vec::new(),
        };
        self.add(entry.clone());
        entry
    }

    /// The entry `author` numbered `n`, if this copy still has it.
    pub fn get(&self, author: &str, n: u64) -> Option<&Entry> {
        let chain = self.chains.get(author)?;
        let i = usize::try_from(n.checked_sub(chain.base + 1)?).ok()?;
        chain.list.get(i)
    }

    /// What a copy with `theirs` (and snapshot `their_snap`, if any) lacks:
    /// the snapshot, when they need it or it's newer than theirs, then the
    /// entries after what they'll have, in order.
    pub fn missing_for(&self, theirs: &Vector, their_snap: Option<&Vector>) -> (Option<Snapshot>, Vec<Entry>) {
        let mut from = theirs.clone();
        let mut snap = None;
        if let Some(s) = &self.snapshot {
            // Entries dropped that they haven't got: only the snapshot has them.
            let needed = self.chains.iter().any(|(a, c)| theirs.get(a).copied().unwrap_or(0) < c.base)
                || s.covers.iter().any(|(a, &n)| {
                    !self.chains.contains_key(a) && theirs.get(a).copied().unwrap_or(0) < n
                });
            let newer = their_snap.is_none_or(|t| covers(&s.covers, t) && s.covers != *t);
            if needed || newer {
                snap = Some(s.clone());
                if needed {
                    for (a, &n) in &s.covers {
                        let f = from.entry(a.clone()).or_insert(0);
                        *f = (*f).max(n);
                    }
                }
            }
        }
        let mut out = Vec::new();
        for (author, chain) in &self.chains {
            let have = from.get(author).copied().unwrap_or(0);
            out.extend(chain.list.iter().filter(|e| e.n > have).cloned());
        }
        (snap, out)
    }

    /// Everything kept, in order by author.
    pub fn entries(&self) -> Vec<Entry> {
        self.chains.values().flat_map(|c| c.list.iter().cloned()).collect()
    }

    /// Takes a snapshot in. Returns whether this copy lacked part of what
    /// it covers (then the app must merge its document in), and whether it
    /// was kept (the newest, or the first).
    pub fn take_snapshot(&mut self, s: Snapshot) -> (bool, bool) {
        let mine = self.vector();
        let lacked = !covers(&mine, &s.covers);
        if lacked {
            // Entries it covers that this copy lacked are in it now: each
            // chain behind it restarts after it.
            for (a, &n) in &s.covers {
                let top = self.chains.get(a).map_or(0, Chain::top);
                if top < n {
                    self.chains.insert(a.clone(), Chain { base: n, list: Vec::new() });
                }
            }
        }
        let keep = self
            .snapshot
            .as_ref()
            .is_none_or(|old| covers(&s.covers, &old.covers) && s.covers != old.covers)
            || lacked;
        if keep {
            self.snapshot = Some(s);
        }
        (lacked, keep)
    }

    /// Drops entries the snapshot covers. Returns how many.
    pub fn drop_covered(&mut self) -> usize {
        let Some(s) = &self.snapshot else { return 0 };
        let mut dropped = 0;
        for (a, chain) in self.chains.iter_mut() {
            let upto = s.covers.get(a).copied().unwrap_or(0);
            if upto > chain.base {
                let k = ((upto - chain.base) as usize).min(chain.list.len());
                chain.list.drain(..k);
                chain.base += k as u64;
                dropped += k;
            }
        }
        dropped
    }

    /// Entries kept per author, as they'd be written to disk.
    pub(crate) fn chains(&self) -> impl Iterator<Item = (&Author, &[Entry])> {
        self.chains.iter().map(|(a, c)| (a, c.list.as_slice()))
    }

    pub fn len(&self) -> usize {
        self.chains.values().map(|c| c.list.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(covers: &[(&str, u64)]) -> Snapshot {
        Snapshot {
            author: "x".into(),
            covers: covers.iter().map(|(a, n)| (a.to_string(), *n)).collect(),
            data: b"doc".to_vec(),
            sig: vec![],
        }
    }

    #[test]
    fn sends_only_what_the_other_lacks() {
        let mut a = Log::new();
        a.append("alice", b"1".to_vec());
        a.append("alice", b"2".to_vec());
        a.append("hub", b"r1".to_vec());
        let mut b = Log::new();
        b.append("alice", b"1".to_vec());
        let (s, missing) = a.missing_for(&b.vector(), None);
        assert!(s.is_none());
        assert_eq!(
            missing.iter().map(|e| (e.author.as_str(), e.n)).collect::<Vec<_>>(),
            vec![("alice", 2), ("hub", 1)]
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
        assert!(!a.add(Entry { author: "bob".into(), n: 2, data: vec![], sig: vec![] }));
        assert!(a.is_empty());
    }

    #[test]
    fn a_newcomer_gets_the_snapshot_and_what_came_after() {
        let mut a = Log::new();
        for i in 0..5 {
            a.append("alice", vec![i]);
        }
        a.append("bob", b"b1".to_vec());
        a.take_snapshot(snap(&[("alice", 4), ("bob", 1)]));
        assert_eq!(a.drop_covered(), 5);
        assert_eq!(a.len(), 1);
        // Nothing yet: the snapshot, then alice 5.
        let (s, rest) = a.missing_for(&Vector::new(), None);
        assert!(s.is_some());
        assert_eq!(rest.iter().map(|e| e.n).collect::<Vec<_>>(), vec![5]);
        let mut fresh = Log::new();
        let (lacked, kept) = fresh.take_snapshot(s.unwrap());
        assert!(lacked && kept);
        for e in rest {
            assert!(fresh.add(e));
        }
        assert_eq!(fresh.vector(), a.vector());
        // Then it carries on from there.
        assert_eq!(fresh.append("bob", b"b2".to_vec()).n, 2);
    }

    #[test]
    fn a_member_nearly_up_to_date_gets_entries_not_the_snapshot() {
        let mut a = Log::new();
        for i in 0..5 {
            a.append("alice", vec![i]);
        }
        a.take_snapshot(snap(&[("alice", 3)]));
        let theirs: Vector = [("alice".to_string(), 3)].into();
        let (s, rest) = a.missing_for(&theirs, Some(&theirs));
        assert!(s.is_none(), "they have all it covers, and the same snapshot");
        assert_eq!(rest.len(), 2);
    }
}
