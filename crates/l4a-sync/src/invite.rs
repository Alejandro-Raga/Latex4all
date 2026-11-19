//! Invite codes: a short code (`K7QM-3XRP-9TWD`) that stands for a share
//! link for a day, so it can be typed or read out.
//!
//! The code is turned into a signing key and an encryption key. The link,
//! encrypted, is published as a signed record under that signing key's public
//! key to a pkarr relay (the directory iroh already uses to find copies by
//! node id). Whoever has the code works out the same public key, fetches the
//! record and decrypts it. Without the code the record can't be found or
//! read. No server of ours is involved.
//!
//! This module only builds and opens records; the app does the two HTTP
//! requests (`PUT`/`GET <RELAY>/<path>`).

use anyhow::{anyhow, bail, Result};
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use iroh::SecretKey;
use iroh_dns::pkarr::SignedPacket;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Where records are published and fetched.
pub const RELAY: &str = "https://dns.iroh.link/pkarr";

/// How long a code works.
pub const VALID_FOR: Duration = Duration::from_secs(24 * 60 * 60);

/// No 0/O, 1/I/L or U, so codes read out and typed survive.
const LETTERS: &[u8] = b"23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LEN: usize = 12;
const NAME: &str = "_l4a";
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// A new random code, shown as `XXXX-XXXX-XXXX` (about 59 bits).
pub fn new_code() -> String {
    let mut rng = rand::thread_rng();
    let chars: String = (0..LEN)
        .map(|_| LETTERS[(rng.next_u32() as usize) % LETTERS.len()] as char)
        .collect();
    format!("{}-{}-{}", &chars[..4], &chars[4..8], &chars[8..])
}

/// The code's letters alone, upper case, or `None` if it isn't one
/// (spaces, dashes and lower case are fine).
pub fn normalize(code: &str) -> Option<String> {
    let mut out = String::new();
    for c in code.chars() {
        let c = c.to_ascii_uppercase();
        if matches!(c, ' ' | '-' | '.') {
            continue;
        }
        if !c.is_ascii() || !LETTERS.contains(&(c as u8)) {
            return None;
        }
        out.push(c);
    }
    (out.len() == LEN).then_some(out)
}

/// Whether text looks like a code (so the app tries to look it up).
pub fn looks_like_code(text: &str) -> bool {
    normalize(text).is_some()
}

fn derive(code: &str, purpose: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"latex4all-invite/");
    h.update(purpose.as_bytes());
    h.update(b"/");
    h.update(code.as_bytes());
    h.finalize().into()
}

fn signing_key(code: &str) -> SecretKey {
    SecretKey::from_bytes(&derive(code, "sign"))
}

/// The path under [`RELAY`] where the code's record lives.
pub fn path(code: &str) -> Result<String> {
    let code = normalize(code).ok_or_else(|| anyhow!("not an invite code"))?;
    Ok(signing_key(&code).public().to_z32())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The record to publish (`PUT <RELAY>/<path>` with this body) so `code`
/// stands for `link` until `valid_for` from now.
pub fn record(code: &str, link: &str, valid_for: Duration) -> Result<(String, Vec<u8>)> {
    let code = normalize(code).ok_or_else(|| anyhow!("not an invite code"))?;
    let until = now() + valid_for.as_secs();
    let plain = format!("{until} {link}");
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&derive(&code, "encrypt")));
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let sealed = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
        .map_err(|_| anyhow!("couldn't encrypt"))?;
    let mut bytes = nonce.to_vec();
    bytes.extend_from_slice(&sealed);
    let value = B64.encode(&bytes);
    if value.len() > 255 {
        bail!("link too long for an invite code");
    }
    let key = signing_key(&code);
    let packet = SignedPacket::from_txt_strings(&key, NAME, [value], valid_for.as_secs() as u32)
        .map_err(|e| anyhow!("{e}"))?;
    Ok((key.public().to_z32(), packet.to_relay_payload()))
}

/// The link a fetched record (`GET <RELAY>/<path>`) stands for, if it's the
/// code's, opens with it and hasn't expired.
pub fn open(code: &str, payload: &[u8]) -> Result<String> {
    let code = normalize(code).ok_or_else(|| anyhow!("not an invite code"))?;
    let public = signing_key(&code).public();
    let packet = SignedPacket::from_relay_payload(&public, payload)
        .map_err(|_| anyhow!("that code's record isn't valid"))?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&derive(&code, "encrypt")));
    for value in packet.txt_records(NAME) {
        let Ok(bytes) = B64.decode(value.as_bytes()) else { continue };
        if bytes.len() < 12 {
            continue;
        }
        let Ok(plain) = cipher.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]) else {
            continue;
        };
        let plain = String::from_utf8(plain).map_err(|_| anyhow!("bad record"))?;
        let (until, link) = plain.split_once(' ').ok_or_else(|| anyhow!("bad record"))?;
        if until.parse::<u64>().unwrap_or(0) < now() {
            bail!("That code has expired. Ask for a new one.");
        }
        return Ok(link.to_string());
    }
    bail!("that code's record isn't valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_stand_for_their_link() {
        let code = new_code();
        assert_eq!(code.len(), 14);
        assert!(looks_like_code(&code));
        assert!(looks_like_code(&code.to_lowercase().replace('-', " ")));
        let link = "latex4all://join/Xq3fAbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd";
        let (path, body) = record(&code, link, VALID_FOR).unwrap();
        assert_eq!(path, super::path(&code).unwrap());
        assert_eq!(open(&code, &body).unwrap(), link);
        // Another code can't open it.
        assert!(open(&new_code(), &body).is_err());
        // An expired one is refused.
        let (_, old) = record(&code, link, Duration::ZERO).unwrap();
        std::thread::sleep(Duration::from_millis(1100));
        assert!(open(&code, &old).is_err());
    }

    #[test]
    fn typos_are_not_codes() {
        assert!(!looks_like_code("hello"));
        assert!(!looks_like_code("K7QM-3XRP-9TW"));
        assert!(!looks_like_code("K7QM-3XRP-9TWO"));
    }
}
