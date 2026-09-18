//! Shared projects: keeps a project in sync with everyone else on it.
//!
//! Every change goes through a relay (apps/relay in this repo), which stores
//! it until the other people on the project have it, so opening a shared
//! project always starts by catching up, whether or not anyone else is online.
//! The webview owns the Yjs document; this side owns the connection, the
//! encryption and the files that make the sync survive restarts.
//!
//! **Keys.** A project's invite link is `<relay>/p/<projectId>#<key>`. Two
//! keys are derived from the random 32-byte `key`: an access token, which is
//! all the relay ever sees (and it keeps only its hash), and an AES-256-GCM
//! key for everything sent — updates, cursors, snapshots and files. So the
//! relay, and anything between it and the apps, only handles ciphertext.
//!
//! **Local files**, in the project's `.latex4all/` (already kept out of
//! history and away from Claude):
//! - `collab.json` — the link;
//! - `collab-doc.bin` — the Yjs document, the last relay seq it includes, and
//!   the webview's record of which files it has written to disk, all written
//!   together so none can get ahead of the others;
//! - `collab-outbox.bin` — local changes the relay hasn't confirmed yet,
//!   which is what lets offline edits reach everyone later;
//! - `collab-chat.bin` — the project's chat as far as this device has it,
//!   kept for as long as the relay keeps it.
//!
//! **Compression.** Encrypted data can't be compressed, so the app compresses
//! before encrypting, where it helps. Older apps can't read that, so it only
//! starts once the relay turns them away (its `minProtocol` is 2 or more).

use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use ring::{digest, hmac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, EventTarget, WebviewWindow};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderName, HeaderValue, AUTHORIZATION};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message};
use tokio_tungstenite::WebSocketStream;

/// Where projects are shared unless a link names another relay.
pub const DEFAULT_RELAY: &str = "https://collab.alejandroraga.com";

/// Keep in step with DEFAULT_LIMITS in apps/relay/relay.mjs.
const MAX_UPDATE_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 25 * 1024 * 1024 - 64;
const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_CHAT_BYTES: usize = 3 * 1024 * 1024 - 64;
/// How long chat is kept. Keep in step with chatDays in apps/relay/relay.mjs.
const CHAT_DAYS: u64 = 30;
/// A compressed payload that would inflate past this is refused.
const MAX_INFLATED_BYTES: u64 = 64 * 1024 * 1024;

const KEEPALIVE: Duration = Duration::from_secs(20);
const RETRY_DELAYS: [u64; 5] = [1, 2, 5, 10, 30];

const FRAME_UPDATE: u8 = 1;
const FRAME_AWARENESS: u8 = 2;
const FRAME_SNAPSHOT: u8 = 3;
const FRAME_CHAT: u8 = 4;

const LINK_FILE: &str = "collab.json";
const DOC_FILE: &str = "collab-doc.bin";
const OUTBOX_FILE: &str = "collab-outbox.bin";
const CHAT_FILE: &str = "collab-chat.bin";

/// The relay protocol this app speaks; see the top of apps/relay/relay.mjs.
const PROTOCOL: u32 = 2;
const PROTOCOL_HEADER: &str = "latex4all-protocol";

// ─── Links and keys ───

#[derive(Clone, Debug, PartialEq)]
struct Link {
    /// `https://host[:port]`, without a trailing slash.
    relay: String,
    project_id: String,
    key: [u8; 32],
}

impl Link {
    fn parse(link: &str) -> Result<Self, String> {
        let invalid = || "That link isn't a valid shared project link.".to_string();
        let (url, key) = link.trim().split_once('#').ok_or_else(invalid)?;
        let key: [u8; 32] = URL_SAFE_NO_PAD
            .decode(key)
            .ok()
            .and_then(|k| k.try_into().ok())
            .ok_or_else(invalid)?;
        let (relay, project_id) = url.rsplit_once("/p/").ok_or_else(invalid)?;
        let relay = relay_base(relay).map_err(|_| invalid())?;
        if !is_hex(project_id, 32) {
            return Err(invalid());
        }
        Ok(Self {
            relay,
            project_id: project_id.to_string(),
            key,
        })
    }

    fn generate(relay: &str) -> Result<Self, String> {
        let rng = SystemRandom::new();
        let mut id = [0u8; 16];
        let mut key = [0u8; 32];
        rng.fill(&mut id).map_err(|_| "No randomness available")?;
        rng.fill(&mut key).map_err(|_| "No randomness available")?;
        Ok(Self {
            relay: relay_base(relay)?,
            project_id: hex(&id),
            key,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/p/{}{}", self.relay, self.project_id, path)
    }

    fn sync_url(&self) -> String {
        let url = self.url("/sync");
        match url.strip_prefix("https://") {
            Some(rest) => format!("wss://{rest}"),
            None => format!("ws://{}", url.trim_start_matches("http://")),
        }
    }
}

impl std::fmt::Display for Link {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}#{}", self.url(""), URL_SAFE_NO_PAD.encode(self.key))
    }
}

/// `https://host`, from whatever form of the relay's address was given.
fn relay_base(url: &str) -> Result<String, String> {
    let url = url.trim();
    let (scheme, rest) = if let Some(rest) = url.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = url.strip_prefix("http://") {
        ("http", rest)
    } else {
        ("https", url)
    };
    let rest = rest.trim_end_matches('/');
    if rest.is_empty()
        || rest
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '?' | '#' | '@'))
    {
        return Err("That relay address isn't valid.".into());
    }
    Ok(format!("{scheme}://{rest}"))
}

fn is_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Which kind of thing a ciphertext is. Bound into the encryption, so one
/// can't be passed off as another, nor moved to a different project.
#[derive(Clone, Copy)]
enum Kind {
    Update = 1,
    Awareness = 2,
    Snapshot = 3,
    Blob = 4,
    Chat = 5,
}

fn deflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut encoder =
        flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).ok()?;
    encoder.finish().ok()
}

fn inflate(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(data)
        .take(MAX_INFLATED_BYTES + 1)
        .read_to_end(&mut out)
        .map_err(|_| "Received data that doesn't decompress".to_string())?;
    if out.len() as u64 > MAX_INFLATED_BYTES {
        return Err("Received data that's too large".into());
    }
    Ok(out)
}

/// Projects whose relay only lets in apps that can read compressed data.
fn compressing() -> &'static Mutex<HashSet<String>> {
    static PROJECTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    PROJECTS.get_or_init(Default::default)
}

fn may_compress(project_id: &str) -> bool {
    compressing()
        .lock()
        .map(|projects| projects.contains(project_id))
        .unwrap_or(false)
}

fn set_may_compress(project_id: &str, allowed: bool) {
    if let Ok(mut projects) = compressing().lock() {
        if allowed {
            projects.insert(project_id.to_string());
        } else {
            projects.remove(project_id);
        }
    }
}

