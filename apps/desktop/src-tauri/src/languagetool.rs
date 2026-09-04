//! Installs and supervises a local LanguageTool server for the grammar checker.
//!
//! `grammar.rs` only knows how to talk to an HTTP endpoint; something has to
//! put a server behind it. On macOS that has historically been the user's job
//! (`brew install languagetool`), but Windows has no equivalent one-liner, so
//! the app manages the whole thing: it downloads LanguageTool, downloads a JRE
//! when the machine has no Java, starts the server on demand, and shuts it down
//! with the app.
//!
//! Everything lands under the per-user data directory — no admin rights, and
//! nothing to clean up outside it. The server binds loopback only and is never
//! contacted over the network; the app never talks to LanguageTool's cloud.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{Emitter, WebviewWindow};
use tokio::io::AsyncWriteExt;

/// Pinned so a silent upstream release can't change behaviour under the user.
/// Bump deliberately, together with `LANGUAGE_TOOL_VERSION`.
const LANGUAGE_TOOL_VERSION: &str = "6.6";
const LANGUAGE_TOOL_URL: &str = "https://languagetool.org/download/LanguageTool-6.6.zip";

/// Adoptium's "latest GA build of this major version" endpoint. LanguageTool
/// 6.6 needs Java 17 or newer; 21 is the current LTS.
const JRE_MAJOR_VERSION: &str = "21";

/// The server takes a while to load its rule sets on first start.
const SERVER_READY_TIMEOUT_SECS: u64 = 90;
const SERVER_POLL_INTERVAL_MS: u64 = 500;
/// LanguageTool's own default heap is generous; cap it so the editor keeps room.
const SERVER_MAX_HEAP: &str = "-Xmx1g";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The running server process, if this app started one. Registered as Tauri
/// managed state so the app can shut it down on exit.
pub type LanguageToolProcess = tokio::sync::Mutex<Option<tokio::process::Child>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageToolStatus {
    /// LanguageTool is unpacked and ready to run.
    installed: bool,
    /// Something is answering on `server_url` — possibly a server the user
    /// runs themselves rather than one we started.
    running: bool,
    /// True when the responding server is the one this app spawned.
    managed: bool,
    /// Path to the `java` that would be used, or `None` if none was found.
    java_path: Option<String>,
    /// Whether that `java` is the private JRE we downloaded.
    java_bundled: bool,
    install_dir: String,
    version: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// One of "java", "languagetool", "extract", "done".
    phase: &'static str,
    message: String,
    /// 0-100, or `None` for steps with no measurable total.
    percent: Option<u8>,
}

fn emit(
    window: &WebviewWindow,
    phase: &'static str,
    message: impl Into<String>,
    percent: Option<u8>,
) {
    let _ = window.emit(
        "languagetool-progress",
        Progress {
            phase,
            message: message.into(),
            percent,
        },
    );
}

// ── Paths ──

/// Per-user application data root, e.g. `%LOCALAPPDATA%\ClaudePrism` on Windows
/// and `~/Library/Application Support/ClaudePrism` on macOS.
fn app_data_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|dir| dir.join("ClaudePrism"))
        .ok_or_else(|| "Could not determine the local application data directory".to_string())
}

fn install_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("languagetool"))
}

fn jre_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("jre"))
}

/// The server jar, present only once installation has completed.
fn server_jar() -> Result<PathBuf, String> {
    Ok(install_dir()?.join("languagetool-server.jar"))
}

fn is_installed() -> bool {
    server_jar().map(|jar| jar.is_file()).unwrap_or(false)
}

/// `bin/java` inside an unpacked JRE.
fn jre_java(dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        dir.join("bin").join("java.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        dir.join("bin").join("java")
    }
}

/// Locate a usable Java: our private JRE first (so behaviour doesn't change
/// when the user installs or removes a system JDK), then `JAVA_HOME`, then PATH.
fn find_java() -> Option<(PathBuf, bool)> {
    if let Ok(dir) = jre_dir() {
        let java = jre_java(&dir);
        if java.is_file() {
            return Some((java, true));
        }
    }
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let java = jre_java(Path::new(&java_home));
        if java.is_file() {
            return Some((java, false));
        }
    }
    which::which("java").ok().map(|path| (path, false))
}

// ── Download & extract ──

/// Streams `url` to `dest`, emitting progress as a percentage of the
/// advertised content length.
async fn download(
    window: &WebviewWindow,
    url: &str,
    dest: &Path,
    phase: &'static str,
    label: &str,
) -> Result<(), String> {
    emit(window, phase, format!("Downloading {label}…"), Some(0));

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {label}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {label}: server returned HTTP {}",
            response.status()
        ));
    }

    let total = response.content_length();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Failed to create {}: {e}", dest.display()))?;

    let mut downloaded: u64 = 0;
    let mut last_percent = 0u8;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Download of {label} was interrupted: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed writing {label} to disk: {e}"))?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = ((downloaded.saturating_mul(100)) / total).min(100) as u8;
            // Emitting on every chunk would flood the webview; 1% steps are plenty.
            if percent > last_percent {
                last_percent = percent;
                emit(
                    window,
                    phase,
                    format!(
                        "Downloading {label}… {} of {} MB",
                        downloaded / 1_048_576,
                        total / 1_048_576
                    ),
                    Some(percent),
                );
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to finish writing {label}: {e}"))?;
    Ok(())
}

