//! What each member of a project has, as far as this copy knows: learned
//! when meeting them, from their acknowledgements as changes arrive, and
//! passed on by other members (so a copy knows what a member it never meets
//! has). Vectors only grow, so merging two accounts is taking the larger of
//! each; the time is when that was last known.
//!
//! This is what tells a copy whose changes haven't reached whom, when an
//! old part of the history is no longer needed by anyone, and who is in the
//! project.

use crate::log::Vector;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Known {
    /// What the member had.
    pub has: Vector,
    /// When that was known (seconds since 1970, by the clock of whoever saw it).
    pub at: u64,
}

/// By member id.
pub type Members = BTreeMap<String, Known>;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// That `member` had `has` at `at`. Returns whether anything changed.
pub fn note(members: &mut Members, member: &str, has: &Vector, at: u64) -> bool {
    let known = members.entry(member.to_string()).or_default();
    let mut changed = false;
    for (author, &n) in has {
        let mine = known.has.entry(author.clone()).or_insert(0);
        if n > *mine {
            *mine = n;
            changed = true;
        }
    }
    if at > known.at {
        known.at = at;
        changed = true;
    }
    changed
}

/// Another copy's account, folded into ours (except what it says of `me`:
/// this copy knows best what it has).
pub fn merge(members: &mut Members, from: &Members, me: &str) -> bool {
    let mut changed = false;
    for (member, known) in from {
        if member != me {
            changed |= note(members, member, &known.has, known.at);
        }
    }
    changed
}

/// How many entries of `mine` a member with `theirs` lacks.
pub fn lacking(mine: &Vector, theirs: &Vector) -> u64 {
    mine.iter()
        .map(|(a, &n)| n.saturating_sub(theirs.get(a).copied().unwrap_or(0)))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(pairs: &[(&str, u64)]) -> Vector {
        pairs.iter().map(|(a, n)| (a.to_string(), *n)).collect()
    }

    #[test]
    fn accounts_only_grow_and_mine_stays_mine() {
        let mut m = Members::new();
        note(&mut m, "luis", &v(&[("ana", 3)]), 100);
        let mut other = Members::new();
        // Older and smaller: nothing lost. Newer and larger: taken.
        note(&mut other, "luis", &v(&[("ana", 2), ("luis", 5)]), 50);
        note(&mut other, "me", &v(&[("me", 1)]), 200);
        assert!(merge(&mut m, &other, "me"));
        assert_eq!(m["luis"], Known { has: v(&[("ana", 3), ("luis", 5)]), at: 100 });
        assert!(!m.contains_key("me"));
        assert_eq!(lacking(&v(&[("ana", 5), ("me", 2)]), &m["luis"].has), 4);
    }
}
