//! Latex4All's sync between copies of the app: no accounts, no central
//! server. See `docs/sync.md` for the design.
//!
//! - [`log`]: a shared project as a log of encrypted changes, each named by
//!   its author and a number; what a copy has, as a version vector.
//! - [`proof`]: two copies show each other they hold the project's key
//!   without sending it.
//! - [`session`]: one sync between two copies over an iroh connection.

pub mod log;
pub mod proof;
pub mod session;

/// The protocol's name on the wire (iroh's ALPN).
pub const ALPN: &[u8] = b"latex4all/sync/1";