/// Unpacks `archive` into `dest`.
///
/// Both LanguageTool and Adoptium wrap their contents in a single versioned
/// top-level directory (`LanguageTool-6.6/`, `jdk-21.0.x+y-jre/`); `strip_root`
/// drops it so the layout on disk stays version-independent.
fn extract_zip(archive: &Path, dest: &Path, strip_root: bool) -> Result<(), String> {
    let file = std::fs::File::open(archive)
        .map_err(|e| format!("Failed to open {}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Failed to read archive {}: {e}", archive.display()))?;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("Corrupt archive entry {i}: {e}"))?;

        // `enclosed_name` rejects absolute paths and `..` traversal, so a
        // malicious archive can't write outside `dest`.
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let relative = if strip_root {
            let mut components = relative.components();
            components.next();
            components.as_path().to_path_buf()
        } else {
            relative
        };
        if relative.as_os_str().is_empty() {
            continue;
        }

        let target = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("Failed to create {}: {e}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        let mut out = std::fs::File::create(&target)
            .map_err(|e| format!("Failed to create {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Failed to extract {}: {e}", target.display()))?;

        // Zip carries Unix permissions; the JRE's `bin/java` needs its
        // executable bit back or the server can never be launched.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode));
            }
        }
    }

    Ok(())
}

/// Adoptium's redirect endpoint for the latest GA JRE of the running platform.
fn jre_download_url() -> Result<String, String> {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        return Err("No prebuilt JRE is available for this CPU architecture. \
                    Install Java 17 or newer and try again."
            .into());
    };

    Ok(format!(
        "https://api.adoptium.net/v3/binary/latest/{JRE_MAJOR_VERSION}/ga/{os}/{arch}/jre/hotspot/normal/eclipse"
    ))
}

// ── Commands ──

/// Whether LanguageTool is installed, whether a server is answering, and which
/// Java would be used to start one.
#[tauri::command]
pub async fn language_tool_status(
    state: tauri::State<'_, LanguageToolProcess>,
    server_url: String,
) -> Result<LanguageToolStatus, String> {
    let java = find_java();
    let managed = state.lock().await.is_some();

    Ok(LanguageToolStatus {
        installed: is_installed(),
        running: crate::grammar::check_grammar_server_available(server_url).await,
        managed,
        java_path: java
            .as_ref()
            .map(|(path, _)| path.to_string_lossy().into_owned()),
        java_bundled: java.map(|(_, bundled)| bundled).unwrap_or(false),
        install_dir: install_dir()?.to_string_lossy().into_owned(),
        version: LANGUAGE_TOOL_VERSION.to_string(),
    })
}

/// Downloads and unpacks LanguageTool, plus a private JRE if the machine has no
/// Java. Roughly 250 MB (or 300 MB with the JRE) and several minutes on a
/// typical connection; progress is reported through `languagetool-progress`.
#[tauri::command]
pub async fn install_language_tool(window: WebviewWindow) -> Result<(), String> {
    let install_dir = install_dir()?;
    let staging = app_data_dir()?.join("downloads");
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("Failed to create {}: {e}", staging.display()))?;

    // 1. Java, only if the machine doesn't already have a usable one.
    if find_java().is_none() {
        let jre_dir = jre_dir()?;
        let archive = staging.join("jre.zip");
        download(
            &window,
            &jre_download_url()?,
            &archive,
            "java",
            "Java runtime",
        )
        .await?;

        emit(&window, "extract", "Unpacking Java runtime…", None);
        let jre_dir_for_task = jre_dir.clone();
        let archive_for_task = archive.clone();
        tauri::async_runtime::spawn_blocking(move || {
            extract_zip(&archive_for_task, &jre_dir_for_task, true)
        })
        .await
        .map_err(|e| e.to_string())??;
        let _ = std::fs::remove_file(&archive);

        if !jre_java(&jre_dir).is_file() {
            return Err("The Java runtime unpacked without a usable `java` executable.".into());
        }
    }

    // 2. LanguageTool itself.
    let archive = staging.join("languagetool.zip");
    download(
        &window,
        LANGUAGE_TOOL_URL,
        &archive,
        "languagetool",
        &format!("LanguageTool {LANGUAGE_TOOL_VERSION}"),
    )
    .await?;

    emit(&window, "extract", "Unpacking LanguageTool…", None);
    // Replace any half-finished previous attempt rather than merging into it.
    let _ = std::fs::remove_dir_all(&install_dir);
    let install_dir_for_task = install_dir.clone();
    let archive_for_task = archive.clone();
    tauri::async_runtime::spawn_blocking(move || {
        extract_zip(&archive_for_task, &install_dir_for_task, true)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&archive);

    if !is_installed() {
        return Err(format!(
            "LanguageTool unpacked to {} but languagetool-server.jar is missing.",
            install_dir.display()
        ));
    }

    emit(&window, "done", "LanguageTool is ready.", Some(100));
    Ok(())
}

