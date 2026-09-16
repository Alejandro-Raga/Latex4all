//! Live collaboration: a relay for Yjs messages between copies of the app.
//!
//! Whoever shares a project runs the relay. Other copies connect to it over a
//! WebSocket, and every binary message one participant sends is passed on to
//! all the others. The relay never looks inside the messages — the Yjs sync
//! and awareness protocols in the webview are built to work over a plain
//! broadcast like this. The webview is one more participant, reached through
//! `collab_send` and the `collab://message` event rather than a socket, so it
//! needs no network access of its own (nor a CSP exception).
//!
//! Before joining, a guest downloads the project folder once from
//! `/snapshot`, so it has the images, styles and everything else it needs to
//! compile on its own. Only the text files are kept in sync after that.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, UdpSocket};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, EventTarget, WebviewWindow};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tokio_tungstenite::WebSocketStream;

/// Tried first so the address people share stays the same between sessions
/// (and a port forward keeps working); any free port is used if it's taken.
const PREFERRED_PORT: u16 = 47_100;
/// Messages the webview sends are tagged with this id; sockets get 1, 2, ….
const LOCAL_PEER: u64 = 0;
/// A participant this many messages behind is dropped: a gap in the Yjs
/// update stream would leave its copy silently different from everyone's.
const RELAY_BACKLOG: usize = 4096;
const KEEPALIVE: Duration = Duration::from_secs(20);
const SNAPSHOT_FILE_LIMIT: u64 = 100 * 1024 * 1024;
const SNAPSHOT_TOTAL_LIMIT: u64 = 500 * 1024 * 1024;
/// Mirrors `IGNORED_DIRECTORY_NAMES` in src/lib/tauri/fs.ts.
const SKIPPED_DIRECTORIES: &[&str] = &["node_modules", "__pycache__", "venv", "env"];

// ─── Relay ───

#[derive(Clone)]
struct Packet {
    from: u64,
    data: Bytes,
}

struct Relay {
    tx: broadcast::Sender<Packet>,
    next_peer: AtomicU64,
}

impl Relay {
    fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(RELAY_BACKLOG);
        Arc::new(Self {
            tx,
            next_peer: AtomicU64::new(LOCAL_PEER + 1),
        })
    }

    fn publish(&self, from: u64, data: Bytes) {
        // Err only means nobody else is listening yet, which is fine.
        let _ = self.tx.send(Packet { from, data });
    }
}

/// What the webview side of the relay should do with a packet.
enum LocalEvent {
    Message(Bytes),
    /// Messages were dropped before reaching the webview; it has to ask its
    /// peers for their full state again.
    Resync,
}

/// Forwards everything other participants send to the webview. Runs until
/// the session's shutdown sender is dropped.
fn spawn_local_bridge(
    relay: &Arc<Relay>,
    mut shutdown: watch::Receiver<()>,
    deliver: impl Fn(LocalEvent) + Send + 'static,
) {
    let mut rx = relay.tx.subscribe();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown.changed() => break,
                packet = rx.recv() => match packet {
                    Ok(packet) if packet.from != LOCAL_PEER => deliver(LocalEvent::Message(packet.data)),
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(_)) => deliver(LocalEvent::Resync),
                    Err(broadcast::error::RecvError::Closed) => break,
                },
            }
        }
    });
}

/// Connects one WebSocket to the relay until either side goes away.
async fn pump<S>(ws: WebSocketStream<S>, relay: &Relay, mut shutdown: watch::Receiver<()>)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let peer = relay.next_peer.fetch_add(1, Ordering::Relaxed);
    let mut rx = relay.tx.subscribe();
    let (mut sink, mut stream) = ws.split();
    let mut keepalive = tokio::time::interval(KEEPALIVE);
    keepalive.tick().await;
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                // Whatever the webview sent just before stopping — its
                // goodbye, so others stop showing its cursor — still goes out.
                while let Ok(packet) = rx.try_recv() {
                    if packet.from != peer && sink.send(Message::Binary(packet.data)).await.is_err() {
                        break;
                    }
                }
                break;
            }
            _ = keepalive.tick() => {
                if sink.send(Message::Ping(Bytes::new())).await.is_err() {
                    break;
                }
            }
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Binary(data))) => relay.publish(peer, data),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            packet = rx.recv() => match packet {
                Ok(packet) if packet.from != peer => {
                    if sink.send(Message::Binary(packet.data)).await.is_err() {
                        break;
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            },
        }
    }
    let _ = sink.send(Message::Close(None)).await;
}

