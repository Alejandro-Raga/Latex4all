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
//!
//! Guests reach the host in one of two ways. On the same network they connect
//! straight to a port the host opens. Over the internet the host keeps a
//! connection open to a public relay (apps/relay in this repo), and the relay
//! hands each guest's connection over to it; the host checks the invite token
//! either way, so the relay never decides who gets in.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
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
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

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
/// Files are sent in pieces this size; the relay refuses larger messages.
const SNAPSHOT_CHUNK: usize = 1024 * 1024;
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
    if let Some(route) = route {
        serve_route(ws, route, &relay, &project_root, shutdown).await;
    }
}

async fn serve_route<S>(
    ws: WebSocketStream<S>,
    route: Route,
    relay: &Relay,
    project_root: &Path,
    shutdown: watch::Receiver<()>,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    match route {
        Route::Sync => pump(ws, relay, shutdown).await,
        Route::Snapshot => {
            let _ = send_snapshot(ws, project_root).await;
        }
    }
}

// ─── Host, through the internet relay ───

type ClientStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// A relay address as typed (`https://collab.example.com`) turned into the
/// WebSocket base the app connects to (`wss://collab.example.com`).
fn relay_base(url: &str) -> Result<String, String> {
    let url = url.trim();
    let (scheme, rest) = if let Some(rest) = url.strip_prefix("https://") {
        ("wss", rest)
    } else if let Some(rest) = url.strip_prefix("http://") {
        ("ws", rest)
    } else if let Some(rest) = url.strip_prefix("wss://") {
        ("wss", rest)
    } else if let Some(rest) = url.strip_prefix("ws://") {
        ("ws", rest)
    } else {
        ("wss", url)
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

fn is_hex_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// Turns a refused connection into something a person can act on.
fn connection_error(err: WsError, what: &str) -> String {
    match &err {
        WsError::Http(response) => match response.status().as_u16() {
            404 => "That session isn't running any more.".into(),
            429 | 503 => "The relay is busy right now. Try again in a few minutes.".into(),
            _ => format!("Couldn't reach {what}: {err}"),
        },
        _ => format!("Couldn't reach {what}: {err}"),
    }
}

#[derive(Deserialize)]
struct RelayRequest {
    #[serde(rename = "type")]
    kind: String,
    id: String,
    path: String,
}

/// Opens this host's room on the relay. Returns the control connection the
/// relay announces guests on.
async fn open_relay_room(base: &str, room: &str, secret: &str) -> Result<ClientStream, String> {
    let url = format!("{base}/host?room={room}&secret={secret}");
    tokio_tungstenite::connect_async_with_config(url, None, true)
        .await
        .map(|(ws, _)| ws)
        .map_err(|e| connection_error(e, "the relay"))
}

/// Picks up guests the relay announces until the session stops. Returns true
/// if the relay went away rather than the session being stopped here.
async fn serve_via_relay(
    control: ClientStream,
    accept_base: String,
    secret: Arc<str>,
    token: Arc<str>,
    relay: Arc<Relay>,
    project_root: Arc<Path>,
    mut shutdown: watch::Receiver<()>,
) -> bool {
    let (mut sink, mut stream) = control.split();
    let mut keepalive = tokio::time::interval(KEEPALIVE);
    keepalive.tick().await;
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                let _ = sink.send(Message::Close(None)).await;
                return false;
            }
            _ = keepalive.tick() => {
                if sink.send(Message::Ping(Bytes::new())).await.is_err() {
                    return true;
                }
            }
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let Ok(request) = serde_json::from_str::<RelayRequest>(&text) else {
                        continue;
                    };
                    if request.kind != "connect" || !is_hex_id(&request.id) {
                        continue;
                    }
                    match authorize(&request.path, &token) {
                        Some(route) => {
                            let url = format!("{accept_base}/{}?secret={secret}", request.id);
                            let relay = relay.clone();
                            let project_root = project_root.clone();
                            let shutdown = shutdown.clone();
                            tokio::spawn(async move {
                                if let Ok((ws, _)) =
                                    tokio_tungstenite::connect_async_with_config(url, None, true).await
                                {
                                    serve_route(ws, route, &relay, &project_root, shutdown).await;
                                }
                            });
                        }
                        None => {
                            let reject = json!({ "type": "reject", "id": request.id });
                            if sink.send(Message::text(reject.to_string())).await.is_err() {
                                return true;
                            }
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return true,
                Some(Ok(_)) => {}
            },
        }
    }
}