/// Starts the local server and waits until it answers, so the caller can turn
/// grammar checking on immediately afterwards. A no-op if one is already up.
#[tauri::command]
pub async fn start_language_tool(
    state: tauri::State<'_, LanguageToolProcess>,
    server_url: String,
) -> Result<(), String> {
    if crate::grammar::check_grammar_server_available(server_url.clone()).await {
        return Ok(());
    }
    if !is_installed() {
        return Err("LanguageTool is not installed yet.".into());
    }

    let (java, _) = find_java().ok_or(
        "No Java runtime was found. Reinstall LanguageTool from Settings to fetch a private one.",
    )?;
    let jar = server_jar()?;
    let port = port_from_url(&server_url)?;

    let mut command = tokio::process::Command::new(&java);
    command
        .arg(SERVER_MAX_HEAP)
        .args(["-cp"])
        .arg(&jar)
        .args([
            "org.languagetool.server.HTTPServer",
            "--port",
            &port.to_string(),
        ])
        // Loopback only: nothing outside this machine can reach the server.
        .current_dir(install_dir()?)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    // Without this a console window flashes up every time the server starts.
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start LanguageTool: {e}"))?;

    // Poll until the server answers, or give up and surface why it died.
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(SERVER_READY_TIMEOUT_SECS);
    loop {
        if crate::grammar::check_grammar_server_available(server_url.clone()).await {
            *state.lock().await = Some(child);
            return Ok(());
        }

        if let Ok(Some(status)) = child.try_wait() {
            let detail = read_stderr(&mut child).await;
            return Err(format!(
                "LanguageTool exited immediately ({status}).{}",
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(" {detail}")
                }
            ));
        }

        if std::time::Instant::now() >= deadline {
            let _ = child.kill().await;
            return Err(format!(
                "LanguageTool did not start listening on port {port} within {SERVER_READY_TIMEOUT_SECS} seconds."
            ));
        }

        tokio::time::sleep(std::time::Duration::from_millis(SERVER_POLL_INTERVAL_MS)).await;
    }
}

/// Stops a server this app started. Servers the user runs themselves are left
/// alone.
#[tauri::command]
pub async fn stop_language_tool(
    state: tauri::State<'_, LanguageToolProcess>,
) -> Result<(), String> {
    if let Some(mut child) = state.lock().await.take() {
        let _ = child.kill().await;
    }
    Ok(())
}

/// Best-effort shutdown used on app exit, where there is no `State` to borrow.
pub async fn shutdown(process: &LanguageToolProcess) {
    if let Some(mut child) = process.lock().await.take() {
        let _ = child.kill().await;
    }
}

/// Reads whatever the failed process wrote to stderr, trimmed to something that
/// fits in an error toast.
async fn read_stderr(child: &mut tokio::process::Child) -> String {
    use tokio::io::AsyncReadExt;
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut buffer = String::new();
    let _ = stderr.read_to_string(&mut buffer).await;
    buffer
        .lines()
        .take(3)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Extracts the port from the configured server URL, defaulting to LanguageTool's
/// own 8081 when the URL doesn't name one.
fn port_from_url(server_url: &str) -> Result<u16, String> {
    let trimmed = server_url.trim().trim_end_matches('/');
    let after_scheme = trimmed
        .split_once("//")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);

    match host_port.rsplit_once(':') {
        Some((_, port)) => port
            .parse::<u16>()
            .map_err(|_| format!("'{server_url}' does not contain a valid port number.")),
        None => Ok(8081),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_from_url_reads_explicit_port() {
        assert_eq!(port_from_url("http://localhost:8081").unwrap(), 8081);
        assert_eq!(port_from_url("http://127.0.0.1:9000/").unwrap(), 9000);
        assert_eq!(port_from_url("http://localhost:8010/v2").unwrap(), 8010);
    }

    #[test]
    fn port_from_url_defaults_when_absent() {
        assert_eq!(port_from_url("http://localhost").unwrap(), 8081);
        assert_eq!(port_from_url("localhost").unwrap(), 8081);
    }

    #[test]
    fn port_from_url_rejects_nonsense() {
        assert!(port_from_url("http://localhost:not-a-port").is_err());
    }

    #[test]
    fn jre_java_points_at_the_platform_executable() {
        let java = jre_java(Path::new("/opt/jre"));
        assert!(java.ends_with(if cfg!(windows) { "java.exe" } else { "java" }));
        assert!(java.to_string_lossy().contains("bin"));
    }
}