// ─── Host ───

#[derive(Debug, PartialEq)]
enum Route {
    Sync,
    Snapshot,
}

/// Which endpoint a request is for, or None if its token is wrong.
fn authorize(path_and_query: &str, token: &str) -> Option<Route> {
    let (path, query) = path_and_query
        .split_once('?')
        .unwrap_or((path_and_query, ""));
    let route = match path {
        "/sync" => Route::Sync,
        "/snapshot" => Route::Snapshot,
        _ => return None,
    };
    let given = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token="))?;
    constant_time_eq(given.as_bytes(), token.as_bytes()).then_some(route)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn serve(
    listener: TcpListener,
    relay: Arc<Relay>,
    token: Arc<str>,
    project_root: Arc<Path>,
    mut shutdown: watch::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                tokio::spawn(handle_connection(
                    stream,
                    relay.clone(),
                    token.clone(),
                    project_root.clone(),
                    shutdown.clone(),
                ));
            }
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    relay: Arc<Relay>,
    token: Arc<str>,
    project_root: Arc<Path>,
    shutdown: watch::Receiver<()>,
) {
    let _ = stream.set_nodelay(true);
    let mut route = None;
    // The large error type is tungstenite's own handshake response.
    #[allow(clippy::result_large_err)]
    let callback = |request: &Request, response: Response| {
        let target = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("");
        match authorize(target, &token) {
            Some(r) => {
                route = Some(r);
                Ok(response)
            }
            None => {
                let mut refused = ErrorResponse::new(Some("Forbidden".into()));
                *refused.status_mut() = StatusCode::FORBIDDEN;
                Err(refused)
            }
        }
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(stream, callback).await else {
        return;
    };
    match route {
        Some(Route::Sync) => pump(ws, &relay, shutdown).await,
        Some(Route::Snapshot) => {
            let _ = send_snapshot(ws, &project_root).await;
        }
        None => {}
    }
}

#[derive(Serialize, Deserialize)]
struct SnapshotHeader {
    name: String,
    files: usize,
}

/// Every file a guest needs, as (path relative to the root with `/`
/// separators, absolute path). Follows the same skipping rules as the file
/// tree, and leaves out symlinks so nothing outside the folder is sent.
fn list_project_files(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    fn walk(
        dir: &Path,
        prefix: &str,
        total: &mut u64,
        out: &mut Vec<(String, PathBuf)>,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(meta) = entry.path().symlink_metadata() else {
                continue;
            };
            let relative = format!("{prefix}{name}");
            if meta.is_dir() {
                if SKIPPED_DIRECTORIES.contains(&name.to_lowercase().as_str()) {
                    continue;
                }
                walk(&entry.path(), &format!("{relative}/"), total, out)?;
            } else if meta.is_file() && meta.len() <= SNAPSHOT_FILE_LIMIT {
                *total += meta.len();
                if *total > SNAPSHOT_TOTAL_LIMIT {
                    return Err("This project is too large to share.".into());
                }
                out.push((relative, entry.path()));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, "", &mut 0, &mut out)?;
    Ok(out)
}

async fn send_snapshot<S>(mut ws: WebSocketStream<S>, root: &Path) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let owned_root = root.to_path_buf();
    let files = tokio::task::spawn_blocking(move || list_project_files(&owned_root))
        .await
        .map_err(|e| e.to_string())??;
    let header = SnapshotHeader {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        files: files.len(),
    };
    let header = serde_json::to_string(&header).map_err(|e| e.to_string())?;
    ws.send(Message::text(header))
        .await
        .map_err(|e| e.to_string())?;
    for (relative, absolute) in files {
        // A file that vanished since the listing is sent empty rather than
        // breaking the count the guest is expecting.
        let bytes = tokio::fs::read(&absolute).await.unwrap_or_default();
        ws.send(Message::text(relative))
            .await
            .map_err(|e| e.to_string())?;
        ws.send(Message::binary(bytes))
            .await
            .map_err(|e| e.to_string())?;
    }
    ws.close(None).await.map_err(|e| e.to_string())
}

/// The address other machines on the network would reach this one at. The
/// UDP "connect" only picks a route; nothing is sent.
fn local_address() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_unspecified()).then_some(ip)
}

