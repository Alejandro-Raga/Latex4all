//! Sealing a secret for one member: only the holder of that member's node
//! key can open it. The node key is an Ed25519 key; its X25519 form gives a
//! Diffie-Hellman secret with a one-off key made for each sealing, from
//! which HKDF-SHA256 derives a ChaCha20-Poly1305 key. A sealed secret is
//! the one-off public key followed by the ciphertext.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use curve25519_dalek::edwards::CompressedEdwardsY;
use curve25519_dalek::montgomery::MontgomeryPoint;
use hkdf::Hkdf;
use iroh::{PublicKey, SecretKey};
use sha2::{Digest, Sha256, Sha512};

/// A member's X25519 public key, from its node id.
fn x_public(member: &PublicKey) -> Option<MontgomeryPoint> {
    Some(CompressedEdwardsY(*member.as_bytes()).decompress()?.to_montgomery())
}

/// This copy's X25519 secret, from its node key (as Ed25519 derives it).
fn x_secret(key: &SecretKey) -> [u8; 32] {
    let h = Sha512::digest(key.to_bytes());
    h[..32].try_into().unwrap()
}

fn cipher(shared: &MontgomeryPoint, one_off: &MontgomeryPoint, to: &MontgomeryPoint) -> ChaCha20Poly1305 {
    let mut info = b"latex4all-seal".to_vec();
    info.extend_from_slice(one_off.as_bytes());
    info.extend_from_slice(to.as_bytes());
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(None, shared.as_bytes())
        .expand(&info, &mut key)
        .expect("32 bytes is a valid length");
    ChaCha20Poly1305::new(Key::from_slice(&key))
}

/// `secret`, sealed for `member` (by node id).
pub fn seal(member: &str, secret: &[u8]) -> anyhow::Result<Vec<u8>> {
    let member: PublicKey = member.parse()?;
    let to = x_public(&member).ok_or_else(|| anyhow::anyhow!("not a member's key"))?;
    let one_off_secret: [u8; 32] = rand::random();
    let one_off = MontgomeryPoint::mul_base_clamped(one_off_secret);
    let shared = to.mul_clamped(one_off_secret);
    // A fresh key every time, so a fixed nonce is safe.
    let ct = cipher(&shared, &one_off, &to)
        .encrypt(Nonce::from_slice(&[0u8; 12]), secret)
        .map_err(|_| anyhow::anyhow!("sealing failed"))?;
    let mut out = one_off.as_bytes().to_vec();
    out.extend_from_slice(&ct);
    Ok(out)
}

/// A secret sealed for this copy, opened; none if it wasn't for it, or was
/// changed.
pub fn open(key: &SecretKey, sealed: &[u8]) -> Option<Vec<u8>> {
    if sealed.len() < 32 {
        return None;
    }
    let one_off = MontgomeryPoint(sealed[..32].try_into().ok()?);
    let mine = x_secret(key);
    let me = MontgomeryPoint::mul_base_clamped(mine);
    let shared = one_off.mul_clamped(mine);
    cipher(&shared, &one_off, &me)
        .decrypt(Nonce::from_slice(&[0u8; 12]), &sealed[32..])
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_member_it_was_sealed_for_opens_it() -> anyhow::Result<()> {
        let (ana, luis) = (SecretKey::generate(), SecretKey::generate());
        let sealed = seal(&ana.public().to_string(), b"the new key")?;
        assert_eq!(open(&ana, &sealed), Some(b"the new key".to_vec()));
        assert_eq!(open(&luis, &sealed), None);
        let mut changed = sealed.clone();
        *changed.last_mut().unwrap() ^= 1;
        assert_eq!(open(&ana, &changed), None);
        // Each sealing differs, though the secret is the same.
        assert_ne!(seal(&ana.public().to_string(), b"the new key")?, sealed);
        Ok(())
    }
}