struct Keys {
    project_id: String,
    access_token: String,
    cipher: LessSafeKey,
    blob_ids: hmac::Key,
    rng: SystemRandom,
}

impl Keys {
    fn derive(link: &Link) -> Self {
        let root = hmac::Key::new(hmac::HMAC_SHA256, &link.key);
        let sub = |label: &str| hmac::sign(&root, format!("latex4all/{label}").as_bytes());
        let cipher = UnboundKey::new(&AES_256_GCM, sub("encrypt").as_ref())
            .map(LessSafeKey::new)
            .unwrap_or_else(|_| unreachable!("a 32-byte key is always valid for AES-256"));
        Self {
            project_id: link.project_id.clone(),
            access_token: hex(sub("access").as_ref()),
            cipher,
            blob_ids: hmac::Key::new(hmac::HMAC_SHA256, sub("blob-id").as_ref()),
            rng: SystemRandom::new(),
        }
    }

    fn access_hash(&self) -> String {
        hex(digest::digest(&digest::SHA256, self.access_token.as_bytes()).as_ref())
    }

    /// Whether it was compressed first is bound in too, so `open` can tell.
    fn aad(&self, kind: Kind, packed: bool) -> Vec<u8> {
        let mut aad = self.project_id.as_bytes().to_vec();
        aad.push(kind as u8 | if packed { 0x80 } else { 0 });
        aad
    }

    fn seal(&self, kind: Kind, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        self.seal_as(kind, plaintext, false)
    }

    /// Compressed first when `compress` allows it and it saves something.
    fn seal_packed(&self, kind: Kind, plaintext: &[u8], compress: bool) -> Result<Vec<u8>, String> {
        if compress {
            if let Some(packed) = deflate(plaintext).filter(|p| p.len() < plaintext.len() * 9 / 10)
            {
                return self.seal_as(kind, &packed, true);
            }
        }
        self.seal_as(kind, plaintext, false)
    }

    /// `nonce ‖ ciphertext ‖ tag`.
    fn seal_as(&self, kind: Kind, plaintext: &[u8], packed: bool) -> Result<Vec<u8>, String> {
        let mut nonce = [0u8; NONCE_LEN];
        self.rng
            .fill(&mut nonce)
            .map_err(|_| "No randomness available")?;
        let mut sealed = plaintext.to_vec();
        self.cipher
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(self.aad(kind, packed)),
                &mut sealed,
            )
            .map_err(|_| "Encryption failed")?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&sealed);
        Ok(out)
    }

    /// Whichever way it was sealed.
    fn open(&self, kind: Kind, data: &[u8]) -> Result<Vec<u8>, String> {
        match self.open_as(kind, data, false) {
            Ok(plain) => Ok(plain),
            Err(err) => inflate(&self.open_as(kind, data, true).map_err(|_| err)?),
        }
    }

    fn open_as(&self, kind: Kind, data: &[u8], packed: bool) -> Result<Vec<u8>, String> {
        let corrupt = || "Received data that doesn't decrypt".to_string();
        if data.len() < NONCE_LEN {
            return Err(corrupt());
        }
        let (nonce, sealed) = data.split_at(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| corrupt())?;
        let mut sealed = sealed.to_vec();
        let plain = self
            .cipher
            .open_in_place(nonce, Aad::from(self.aad(kind, packed)), &mut sealed)
            .map_err(|_| corrupt())?;
        Ok(plain.to_vec())
    }

    /// Same file, same id, so the relay stores it once; without the key the
    /// id says nothing about the content.
    fn blob_id(&self, plaintext: &[u8]) -> String {
        hex(hmac::sign(&self.blob_ids, plaintext).as_ref())
    }
}

// ─── Local files ───