#[derive(Serialize, Deserialize)]
struct SnapshotHeader {
    name: String,
    files: usize,
}

/// Precedes each file, whose bytes then follow in one or more binary messages.
#[derive(Serialize, Deserialize)]
struct SnapshotFile {
    path: String,
    size: u64,
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
    for (path, absolute) in files {
        // A file that vanished since the listing is sent empty rather than
        // breaking the count the guest is expecting.
        let bytes = Bytes::from(tokio::fs::read(&absolute).await.unwrap_or_default());
        let entry = SnapshotFile {
            path,
            size: bytes.len() as u64,
        };
        let entry = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        ws.send(Message::text(entry))
            .await
            .map_err(|e| e.to_string())?;
        for start in (0..bytes.len()).step_by(SNAPSHOT_CHUNK) {
            let chunk = bytes.slice(start..(start + SNAPSHOT_CHUNK).min(bytes.len()));
            ws.send(Message::Binary(chunk))
                .await
                .map_err(|e| e.to_string())?;
        }
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

/// An invite as shown to whoever shares — `wss://relay/r/<room>/<token>` over
/// the internet, `host:port/token` on the same network. Returns the WebSocket
/// base the guest's endpoints hang off, and the token.
fn parse_invite(invite: &str) -> Result<(String, String), String> {
    let invalid = || "That invite code isn't valid.".to_string();
    let invite = invite.trim();
    let invite = invite.strip_prefix("latex4all://").unwrap_or(invite);
    let (base, token) = invite.rsplit_once('/').ok_or_else(invalid)?;
    if token.len() < 16 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid());
    }
    if base.contains("://") {
        return Ok((relay_base(base).map_err(|_| invalid())?, token.to_string()));
    }
    let authority_ok = !base.is_empty()
        && base.contains(':')
        && !base
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '/' | '?' | '#' | '@'));
    if authority_ok {
        Ok((format!("ws://{base}"), token.to_string()))
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

async fn receive_snapshot(base: &str, token: &str, dest_parent: &Path) -> Result<PathBuf, String> {
    let url = format!("{base}/snapshot?token={token}");
    let config = WebSocketConfig::default()
        .max_message_size(Some(SNAPSHOT_CHUNK * 2))
        .max_frame_size(Some(SNAPSHOT_CHUNK * 2));
    let (mut ws, _) = tokio_tungstenite::connect_async_with_config(url, Some(config), true)
        .await
        .map_err(|e| connection_error(e, "the shared project"))?;

    let header: SnapshotHeader = match ws.next().await {
        Some(Ok(Message::Text(text))) => serde_json::from_str(&text).map_err(|e| e.to_string())?,
        _ => return Err("The shared project didn't send its files.".into()),
    };
    let dest = unique_destination(dest_parent, &header.name);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let result = async {
        let interrupted = || "The download was interrupted.".to_string();
        let mut total = 0u64;
        for _ in 0..header.files {
            let entry: SnapshotFile = match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    serde_json::from_str(&text).map_err(|_| interrupted())?
                }
                _ => return Err(interrupted()),
            };
            total += entry.size;
            if entry.size > SNAPSHOT_FILE_LIMIT || total > SNAPSHOT_TOTAL_LIMIT {
                return Err("The shared project is too large.".to_string());
            }
            let mut bytes = Vec::with_capacity(entry.size as usize);
            while (bytes.len() as u64) < entry.size {
                match ws.next().await {
                    Some(Ok(Message::Binary(chunk))) => bytes.extend_from_slice(&chunk),
                    _ => return Err(interrupted()),
                }
            }
            if bytes.len() as u64 != entry.size {
                return Err(interrupted());
            }
            let Some(relative) = safe_relative_path(&entry.path) else {
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

/// Starts sharing `project_root` — through the relay at `relay_url` if one is
/// given, otherwise on a port others on the same network can reach.
#[tauri::command]
pub async fn collab_host(
    window: WebviewWindow,
    state: tauri::State<'_, CollabState>,
    project_root: String,
    relay_url: Option<String>,
) -> Result<HostInfo, String> {
    state.replace(None);
    let token = uuid::Uuid::new_v4().simple().to_string();
    let project_root: Arc<Path> = Arc::from(PathBuf::from(project_root));
    let relay = Relay::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(());

    let invite = match relay_url.filter(|url| !url.trim().is_empty()) {
        Some(url) => {
            let base = relay_base(&url)?;
            let room = uuid::Uuid::new_v4().simple().to_string();
            let secret = uuid::Uuid::new_v4().simple().to_string();
            let control = open_relay_room(&base, &room, &secret).await?;
            let serving = serve_via_relay(
                control,
                format!("{base}/accept/{room}"),
                Arc::from(secret.as_str()),
                Arc::from(token.as_str()),
                relay.clone(),
                project_root,
                shutdown_rx.clone(),
            );
            let window = window.clone();
            let ended = shutdown_rx.clone();
            tokio::spawn(async move {
                // Tell the webview if the relay dropped us, not if we stopped.
                if serving.await && ended.has_changed().is_ok() {
                    let target = EventTarget::webview_window(window.label());
                    let _ = window.emit_to(target, "collab://closed", ());
                }
            });
            format!("{base}/r/{room}/{token}")
        }
        None => {
            let listener = match TcpListener::bind(("0.0.0.0", PREFERRED_PORT)).await {
                Ok(listener) => listener,
                Err(_) => TcpListener::bind(("0.0.0.0", 0))
                    .await
                    .map_err(|e| format!("Couldn't start sharing: {e}"))?,
            };
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            tokio::spawn(serve(
                listener,
                relay.clone(),
                Arc::from(token.as_str()),
                project_root,
                shutdown_rx.clone(),
            ));
            let host = local_address().map_or_else(|| "127.0.0.1".to_string(), |ip| ip.to_string());
            format!("{host}:{port}/{token}")
        }
    };

    spawn_local_bridge(&relay, shutdown_rx, webview_delivery(&window));
    state.replace(Some(Session {
        relay,
        _shutdown: shutdown_tx,
    }));
    Ok(HostInfo { invite })
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
    let (base, token) = parse_invite(&invite)?;
    let project_path = receive_snapshot(&base, &token, Path::new(&dest_parent)).await?;

    let url = format!("{base}/sync?token={token}");
    let (ws, _) = tokio_tungstenite::connect_async_with_config(url, None, true)
        .await
        .map_err(|e| connection_error(e, "the shared project"))?;

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
            ("ws://192.168.1.20:47100".to_string(), token.to_string())
        );
        let room = "fedcba9876543210fedcba9876543210";
        assert_eq!(
            parse_invite(&format!("wss://collab.example.com/r/{room}/{token}")).unwrap(),
            (
                format!("wss://collab.example.com/r/{room}"),
                token.to_string()
            )
        );
        assert!(parse_invite(&format!("wss://user@evil/r/{room}/{token}")).is_err());
        assert!(parse_invite(&format!("latex4all://host.local:1/{token}")).is_ok());
        assert!(parse_invite("192.168.1.20:47100").is_err());
        assert!(parse_invite(&format!("user@evil:1/{token}")).is_err());
        assert!(parse_invite("192.168.1.20:47100/not-hex-token-at-all").is_err());
    }

    #[test]
    fn relay_addresses_become_websocket_urls() {
        assert_eq!(
            relay_base("https://collab.example.com/").unwrap(),
            "wss://collab.example.com"
        );
        assert_eq!(
            relay_base("collab.example.com").unwrap(),
            "wss://collab.example.com"
        );
        assert_eq!(
            relay_base("http://127.0.0.1:8082").unwrap(),
            "ws://127.0.0.1:8082"
        );
        assert!(relay_base("https://").is_err());
        assert!(relay_base("https://a b").is_err());
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
        // Bigger than one chunk, so it has to be reassembled.
        let big: Vec<u8> = (0..(SNAPSHOT_CHUNK * 2 + 17))
            .map(|i| (i % 251) as u8)
            .collect();
        std::fs::write(root.join("figures/big.pdf"), &big).unwrap();

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
        let project = receive_snapshot(&format!("ws://{authority}"), token, &dest)
            .await
            .unwrap();
        assert_eq!(std::fs::read(project.join("figures/big.pdf")).unwrap(), big);
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

    /// Hosting through a real relay. Needs one running, e.g.
    /// `RELAY_URL=http://127.0.0.1:8082 cargo test -- --ignored`
    /// with `node apps/relay/relay.mjs` started first.
    #[tokio::test]
    #[ignore]
    async fn hosts_through_the_relay() {
        let base = relay_base(&std::env::var("RELAY_URL").expect("RELAY_URL")).unwrap();
        let token = uuid::Uuid::new_v4().simple().to_string();
        let room = uuid::Uuid::new_v4().simple().to_string();
        let secret = uuid::Uuid::new_v4().simple().to_string();
        let root = std::env::temp_dir().join(format!("collab-relay-host-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.tex"), "\\begin{document}").unwrap();
        let big: Vec<u8> = (0..(SNAPSHOT_CHUNK * 3 + 5))
            .map(|i| (i % 253) as u8)
            .collect();
        std::fs::write(root.join("figure.png"), &big).unwrap();

        let relay = Relay::new();
        let (shutdown_tx, shutdown_rx) = watch::channel(());
        let control = open_relay_room(&base, &room, &secret).await.unwrap();
        let serving = tokio::spawn(serve_via_relay(
            control,
            format!("{base}/accept/{room}"),
            Arc::from(secret.as_str()),
            Arc::from(token.as_str()),
            relay.clone(),
            Arc::from(root.clone()),
            shutdown_rx,
        ));

        let (guest_base, guest_token) = parse_invite(&format!("{base}/r/{room}/{token}")).unwrap();
        let dest =
            std::env::temp_dir().join(format!("collab-relay-guest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dest).unwrap();
        let project = receive_snapshot(&guest_base, &guest_token, &dest)
            .await
            .unwrap();
        assert_eq!(std::fs::read(project.join("figure.png")).unwrap(), big);

        // A wrong token is turned away by the host, through the relay.
        let wrong = format!("{guest_base}/sync?token={}", uuid::Uuid::new_v4().simple());
        let (mut intruder, _) = tokio_tungstenite::connect_async(wrong).await.unwrap();
        let refused = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match intruder.next().await {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                    _ => {}
                }
            }
        })
        .await;
        assert!(refused.is_ok());

        let sync = format!("{guest_base}/sync?token={guest_token}");
        let (mut a, _) = tokio_tungstenite::connect_async(sync.clone())
            .await
            .unwrap();
        let (mut b, _) = tokio_tungstenite::connect_async(sync).await.unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        a.send(Message::binary(vec![4u8, 5, 6])).await.unwrap();
        assert_eq!(next_binary(&mut b).await.as_ref(), [4, 5, 6]);
        relay.publish(LOCAL_PEER, Bytes::from_static(&[7]));
        assert_eq!(next_binary(&mut a).await.as_ref(), [7]);

        drop(shutdown_tx);
        assert!(!serving.await.unwrap());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(dest).unwrap();
    }
}
