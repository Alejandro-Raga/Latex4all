//! Showing the other copy you hold the project's key, without sending it:
//! each sends a random challenge, and answers the other's with an HMAC of it
//! under a token derived from the key, bound to both copies' ids so an
//! answer can't be replayed elsewhere.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// A fresh challenge.
pub fn challenge() -> [u8; 32] {
    rand::random()
}

/// The answer to `their_challenge`, from `me` to `them`, with `token` (from
/// the project's key).
pub fn answer(token: &[u8], their_challenge: &[u8], me: &str, them: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(token).expect("any key length");
    mac.update(b"latex4all-sync-proof");
    mac.update(their_challenge);
    mac.update(me.as_bytes());
    mac.update(b"|");
    mac.update(them.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Whether `answer` to `my_challenge` came from a copy that holds the token.
pub fn check(token: &[u8], my_challenge: &[u8], from: &str, me: &str, answer_got: &[u8]) -> bool {
    let mut mac = HmacSha256::new_from_slice(token).expect("any key length");
    mac.update(b"latex4all-sync-proof");
    mac.update(my_challenge);
    mac.update(from.as_bytes());
    mac.update(b"|");
    mac.update(me.as_bytes());
    mac.verify_slice(answer_got).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_key_answers() {
        let c = challenge();
        let good = answer(b"token", &c, "b", "a");
        assert!(check(b"token", &c, "b", "a", &good));
        assert!(!check(b"other", &c, "b", "a", &good));
        // Not reusable between other copies.
        assert!(!check(b"token", &c, "c", "a", &good));
    }
}