fn state_dir(project_root: &Path) -> PathBuf {
    project_root.join(".latex4all")
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Local changes the relay hasn't confirmed, oldest first. Kept on disk so a
/// change made offline, or just before a crash, still goes out later. The
/// relay confirms updates in the order they were sent.
struct Outbox {
    path: Option<PathBuf>,
    entries: VecDeque<Vec<u8>>,
}

impl Outbox {
    fn load(path: Option<PathBuf>) -> Self {
        let mut entries = VecDeque::new();
        if let Some(buf) = path.as_ref().and_then(|p| std::fs::read(p).ok()) {
            let mut offset = 0;
            while offset + 4 <= buf.len() {
                let len = u32::from_be_bytes([
                    buf[offset],
                    buf[offset + 1],
                    buf[offset + 2],
                    buf[offset + 3],
                ]) as usize;
                if offset + 4 + len > buf.len() {
                    break;
                }
                entries.push_back(buf[offset + 4..offset + 4 + len].to_vec());
                offset += 4 + len;
            }
        }
        Self { path, entries }
    }

    fn push(&mut self, update: Vec<u8>) {
        if let Some(path) = &self.path {
            let mut record = (update.len() as u32).to_be_bytes().to_vec();
            record.extend_from_slice(&update);
            let appended = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))
                .and_then(|_| {
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(path)
                })
                .and_then(|mut file| file.write_all(&record));
            if let Err(err) = appended {
                eprintln!("[collab] Couldn't save a pending change: {err}");
            }
        }
        self.entries.push_back(update);
    }

    /// The oldest change has been stored by the relay (or refused for good).
    fn confirm(&mut self) {
        self.entries.pop_front();
        if self.entries.is_empty() {
            if let Some(path) = &self.path {
                let _ = std::fs::write(path, []);
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One chat message: `[u64 seq][u64 at][u32 length][message]` on disk.
#[derive(Clone, Debug, PartialEq)]
struct ChatEntry {
    seq: u64,
    at: u64,
    data: Vec<u8>,
}

fn read_chat(path: &Path) -> Vec<ChatEntry> {
    let mut entries = Vec::new();
    let Ok(buf) = std::fs::read(path) else {
        return entries;
    };
    let mut offset = 0;
    while offset + 20 <= buf.len() {
        let seq = u64::from_be_bytes(buf[offset..offset + 8].try_into().unwrap_or_default());
        let at = u64::from_be_bytes(buf[offset + 8..offset + 16].try_into().unwrap_or_default());
        let len = u32::from_be_bytes(buf[offset + 16..offset + 20].try_into().unwrap_or_default())
            as usize;
        if offset + 20 + len > buf.len() {
            break;
        }
        entries.push(ChatEntry {
            seq,
            at,
            data: buf[offset + 20..offset + 20 + len].to_vec(),
        });
        offset += 20 + len;
    }
    entries
}

fn encode_chat(entry: &ChatEntry) -> Vec<u8> {
    let mut record = entry.seq.to_be_bytes().to_vec();
    record.extend_from_slice(&entry.at.to_be_bytes());
    record.extend_from_slice(&(entry.data.len() as u32).to_be_bytes());
    record.extend_from_slice(&entry.data);
    record
}

fn chat_cutoff(now: u64) -> u64 {
    now.saturating_sub(CHAT_DAYS * 24 * 60 * 60 * 1000)
}

/// This device's copy of the chat, so opening a project only fetches what's
/// new. Messages go when the relay would have deleted them too.
struct ChatLog {
    path: Option<PathBuf>,
    /// The last seq this device has.
    after: u64,
}

impl ChatLog {
    fn load(path: Option<PathBuf>, now: u64) -> Self {
        let mut after = 0;
        if let Some(path) = &path {
            let entries = read_chat(path);
            after = entries.last().map_or(0, |e| e.seq);
            let cutoff = chat_cutoff(now);
            if entries.iter().any(|e| e.at < cutoff) {
                let kept: Vec<u8> = entries
                    .iter()
                    .filter(|e| e.at >= cutoff)
                    .flat_map(encode_chat)
                    .collect();
                if let Err(err) = write_atomic(path, &kept) {
                    eprintln!("[collab] Couldn't tidy the chat: {err}");
                }
            }
        }
        Self { path, after }
    }

    /// Keeps a message, unless it's one this device already has.
    fn add(&mut self, entry: &ChatEntry) -> bool {
        if entry.seq <= self.after {
            return false;
        }
        self.after = entry.seq;
        if let Some(path) = &self.path {
            let appended = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))
                .and_then(|_| {
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(path)
                })
                .and_then(|mut file| file.write_all(&encode_chat(entry)));
            if let Err(err) = appended {
                eprintln!("[collab] Couldn't save a chat message: {err}");
            }
        }
        true
    }
}

// ─── Connection ───

/// What the webview hears about, all on the `collab://event` channel.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncEvent {
    /// `connecting`, `online` or `offline`.
    Status {
        state: &'static str,
    },
    /// Everything the relay had has been delivered.
    #[serde(rename_all = "camelCase")]
    CaughtUp {
        seq: u64,
        log_entries: u64,
        log_bytes: u64,
        pending: usize,
        /// How long the relay keeps chat; 0 if it has none.
        chat_days: u64,
    },
    Update {
        seq: u64,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Snapshot {
        up_to: u64,
        data: String,
    },
    Awareness {
        data: String,
    },
    /// A chat message, anyone's, as its sender wrote it, once the relay has
    /// it. `at` is the relay's time, in ms.
    Chat {
        seq: u64,
        at: u64,
        data: String,
    },
    /// The relay stored a local change as `seq`.
    #[serde(rename_all = "camelCase")]
    Ack {
        seq: u64,
        pending: usize,
    },
    #[serde(rename_all = "camelCase")]
    SnapshotAck {
        up_to: u64,
        ok: bool,
    },
    /// `gone` (the project no longer exists, or the link is wrong),
    /// `outdated` (the relay needs a newer app), `quota`, `too-large`,
    /// `corrupt`, or `chat-quota` / `chat-too-large` for a chat message.
    Error {
        code: String,
    },
}

enum Command {
    Publish(Vec<u8>),
    Awareness(Vec<u8>),
    Chat(Vec<u8>),
    Compact {
        up_to: u64,
        snapshot: Vec<u8>,
        live_blobs: Vec<String>,
    },
}

enum SessionEnd {
    Stopped,
    Dropped,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayMessage {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    seq: u64,
    #[serde(default)]
    log_entries: u64,
    #[serde(default)]
    log_bytes: u64,
    #[serde(default)]
    up_to: u64,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    code: String,
    #[serde(default)]
    at: u64,
    #[serde(default)]
    min_protocol: u32,
    #[serde(default)]
    chat_days: u64,
}

/// Keeps one project connected until the command channel closes: reconnects
/// with backoff, and holds local changes in the outbox while offline.
async fn run_connection(
    link: Link,
    keys: Arc<Keys>,
    mut after: u64,
    mut outbox: Outbox,
    mut chat: ChatLog,
    mut commands: mpsc::UnboundedReceiver<Command>,
    emit: impl Fn(SyncEvent),
) {
    // Chat messages the relay hasn't confirmed, in the order sent. Only kept
    // while the app is open.
    let mut chat_pending = VecDeque::new();
    let mut attempt = 0;
    loop {
        emit(SyncEvent::Status {
            state: "connecting",
        });
        let request = link.sync_url().into_client_request().map(|mut request| {
            if let Ok(value) = format!("Bearer {}", keys.access_token).parse() {
                request.headers_mut().insert(AUTHORIZATION, value);
            }
            request.headers_mut().insert(
                HeaderName::from_static(PROTOCOL_HEADER),
                HeaderValue::from(PROTOCOL),
            );
            request
        });
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_MESSAGE_BYTES));
        let connected = match request {
            Ok(request) => {
                tokio_tungstenite::connect_async_with_config(request, Some(config), true).await
            }
            Err(err) => Err(err),
        };
        match connected {
            Ok((ws, _)) => {
                attempt = 0;
                let mut state = SessionState {
                    after: &mut after,
                    outbox: &mut outbox,
                    chat: &mut chat,
                    chat_pending: &mut chat_pending,
                };
                match session(ws, &keys, &mut state, &mut commands, &emit).await {
                    SessionEnd::Stopped => return,
                    SessionEnd::Dropped => {}
                }
            }
            Err(WsError::Http(response)) if matches!(response.status().as_u16(), 401 | 404) => {
                emit(SyncEvent::Error {
                    code: "gone".into(),
                });
                return;
            }
            Err(WsError::Http(response)) if response.status().as_u16() == 426 => {
                emit(SyncEvent::Error {
                    code: "outdated".into(),
                });
                return;
            }
            Err(_) => {}
        }

        emit(SyncEvent::Status { state: "offline" });
        let delay = RETRY_DELAYS[attempt.min(RETRY_DELAYS.len() - 1)];
        attempt += 1;
        let wait = tokio::time::sleep(Duration::from_secs(delay));
        tokio::pin!(wait);
        loop {
            tokio::select! {
                _ = &mut wait => break,
                command = commands.recv() => match command {
                    None => return,
                    Some(Command::Publish(update)) => outbox.push(update),
                    Some(Command::Chat(message)) => chat_pending.push_back(message),
                    Some(_) => {}
                },
            }
        }
    }
}

/// What a connection carries from one session to the next.
struct SessionState<'a> {
    after: &'a mut u64,
    outbox: &'a mut Outbox,
    chat: &'a mut ChatLog,
    chat_pending: &'a mut VecDeque<Vec<u8>>,
}