// ─── Guest ───

/// `host:port/token`, as shown to whoever shares. Returns (host:port, token).
fn parse_invite(invite: &str) -> Result<(String, String), String> {
    let invalid = || "That invite code isn't valid.".to_string();
    let invite = invite.trim();
    let invite = invite.strip_prefix("latex4all://").unwrap_or(invite);
    let (authority, token) = invite.rsplit_once('/').ok_or_else(invalid)?;
    let authority_ok = !authority.is_empty()
        && authority.contains(':')
        && !authority
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '/' | '?' | '#' | '@'));
    let token_ok = token.len() >= 16 && token.chars().all(|c| c.is_ascii_hexdigit());
    if authority_ok && token_ok {
        Ok((authority.to_string(), token.to_string()))
    } else {
        Err(invalid())
    }
}

/// A relative path from the host, turned into one that cannot leave the
/// destination folder.
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

/// A folder name from the host, made safe and not already taken.
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

async fn receive_snapshot(
    authority: &str,
    token: &str,
    dest_parent: &Path,
) -> Result<PathBuf, String> {
    let url = format!("ws://{authority}/snapshot?token={token}");
    let config = WebSocketConfig::default()
        .max_message_size(Some(SNAPSHOT_FILE_LIMIT as usize + 1024))
        .max_frame_size(Some(SNAPSHOT_FILE_LIMIT as usize + 1024));
    let (mut ws, _) = tokio_tungstenite::connect_async_with_config(url, Some(config), true)
        .await
        .map_err(|e| format!("Couldn't reach the shared project: {e}"))?;

    let header: SnapshotHeader = match ws.next().await {
        Some(Ok(Message::Text(text))) => serde_json::from_str(&text).map_err(|e| e.to_string())?,
        _ => return Err("The shared project didn't send its files.".into()),
    };
    let dest = unique_destination(dest_parent, &header.name);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let result = async {
        for _ in 0..header.files {
            let relative = match ws.next().await {
                Some(Ok(Message::Text(text))) => text.to_string(),
                _ => return Err("The download was interrupted.".to_string()),
            };
            let bytes = match ws.next().await {
                Some(Ok(Message::Binary(bytes))) => bytes,
                _ => return Err("The download was interrupted.".to_string()),
            };
            let Some(relative) = safe_relative_path(&relative) else {
                continue;
            };
            let target = dest.join(relative);
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            tokio::fs::write(&target, &bytes)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    .await;

    if let Err(err) = result {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(err);
    }
    Ok(dest)
}

// ─── Commands ───

struct Session {
    relay: Arc<Relay>,
    /// Never sent on; dropping it is what tells every task to stop.
    _shutdown: watch::Sender<()>,
}

#[derive(Default)]
pub struct CollabState {
    session: Mutex<Option<Session>>,
}

impl CollabState {
    fn replace(&self, session: Option<Session>) {
        if let Ok(mut current) = self.session.lock() {
            *current = session;
        }
    }
}

fn webview_delivery(window: &WebviewWindow) -> impl Fn(LocalEvent) + Send + 'static {
    let window = window.clone();
    move |event| {
        let target = EventTarget::webview_window(window.label());
        let _ = match event {
            LocalEvent::Message(data) => {
                window.emit_to(target, "collab://message", BASE64.encode(&data))
            }
            LocalEvent::Resync => window.emit_to(target, "collab://resync", ()),
        };
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    invite: String,
}

#[tauri::command]
pub async fn collab_host(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    project_root: String,
) -> Result<HostInfo, String> {
    state.replace(None);
    let listener = match TcpListener::bind(("0.0.0.0", PREFERRED_PORT)).await {
        Ok(listener) => listener,
        Err(_) => TcpListener::bind(("0.0.0.0", 0))
            .await
            .map_err(|e| format!("Couldn't start sharing: {e}"))?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = uuid::Uuid::new_v4().simple().to_string();

    let relay = Relay::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(());
    spawn_local_bridge(&relay, shutdown_rx.clone(), webview_delivery(&window));
    tokio::spawn(serve(
        listener,
        relay.clone(),
        Arc::from(token.as_str()),
        Arc::from(PathBuf::from(project_root)),
        shutdown_rx,
    ));
    state.replace(Some(Session {
        relay,
        _shutdown: shutdown_tx,
    }));

    let host = local_address().map_or_else(|| "127.0.0.1".to_string(), |ip| ip.to_string());
    Ok(HostInfo {
        invite: format!("{host}:{port}/{token}"),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInfo {
    project_path: String,
}

#[tauri::command]
pub async fn collab_join(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    invite: String,
    dest_parent: String,
) -> Result<JoinInfo, String> {
    state.replace(None);
    let (authority, token) = parse_invite(&invite)?;
    let project_path = receive_snapshot(&authority, &token, Path::new(&dest_parent)).await?;

    let url = format!("ws://{authority}/sync?token={token}");
    let (ws, _) = tokio_tungstenite::connect_async_with_config(url, None, true)
        .await
        .map_err(|e| format!("Couldn't join the shared project: {e}"))?;

    let relay = Relay::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(());
    spawn_local_bridge(&relay, shutdown_rx.clone(), webview_delivery(&window));
    let pump_relay = relay.clone();
    let ended = shutdown_rx.clone();
    tokio::spawn(async move {
        pump(ws, &pump_relay, shutdown_rx).await;
        // Only tell the webview if the host went away, not if we left.
        if ended.has_changed().is_ok() {
            let target = EventTarget::webview_window(window.label());
            let _ = window.emit_to(target, "collab://closed", ());
        }
    });
    state.replace(Some(Session {
        relay,
        _shutdown: shutdown_tx,
    }));

    Ok(JoinInfo {
        project_path: project_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn collab_send(state: tauri::State<'_, CollabState>, data: String) -> Result<(), String> {
    let bytes = BASE64.decode(data).map_err(|e| e.to_string())?;
    let session = state.session.lock().map_err(|e| e.to_string())?;
    if let Some(session) = session.as_ref() {
        session.relay.publish(LOCAL_PEER, Bytes::from(bytes));
    }
    Ok(())
}

#[tauri::command]
pub fn collab_stop(state: tauri::State<'_, CollabState>) {
    state.replace(None);
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

    async fn next_binary<S: AsyncRead + AsyncWrite + Unpin>(ws: &mut WebSocketStream<S>) -> Bytes {
        let read = async {
            loop {
                if let Some(Ok(Message::Binary(data))) = ws.next().await {
                    return data;
                }
            }
        };
        tokio::time::timeout(Duration::from_secs(2), read)
            .await
            .unwrap()
    }

    #[test]
    fn authorize_checks_route_and_token() {
        let token = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            authorize(&format!("/sync?token={token}"), token),
            Some(Route::Sync)
        );
        assert_eq!(
            authorize(&format!("/snapshot?x=1&token={token}"), token),
            Some(Route::Snapshot)
        );
        assert_eq!(authorize("/sync?token=nope", token), None);
        assert_eq!(authorize("/sync", token), None);
        assert_eq!(authorize(&format!("/other?token={token}"), token), None);
    }

    #[test]
    fn invites_parse_and_reject_garbage() {
        let token = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            parse_invite(&format!("  192.168.1.20:47100/{token}\n")).unwrap(),
            ("192.168.1.20:47100".to_string(), token.to_string())
        );
        assert!(parse_invite(&format!("latex4all://host.local:1/{token}")).is_ok());
        assert!(parse_invite("192.168.1.20:47100").is_err());
        assert!(parse_invite(&format!("user@evil:1/{token}")).is_err());
        assert!(parse_invite("192.168.1.20:47100/not-hex-token-at-all").is_err());
    }

    #[test]
    fn relative_paths_cannot_escape() {
        assert!(safe_relative_path("figures/plot.png").is_some());
        assert!(safe_relative_path("../outside.tex").is_none());
        assert!(safe_relative_path("a/../../b").is_none());
        assert!(safe_relative_path("/etc/passwd").is_none());
        assert!(safe_relative_path("C:\\Windows").is_none());
        assert!(safe_relative_path("a\\..\\b").is_none());
        assert!(safe_relative_path("").is_none());
    }

    #[test]
    fn destinations_do_not_overwrite() {
        let dir = std::env::temp_dir().join(format!("collab-dest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("Thesis")).unwrap();
        assert_eq!(unique_destination(&dir, "Thesis"), dir.join("Thesis (2)"));
        assert_eq!(
            unique_destination(&dir, "../.."),
            dir.join("Shared project")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Two sockets and the local webview: whatever one sends, the others get.
    #[tokio::test]
    async fn relay_broadcasts_to_everyone_else() {
        let token = "0123456789abcdef0123456789abcdef";
        let root = std::env::temp_dir().join(format!("collab-relay-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("figures")).unwrap();
        std::fs::create_dir_all(root.join(".latex4all")).unwrap();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(root.join("figures/plot.png"), [0u8, 159, 146, 150]).unwrap();
        std::fs::write(root.join(".latex4all/history"), "private").unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let authority = listener.local_addr().unwrap().to_string();
        let relay = Relay::new();
        let (shutdown_tx, shutdown_rx) = watch::channel(());
        let (local_tx, mut local_rx) = tokio::sync::mpsc::unbounded_channel();
        spawn_local_bridge(&relay, shutdown_rx.clone(), move |event| {
            if let LocalEvent::Message(data) = event {
                let _ = local_tx.send(data);
            }
        });
        tokio::spawn(serve(
            listener,
            relay.clone(),
            Arc::from(token),
            Arc::from(root.clone()),
            shutdown_rx,
        ));

        // Wrong token is refused.
        let refused =
            tokio_tungstenite::connect_async(format!("ws://{authority}/sync?token=bad")).await;
        assert!(refused.is_err());

        // The snapshot has the files but not the hidden history folder.
        let dest = std::env::temp_dir().join(format!("collab-guest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dest).unwrap();
        let project = receive_snapshot(&authority, token, &dest).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(project.join("main.tex")).unwrap(),
            "\\documentclass{article}"
        );
        assert_eq!(
            std::fs::read(project.join("figures/plot.png")).unwrap(),
            [0u8, 159, 146, 150]
        );
        assert!(!project.join(".latex4all").exists());

        let url = format!("ws://{authority}/sync?token={token}");
        let (mut a, _) = tokio_tungstenite::connect_async(url.clone()).await.unwrap();
        let (mut b, _) = tokio_tungstenite::connect_async(url).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        a.send(Message::binary(vec![1u8, 2, 3])).await.unwrap();
        assert_eq!(next_binary(&mut b).await.as_ref(), [1, 2, 3]);
        assert_eq!(local_rx.recv().await.unwrap().as_ref(), [1, 2, 3]);

        relay.publish(LOCAL_PEER, Bytes::from_static(&[9]));
        assert_eq!(next_binary(&mut a).await.as_ref(), [9]);
        assert_eq!(next_binary(&mut b).await.as_ref(), [9]);

        // A sender never hears its own message back.
        assert!(tokio::time::timeout(Duration::from_millis(200), a.next())
            .await
            .is_err());

        // Stopping the session closes everyone's connection.
        drop(shutdown_tx);
        let closed = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match b.next().await {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                    _ => {}
                }
            }
        })
        .await;
        assert!(closed.is_ok());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(dest).unwrap();
    }
}