async fn session<S>(
    ws: WebSocketStream<S>,
    keys: &Keys,
    state: &mut SessionState<'_>,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    emit: &impl Fn(SyncEvent),
) -> SessionEnd
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let SessionState {
        after,
        outbox,
        chat,
        chat_pending,
    } = state;
    let (mut sink, mut stream) = ws.split();

    let sealed_frame = |kind: Kind, frame: u8, data: &[u8]| {
        let compress = !matches!(kind, Kind::Awareness) && may_compress(&keys.project_id);
        keys.seal_packed(kind, data, compress).map(|sealed| {
            let mut out = vec![frame];
            out.extend_from_slice(&sealed);
            Message::Binary(Bytes::from(out))
        })
    };

    let hello = json!({ "type": "hello", "after": **after, "chatAfter": chat.after }).to_string();
    if sink.send(Message::text(hello)).await.is_err() {
        return SessionEnd::Dropped;
    }
    // Whatever didn't get confirmed last time goes again. If the relay had in
    // fact stored some of it, the copies are harmless: Yjs ignores updates it
    // already has.
    for update in outbox.entries.iter() {
        let Ok(frame) = sealed_frame(Kind::Update, FRAME_UPDATE, update) else {
            continue;
        };
        if sink.send(frame).await.is_err() {
            return SessionEnd::Dropped;
        }
    }
    for message in chat_pending.iter() {
        let Ok(frame) = sealed_frame(Kind::Chat, FRAME_CHAT, message) else {
            continue;
        };
        if sink.send(frame).await.is_err() {
            return SessionEnd::Dropped;
        }
    }

    let mut keepalive = tokio::time::interval(KEEPALIVE);
    keepalive.tick().await;
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                None => {
                    let _ = sink.send(Message::Close(None)).await;
                    return SessionEnd::Stopped;
                }
                Some(Command::Publish(update)) => {
                    let frame = sealed_frame(Kind::Update, FRAME_UPDATE, &update);
                    outbox.push(update);
                    let Ok(frame) = frame else { continue };
                    if sink.send(frame).await.is_err() {
                        return SessionEnd::Dropped;
                    }
                }
                Some(Command::Chat(message)) => {
                    let frame = sealed_frame(Kind::Chat, FRAME_CHAT, &message);
                    chat_pending.push_back(message);
                    let Ok(frame) = frame else { continue };
                    if sink.send(frame).await.is_err() {
                        return SessionEnd::Dropped;
                    }
                }
                Some(Command::Awareness(data)) => {
                    if let Ok(frame) = sealed_frame(Kind::Awareness, FRAME_AWARENESS, &data) {
                        if sink.send(frame).await.is_err() {
                            return SessionEnd::Dropped;
                        }
                    }
                }
                Some(Command::Compact { up_to, snapshot, live_blobs }) => {
                    let compress = may_compress(&keys.project_id);
                    let Ok(sealed) = keys.seal_packed(Kind::Snapshot, &snapshot, compress) else {
                        continue;
                    };
                    let mut frame = vec![FRAME_SNAPSHOT];
                    frame.extend_from_slice(&up_to.to_be_bytes());
                    frame.extend_from_slice(&sealed);
                    let gc = json!({ "type": "gc", "liveBlobs": live_blobs }).to_string();
                    if sink.send(Message::Binary(Bytes::from(frame))).await.is_err()
                        || sink.send(Message::text(gc)).await.is_err()
                    {
                        return SessionEnd::Dropped;
                    }
                }
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Binary(data))) => handle_frame(&data, keys, after, chat, emit),
                Some(Ok(Message::Text(text))) => {
                    let Ok(message) = serde_json::from_str::<RelayMessage>(&text) else {
                        continue;
                    };
                    match message.kind.as_str() {
                        "caught-up" => {
                            **after = (**after).max(message.seq);
                            set_may_compress(&keys.project_id, message.min_protocol >= 2);
                            emit(SyncEvent::Status { state: "online" });
                            emit(SyncEvent::CaughtUp {
                                seq: **after,
                                log_entries: message.log_entries,
                                log_bytes: message.log_bytes,
                                pending: outbox.entries.len(),
                                chat_days: message.chat_days,
                            });
                        }
                        "chat-ack" => {
                            if let Some(data) = chat_pending.pop_front() {
                                let entry = ChatEntry { seq: message.seq, at: message.at, data };
                                if chat.add(&entry) {
                                    emit(SyncEvent::Chat {
                                        seq: entry.seq,
                                        at: entry.at,
                                        data: BASE64.encode(&entry.data),
                                    });
                                }
                            }
                        }
                        "chat-error" => {
                            chat_pending.pop_front();
                            emit(SyncEvent::Error { code: format!("chat-{}", message.code) });
                        }
                        "ack" => {
                            outbox.confirm();
                            // Updates reach this socket in seq order, so
                            // everything before an ack has been delivered.
                            **after = (**after).max(message.seq);
                            emit(SyncEvent::Ack { seq: **after, pending: outbox.entries.len() });
                        }
                        "error" => {
                            // The relay refused the oldest change for good;
                            // retrying it would only be refused again. It
                            // stays in everyone's document, and reaches the
                            // relay with the next snapshot.
                            outbox.confirm();
                            emit(SyncEvent::Error { code: message.code });
                        }
                        "snapshot-ack" => emit(SyncEvent::SnapshotAck {
                            up_to: message.up_to,
                            ok: message.ok,
                        }),
                        _ => {}
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return SessionEnd::Dropped,
                Some(Ok(_)) => {}
            },
            _ = keepalive.tick() => {
                if sink.send(Message::Ping(Bytes::new())).await.is_err() {
                    return SessionEnd::Dropped;
                }
            }
        }
    }
}

fn handle_frame(
    data: &[u8],
    keys: &Keys,
    after: &mut u64,
    chat: &mut ChatLog,
    emit: &impl Fn(SyncEvent),
) {
    let corrupt = || {
        emit(SyncEvent::Error {
            code: "corrupt".into(),
        })
    };
    let Some(&frame) = data.first() else { return };
    let seq_of = |data: &[u8]| {
        data.get(1..9)
            .and_then(|b| b.try_into().ok())
            .map(u64::from_be_bytes)
    };
    match frame {
        FRAME_UPDATE => {
            let Some(seq) = seq_of(data) else { return };
            *after = (*after).max(seq);
            match keys.open(Kind::Update, &data[9..]) {
                Ok(plain) => emit(SyncEvent::Update {
                    seq,
                    data: BASE64.encode(plain),
                }),
                Err(_) => corrupt(),
            }
        }
        FRAME_SNAPSHOT => {
            let Some(up_to) = seq_of(data) else { return };
            *after = (*after).max(up_to);
            match keys.open(Kind::Snapshot, &data[9..]) {
                Ok(plain) => emit(SyncEvent::Snapshot {
                    up_to,
                    data: BASE64.encode(plain),
                }),
                Err(_) => corrupt(),
            }
        }
        FRAME_CHAT => {
            let (Some(seq), Some(at)) = (seq_of(data), data.get(9..17)) else {
                return;
            };
            let at = u64::from_be_bytes(at.try_into().unwrap_or_default());
            let Some(sealed) = data.get(17..) else { return };
            // Someone's message this device can't read is skipped, not fatal.
            let Ok(plain) = keys.open(Kind::Chat, sealed) else {
                return;
            };
            let entry = ChatEntry { seq, at, data: plain };
            if chat.add(&entry) {
                emit(SyncEvent::Chat {
                    seq,
                    at,
                    data: BASE64.encode(&entry.data),
                });
            }
        }
        FRAME_AWARENESS => {
            if let Ok(plain) = keys.open(Kind::Awareness, &data[1..]) {
                emit(SyncEvent::Awareness {
                    data: BASE64.encode(plain),
                });
            }
        }
        _ => {}
    }
}

// ─── Relay HTTP: creating projects and files ───

fn http_error(status: u16) -> String {
    match status {
        401 | 404 => "This shared project no longer exists.".into(),
        413 => "too-large".into(),
        429 => "Too many new shared projects today. Try again tomorrow.".into(),
        507 => "quota".into(),
        _ => format!("The relay answered {status}."),
    }
}

async fn create_on_relay(link: &Link) -> Result<(), String> {
    let keys = Keys::derive(link);
    let body = json!({ "accessHash": keys.access_hash() }).to_string();
    let response = reqwest::Client::new()
        .post(link.url(""))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the relay: {e}"))?;
    match response.status().as_u16() {
        201 => Ok(()),
        507 => Err("The relay is full right now. Try again later.".into()),
        status => Err(http_error(status)),
    }
}

/// Uploads a file; returns its id and size.
async fn upload_blob(link: &Link, file: &Path) -> Result<(String, u64), String> {
    let data = tokio::fs::read(file).await.map_err(|e| e.to_string())?;
    if data.len() > MAX_FILE_BYTES {
        return Err("too-large".into());
    }
    let keys = Keys::derive(link);
    let id = keys.blob_id(&data);
    let body = keys.seal_packed(Kind::Blob, &data, may_compress(&keys.project_id))?;
    let response = reqwest::Client::new()
        .put(link.url(&format!("/blobs/{id}")))
        .bearer_auth(&keys.access_token)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the relay: {e}"))?;
    match response.status().as_u16() {
        200 | 201 => Ok((id, data.len() as u64)),
        status => Err(http_error(status)),
    }
}

async fn download_blob(link: &Link, blob_id: &str, dest: &Path) -> Result<(), String> {
    if !is_hex(blob_id, 64) {
        return Err("Invalid file id".into());
    }
    let keys = Keys::derive(link);
    let response = reqwest::Client::new()
        .get(link.url(&format!("/blobs/{blob_id}")))
        .bearer_auth(&keys.access_token)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the relay: {e}"))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(http_error(status));
    }
    let sealed = response.bytes().await.map_err(|e| e.to_string())?;
    let data = keys.open(Kind::Blob, &sealed)?;
    if keys.blob_id(&data) != blob_id {
        return Err("A downloaded file didn't match what was shared.".into());
    }
    write_atomic(dest, &data)
}

// ─── Paths ───

/// A relative path from another device, turned into one that cannot leave
/// the project folder.
fn safe_relative_path(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains(['\\', ':', '\0']) {
        return None;
    }
    let candidate = PathBuf::from(path);
    candidate
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
        .then_some(candidate)
}

fn project_file(project_root: &str, relative_path: &str) -> Result<PathBuf, String> {
    safe_relative_path(relative_path)
        .map(|relative| Path::new(project_root).join(relative))
        .ok_or_else(|| "Invalid file path".to_string())
}

/// A folder name from another device, made safe and not already taken.
fn unique_destination(parent: &Path, name: &str) -> PathBuf {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.');
    let base = if cleaned.is_empty() {
        "Shared project"
    } else {
        cleaned
    };
    let mut candidate = parent.join(base);
    let mut n = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{base} ({n})"));
        n += 1;
    }
    candidate
}

// ─── Commands ───

/// One connection per window, since each window can have its own project open.
#[derive(Default)]
pub struct CollabState {
    connections: Mutex<HashMap<String, mpsc::UnboundedSender<Command>>>,
}

impl CollabState {
    fn send(&self, window: &WebviewWindow, command: Command) {
        if let Ok(connections) = self.connections.lock() {
            if let Some(tx) = connections.get(window.label()) {
                let _ = tx.send(command);
            }
        }
    }
}

fn decode(data: &str) -> Result<Vec<u8>, String> {
    BASE64.decode(data).map_err(|e| e.to_string())
}

/// Creates a new shared project on the relay and returns its link. Nothing
/// is written locally until the webview links a folder to it.
#[tauri::command]
pub async fn collab_create(relay_url: Option<String>) -> Result<String, String> {
    let link = Link::generate(relay_url.as_deref().unwrap_or(DEFAULT_RELAY))?;
    create_on_relay(&link).await?;
    Ok(link.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    link: String,
    project_id: String,
}

/// Checks a link someone pasted, and says which project it is.
#[tauri::command]
pub fn collab_parse_link(link: String) -> Result<LinkInfo, String> {
    let link = Link::parse(&link)?;
    Ok(LinkInfo {
        project_id: link.project_id.clone(),
        link: link.to_string(),
    })
}

/// The link of the shared project in this folder, if it is one.
#[tauri::command]
pub fn collab_read_link(project_root: String) -> Option<LinkInfo> {
    let path = state_dir(Path::new(&project_root)).join(LINK_FILE);
    let stored: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let link = Link::parse(stored.get("link")?.as_str()?).ok()?;
    Some(LinkInfo {
        project_id: link.project_id.clone(),
        link: link.to_string(),
    })
}

#[tauri::command]
pub fn collab_write_link(project_root: String, link: String) -> Result<(), String> {
    let link = Link::parse(&link)?;
    let dir = state_dir(Path::new(&project_root));
    let body = json!({ "link": link.to_string() }).to_string();
    write_atomic(&dir.join(LINK_FILE), body.as_bytes())
}

/// Stops treating this folder as a shared project. The files stay.
#[tauri::command]
pub fn collab_remove_link(project_root: String) -> Result<(), String> {
    let dir = state_dir(Path::new(&project_root));
    for name in [LINK_FILE, DOC_FILE, OUTBOX_FILE, CHAT_FILE] {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.to_string()),
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct SavedDoc {
    seq: u64,
    /// The webview's own JSON, stored alongside.
    local: String,
    data: String,
}

#[tauri::command]
pub fn collab_load_doc(project_root: String) -> Option<SavedDoc> {
    let buf = std::fs::read(state_dir(Path::new(&project_root)).join(DOC_FILE)).ok()?;
    let seq = u64::from_be_bytes(buf.get(0..8)?.try_into().ok()?);
    let local_len = u32::from_be_bytes(buf.get(8..12)?.try_into().ok()?) as usize;
    let local = String::from_utf8(buf.get(12..12 + local_len)?.to_vec()).ok()?;
    Some(SavedDoc {
        seq,
        local,
        data: BASE64.encode(&buf[12 + local_len..]),
    })
}

/// Saves the document, the last relay seq it includes, and the webview's
/// local state, in one write.
#[tauri::command]
pub fn collab_save_doc(
    project_root: String,
    seq: u64,
    local: String,
    data: String,
) -> Result<(), String> {
    let mut buf = seq.to_be_bytes().to_vec();
    buf.extend_from_slice(&(local.len() as u32).to_be_bytes());
    buf.extend_from_slice(local.as_bytes());
    buf.extend_from_slice(&decode(&data)?);
    write_atomic(&state_dir(Path::new(&project_root)).join(DOC_FILE), &buf)
}

/// Connects this window to a shared project, replacing any earlier
/// connection. `after` is the last seq the saved document includes; with no
/// `project_root` (while joining) local changes aren't kept across restarts.
#[tauri::command]
pub fn collab_connect(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    link: String,
    after: u64,
    project_root: Option<String>,
) -> Result<(), String> {
    let link = Link::parse(&link)?;
    let keys = Arc::new(Keys::derive(&link));
    let dir = project_root.map(|root| state_dir(Path::new(&root)));
    let outbox = Outbox::load(dir.as_ref().map(|dir| dir.join(OUTBOX_FILE)));
    let chat = ChatLog::load(dir.map(|dir| dir.join(CHAT_FILE)), now_ms());
    let (tx, rx) = mpsc::unbounded_channel();
    {
        let mut connections = state.connections.lock().map_err(|e| e.to_string())?;
        connections.insert(window.label().to_string(), tx);
    }
    let target = window.clone();
    tauri::async_runtime::spawn(run_connection(
        link,
        keys,
        after,
        outbox,
        chat,
        rx,
        move |event| {
            let _ = target.emit_to(
                EventTarget::webview_window(target.label()),
                "collab://event",
                event,
            );
        },
    ));
    Ok(())
}

#[tauri::command]
pub fn collab_disconnect(window: WebviewWindow, state: tauri::State<'_, CollabState>) {
    if let Ok(mut connections) = state.connections.lock() {
        connections.remove(window.label());
    }
}

#[tauri::command]
pub fn collab_publish(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    data: String,
) -> Result<(), String> {
    let update = decode(&data)?;
    if update.len() > MAX_UPDATE_BYTES {
        return Err("too-large".into());
    }
    state.send(&window, Command::Publish(update));
    Ok(())
}

/// Sends a chat message: the webview's JSON, image and all.
#[tauri::command]
pub fn collab_send_chat(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    data: String,
) -> Result<(), String> {
    let message = decode(&data)?;
    if message.len() > MAX_CHAT_BYTES {
        return Err("too-large".into());
    }
    state.send(&window, Command::Chat(message));
    Ok(())
}

#[derive(Serialize)]
pub struct ChatMessage {
    seq: u64,
    at: u64,
    data: String,
}

/// The chat this device has for a project, oldest first.
#[tauri::command]
pub fn collab_load_chat(project_root: String) -> Vec<ChatMessage> {
    let cutoff = chat_cutoff(now_ms());
    read_chat(&state_dir(Path::new(&project_root)).join(CHAT_FILE))
        .into_iter()
        .filter(|e| e.at >= cutoff)
        .map(|e| ChatMessage {
            seq: e.seq,
            at: e.at,
            data: BASE64.encode(e.data),
        })
        .collect()
}

#[tauri::command]
pub fn collab_awareness(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    data: String,
) -> Result<(), String> {
    state.send(&window, Command::Awareness(decode(&data)?));
    Ok(())
}

/// Replaces the relay's history up to `up_to` with the whole document, and
/// lets it delete files no longer used.
#[tauri::command]
pub fn collab_compact(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    up_to: u64,
    data: String,
    live_blobs: Vec<String>,
) -> Result<(), String> {
    let live_blobs = live_blobs.into_iter().filter(|b| is_hex(b, 64)).collect();
    state.send(
        &window,
        Command::Compact {
            up_to,
            snapshot: decode(&data)?,
            live_blobs,
        },
    );
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedBlob {
    blob_id: String,
    size: u64,
}

#[tauri::command]
pub async fn collab_upload_blob(
    link: String,
    project_root: String,
    relative_path: String,
) -> Result<UploadedBlob, String> {
    let link = Link::parse(&link)?;
    let file = project_file(&project_root, &relative_path)?;
    let (blob_id, size) = upload_blob(&link, &file).await?;
    Ok(UploadedBlob { blob_id, size })
}

#[tauri::command]
pub async fn collab_download_blob(
    link: String,
    project_root: String,
    relative_path: String,
    blob_id: String,
) -> Result<(), String> {
    let link = Link::parse(&link)?;
    let file = project_file(&project_root, &relative_path)?;
    download_blob(&link, &blob_id, &file).await
}

/// Creates the folder a joined project goes in, inside a folder the user chose.
#[tauri::command]
pub fn collab_create_folder(dest_parent: String, name: String) -> Result<String, String> {
    let parent = Path::new(&dest_parent);
    // A relative path would land wherever the app happens to be running from.
    if dest_parent.trim().is_empty() || !parent.is_absolute() {
        return Err("Choose a folder to save the shared project in.".into());
    }
    let path = unique_destination(parent, &name);
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// A starting point for the name others see; the user can change it.
#[tauri::command]
pub fn collab_default_name() -> String {
    ["USER", "USERNAME"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("collab-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn links_round_trip_and_reject_garbage() {
        let link = Link::generate("https://collab.example.com/").unwrap();
        let text = link.to_string();
        assert!(text.starts_with("https://collab.example.com/p/"));
        assert_eq!(Link::parse(&format!("  {text}\n")).unwrap(), link);
        assert_eq!(
            link.sync_url(),
            format!("wss://collab.example.com/p/{}/sync", link.project_id)
        );
        let local = Link::generate("http://127.0.0.1:8082").unwrap();
        assert!(local.sync_url().starts_with("ws://127.0.0.1:8082/p/"));

        let (url, key) = text.split_once('#').unwrap();
        assert!(Link::parse(url).is_err());
        assert!(Link::parse(&format!("{url}#{}", &key[1..])).is_err());
        assert!(Link::parse(&format!("https://collab.example.com/p/nothex#{key}")).is_err());
        assert!(Link::parse(&format!("https://user@evil/p/{}#{key}", link.project_id)).is_err());
    }

    #[test]
    fn encryption_round_trips_and_detects_tampering() {
        let link = Link::generate(DEFAULT_RELAY).unwrap();
        let keys = Keys::derive(&link);
        let sealed = keys.seal(Kind::Update, b"\\section{Intro}").unwrap();
        assert!(!sealed.windows(7).any(|w| w == b"section"));
        assert_eq!(
            keys.open(Kind::Update, &sealed).unwrap(),
            b"\\section{Intro}"
        );

        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(keys.open(Kind::Update, &tampered).is_err());
        // An update can't be replayed as a snapshot, or into another project.
        assert!(keys.open(Kind::Snapshot, &sealed).is_err());
        let other = Keys::derive(&Link {
            project_id: "0".repeat(32),
            ..link.clone()
        });
        assert!(other.open(Kind::Update, &sealed).is_err());
        // Same content, different ciphertext each time.
        assert_ne!(
            sealed,
            keys.seal(Kind::Update, b"\\section{Intro}").unwrap()
        );
    }

    #[test]
    fn compresses_before_encrypting_when_allowed() {
        let keys = Keys::derive(&Link::generate(DEFAULT_RELAY).unwrap());
        let text = "\\section{Intro} Some prose. ".repeat(200).into_bytes();
        let plain = keys.seal_packed(Kind::Update, &text, false).unwrap();
        let packed = keys.seal_packed(Kind::Update, &text, true).unwrap();
        assert!(packed.len() < plain.len() / 5);
        // Either way it opens, as what it is and nothing else.
        assert_eq!(keys.open(Kind::Update, &plain).unwrap(), text);
        assert_eq!(keys.open(Kind::Update, &packed).unwrap(), text);
        assert!(keys.open(Kind::Snapshot, &packed).is_err());

        // What doesn't shrink is sent as it is.
        let mut noise = vec![0u8; 4096];
        SystemRandom::new().fill(&mut noise).unwrap();
        let sealed = keys.seal_packed(Kind::Blob, &noise, true).unwrap();
        assert!(keys.open_as(Kind::Blob, &sealed, false).is_ok());

        // Something that would inflate to more than it may is refused.
        let bomb = deflate(&vec![0u8; MAX_INFLATED_BYTES as usize + 1]).unwrap();
        let sealed = keys.seal_as(Kind::Update, &bomb, true).unwrap();
        assert!(keys.open(Kind::Update, &sealed).is_err());
    }

    #[test]
    fn chat_log_keeps_new_messages_and_forgets_old_ones() {
        let dir = temp_dir("chat");
        let root = dir.to_string_lossy().into_owned();
        let path = state_dir(&dir).join(CHAT_FILE);
        let day = 24 * 60 * 60 * 1000;
        let now = now_ms();
        let mut log = ChatLog::load(Some(path.clone()), now);
        assert_eq!(log.after, 0);
        let old = ChatEntry { seq: 1, at: now - 40 * day, data: b"old".to_vec() };
        let new = ChatEntry { seq: 2, at: now - day, data: b"new".to_vec() };
        assert!(log.add(&old));
        assert!(log.add(&new));
        assert!(!log.add(&new), "already has it");
        assert_eq!(read_chat(&path), vec![old, new.clone()]);

        // Reopened: what the relay would have deleted is gone here too, and
        // it asks only for what's after the last one.
        let log = ChatLog::load(Some(path.clone()), now);
        assert_eq!(log.after, 2);
        assert_eq!(read_chat(&path), vec![new]);
        assert_eq!(collab_load_chat(root.clone()).len(), 1);
        collab_remove_link(root).unwrap();
        assert!(!path.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn derived_keys_are_independent() {
        let link = Link::generate(DEFAULT_RELAY).unwrap();
        let keys = Keys::derive(&link);
        assert!(is_hex(&keys.access_token, 64));
        assert!(!keys.access_token.contains(&hex(&link.key)));
        assert_eq!(
            keys.blob_id(b"figure"),
            Keys::derive(&link).blob_id(b"figure")
        );
        let another = Link::generate(DEFAULT_RELAY).unwrap();
        assert_ne!(
            keys.blob_id(b"figure"),
            Keys::derive(&another).blob_id(b"figure")
        );
    }

    #[test]
    fn outbox_survives_restarts_and_empties_when_confirmed() {
        let dir = temp_dir("outbox");
        let path = dir.join(".latex4all").join(OUTBOX_FILE);
        let mut outbox = Outbox::load(Some(path.clone()));
        outbox.push(vec![1, 2]);
        outbox.push(vec![3]);
        let reloaded = Outbox::load(Some(path.clone()));
        assert_eq!(reloaded.entries, VecDeque::from([vec![1, 2], vec![3]]));

        outbox.confirm();
        assert_eq!(outbox.entries.len(), 1);
        outbox.confirm();
        assert_eq!(std::fs::read(&path).unwrap().len(), 0);
        assert!(Outbox::load(Some(path)).entries.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn local_files_save_and_load() {
        let dir = temp_dir("files");
        let root = dir.to_string_lossy().into_owned();
        assert!(collab_load_doc(root.clone()).is_none());
        collab_save_doc(
            root.clone(),
            42,
            "{\"known\":{}}".into(),
            BASE64.encode([7u8, 8, 9]),
        )
        .unwrap();
        let saved = collab_load_doc(root.clone()).unwrap();
        assert_eq!(
            (saved.seq, saved.local.as_str(), saved.data),
            (42, "{\"known\":{}}", BASE64.encode([7u8, 8, 9]))
        );

        let link = Link::generate(DEFAULT_RELAY).unwrap().to_string();
        assert!(collab_read_link(root.clone()).is_none());
        collab_write_link(root.clone(), link.clone()).unwrap();
        assert_eq!(collab_read_link(root.clone()).unwrap().link, link);
        collab_remove_link(root.clone()).unwrap();
        assert!(collab_read_link(root.clone()).is_none());
        assert!(collab_load_doc(root).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn joined_projects_need_a_real_folder_to_go_in() {
        // A relative path would put it wherever the app was started from.
        assert!(collab_create_folder("".into(), "Thesis".into()).is_err());
        assert!(collab_create_folder("Documents/Latex4All".into(), "Thesis".into()).is_err());
        let dir = temp_dir("folder");
        let created =
            collab_create_folder(dir.to_string_lossy().into_owned(), "Thesis".into()).unwrap();
        assert_eq!(created, dir.join("Thesis").to_string_lossy());
        assert!(Path::new(&created).is_dir());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn paths_from_others_cannot_escape() {
        assert!(safe_relative_path("figures/plot.png").is_some());
        assert!(safe_relative_path("../outside.tex").is_none());
        assert!(safe_relative_path("a/../../b").is_none());
        assert!(safe_relative_path("/etc/passwd").is_none());
        assert!(safe_relative_path("C:\\Windows").is_none());
        assert!(safe_relative_path("").is_none());
        let dir = temp_dir("dest");
        std::fs::create_dir_all(dir.join("Thesis")).unwrap();
        assert_eq!(unique_destination(&dir, "Thesis"), dir.join("Thesis (2)"));
        assert_eq!(
            unique_destination(&dir, "../.."),
            dir.join("Shared project")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Starts a connection whose events land in a channel.
    fn start(
        link: &Link,
        after: u64,
        outbox: Outbox,
    ) -> (
        mpsc::UnboundedSender<Command>,
        mpsc::UnboundedReceiver<SyncEvent>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let (events_tx, events_rx) = mpsc::unbounded_channel();
        tokio::spawn(run_connection(
            link.clone(),
            Arc::new(Keys::derive(link)),
            after,
            outbox,
            ChatLog::load(None, now_ms()),
            rx,
            move |event| {
                let _ = events_tx.send(event);
            },
        ));
        (tx, events_rx)
    }

    async fn wait_for(
        events: &mut mpsc::UnboundedReceiver<SyncEvent>,
        mut matches: impl FnMut(&SyncEvent) -> bool,
    ) -> SyncEvent {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let event = events.recv().await.expect("connection ended");
                if matches(&event) {
                    return event;
                }
            }
        })
        .await
        .expect("timed out")
    }

    /// Against a real relay, e.g.
    /// `RELAY_URL=http://127.0.0.1:8082 cargo test -- --ignored`
    /// with `node apps/relay/relay.mjs` started first.
    #[tokio::test]
    #[ignore]
    async fn syncs_through_the_relay() {
        let relay = std::env::var("RELAY_URL").expect("RELAY_URL");
        let link = Link::parse(&collab_create(Some(relay.clone())).await.unwrap()).unwrap();

        // A shares while online.
        let dir_a = temp_dir("device-a");
        let outbox_a = Outbox::load(Some(dir_a.join(OUTBOX_FILE)));
        let (a, mut a_events) = start(&link, 0, outbox_a);
        wait_for(&mut a_events, |e| matches!(e, SyncEvent::CaughtUp { .. })).await;
        a.send(Command::Publish(b"first".to_vec())).unwrap();
        a.send(Command::Publish(b"second".to_vec())).unwrap();
        let ack = wait_for(&mut a_events, |e| {
            matches!(e, SyncEvent::Ack { pending: 0, .. })
        })
        .await;
        assert_eq!(ack, SyncEvent::Ack { seq: 2, pending: 0 });
        drop(a);

        // B made a change while offline: it's in B's outbox on disk, and
        // goes out as soon as B connects.
        let dir_b = temp_dir("device-b");
        let mut offline = Outbox::load(Some(dir_b.join(OUTBOX_FILE)));
        offline.push(b"written on a plane".to_vec());
        let (b, mut b_events) = start(&link, 0, Outbox::load(Some(dir_b.join(OUTBOX_FILE))));
        let mut received = Vec::new();
        wait_for(&mut b_events, |e| {
            if let SyncEvent::Update { data, .. } = e {
                received.push(BASE64.decode(data).unwrap());
            }
            matches!(e, SyncEvent::CaughtUp { .. })
        })
        .await;
        assert_eq!(received, vec![b"first".to_vec(), b"second".to_vec()]);
        wait_for(&mut b_events, |e| {
            matches!(e, SyncEvent::Ack { pending: 0, .. })
        })
        .await;
        assert_eq!(std::fs::read(dir_b.join(OUTBOX_FILE)).unwrap().len(), 0);

        // A reopens from where it left off and gets only B's change.
        let (a, mut a_events) = start(&link, 2, Outbox::load(None));
        let update = wait_for(&mut a_events, |e| matches!(e, SyncEvent::Update { .. })).await;
        assert_eq!(
            update,
            SyncEvent::Update {
                seq: 3,
                data: BASE64.encode(b"written on a plane")
            }
        );
        wait_for(&mut a_events, |e| matches!(e, SyncEvent::CaughtUp { .. })).await;

        // Live: cursors from B reach A decrypted.
        b.send(Command::Awareness(b"cursor".to_vec())).unwrap();
        let cursor = wait_for(&mut a_events, |e| matches!(e, SyncEvent::Awareness { .. })).await;
        assert_eq!(
            cursor,
            SyncEvent::Awareness {
                data: BASE64.encode(b"cursor")
            }
        );

        // Compaction: someone opening fresh gets one snapshot instead.
        a.send(Command::Compact {
            up_to: 3,
            snapshot: b"everything".to_vec(),
            live_blobs: vec![],
        })
        .unwrap();
        let compacted = wait_for(&mut a_events, |e| {
            matches!(e, SyncEvent::SnapshotAck { .. })
        })
        .await;
        assert_eq!(compacted, SyncEvent::SnapshotAck { up_to: 3, ok: true });
        let (_c, mut c_events) = start(&link, 0, Outbox::load(None));
        let snapshot = wait_for(&mut c_events, |e| matches!(e, SyncEvent::Snapshot { .. })).await;
        assert_eq!(
            snapshot,
            SyncEvent::Snapshot {
                up_to: 3,
                data: BASE64.encode(b"everything")
            }
        );

        // Files: encrypted up, verified down, stored once.
        let figure: Vec<u8> = (0..300_000).map(|i| (i % 251) as u8).collect();
        std::fs::write(dir_a.join("figure.png"), &figure).unwrap();
        let (id, size) = upload_blob(&link, &dir_a.join("figure.png")).await.unwrap();
        assert_eq!(size, figure.len() as u64);
        assert_eq!(
            upload_blob(&link, &dir_a.join("figure.png"))
                .await
                .unwrap()
                .0,
            id
        );
        download_blob(&link, &id, &dir_b.join("figures/figure.png"))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(dir_b.join("figures/figure.png")).unwrap(),
            figure
        );

        // Chat: confirmed to the sender, passed on to whoever's online.
        a.send(Command::Chat(b"{\"text\":\"hi\"}".to_vec())).unwrap();
        let mine = wait_for(&mut a_events, |e| matches!(e, SyncEvent::Chat { .. })).await;
        let theirs = wait_for(&mut b_events, |e| matches!(e, SyncEvent::Chat { .. })).await;
        assert_eq!(mine, theirs);
        let SyncEvent::Chat { seq, data, .. } = mine else { unreachable!() };
        assert_eq!(BASE64.decode(data).unwrap(), b"{\"text\":\"hi\"}");
        // Someone opening later gets it too.
        let (_d, mut d_events) = start(&link, 0, Outbox::load(None));
        let later = wait_for(&mut d_events, |e| matches!(e, SyncEvent::Chat { .. })).await;
        assert!(matches!(later, SyncEvent::Chat { seq: s, .. } if s == seq));

        // The wrong key is turned away.
        let wrong = Link {
            key: [7; 32],
            ..link.clone()
        };
        let (_w, mut w_events) = start(&wrong, 0, Outbox::load(None));
        let refused = wait_for(&mut w_events, |e| matches!(e, SyncEvent::Error { .. })).await;
        assert_eq!(
            refused,
            SyncEvent::Error {
                code: "gone".into()
            }
        );
        assert!(download_blob(&wrong, &id, &dir_b.join("x.png"))
            .await
            .is_err());

        drop(b);
        std::fs::remove_dir_all(dir_a).unwrap();
        std::fs::remove_dir_all(dir_b).unwrap();
    }
}
