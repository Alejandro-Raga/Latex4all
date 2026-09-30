//! An Obsidian vault kept on a WebDAV server (Seafile, Nextcloud, …), read and
//! edited straight from there so Latex4All sees what the other devices synced
//! without Obsidian running on this one.
//!
//! The password never reaches the webview: it is saved here, in a file only
//! the user can read, and every request is made from this side.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

#[derive(Serialize, Deserialize, Clone)]
struct Credentials {
    url: String,
    username: String,
    password: String,
}

/// What the webview may know about the connection.
#[derive(Serialize)]
pub struct VaultWebdavStatus {
    pub url: String,
    pub username: String,
}

#[derive(Serialize)]
pub struct VaultWebdavResponse {
    pub status: u16,
    pub etag: Option<String>,
    /// Response body, base64-encoded so binary files (images) survive.
    pub body: String,
}

fn credentials_path() -> Result<PathBuf, String> {
    let dir = dirs::config_dir()
        .or_else(dirs::home_dir)
        .ok_or("Could not find config directory")?;
    Ok(dir.join("Latex4All").join("vault-webdav.json"))
}

fn read_credentials() -> Result<Option<Credentials>, String> {
    let path = credentials_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read vault server settings: {}", e))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("Failed to parse vault server settings: {}", e))
}

fn write_credentials(credentials: &Credentials) -> Result<(), String> {
    let path = credentials_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings folder: {}", e))?;
    }
    let content = serde_json::to_string_pretty(credentials)
        .map_err(|e| format!("Failed to save vault server settings: {}", e))?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("Failed to save vault server settings: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to save vault server settings: {}", e))?;
    #[cfg(unix)]
    {
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to protect vault server settings: {}", e))?;
    }
    Ok(())
}

/// The vault's base URL, without a trailing slash. Plain http only for this
/// computer, so the password never crosses a network unencrypted.
fn normalize_url(url: &str) -> Result<String, String> {
    let url = url.trim().trim_end_matches('/').to_string();
    let local = url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1");
    if !url.starts_with("https://") && !local {
        return Err("The server address must start with https://".to_string());
    }
    Ok(url)
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

/// A path inside the vault (`Papers/Nelson1959.md`) as a URL under `base`.
/// Refuses anything that could step outside the vault.
fn vault_url(base: &str, path: &str) -> Result<String, String> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.iter().any(|s| *s == "." || *s == "..") {
        return Err("Invalid path".to_string());
    }
    let encoded: Vec<String> = segments.iter().map(|s| encode_segment(s)).collect();
    let trailing = if path.ends_with('/') && !encoded.is_empty() {
        "/"
    } else {
        ""
    };
    if encoded.is_empty() {
        Ok(format!("{}/", base))
    } else {
        Ok(format!("{}/{}{}", base, encoded.join("/"), trailing))
    }
}

/// One client for every request, so loading a vault reuses its connections.
fn client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to start HTTP client: {}", e))?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

async fn send(
    credentials: &Credentials,
    method: &str,
    path: &str,
    depth: Option<&str>,
    body: Option<String>,
    if_match: Option<&str>,
) -> Result<VaultWebdavResponse, String> {
    if !matches!(method, "PROPFIND" | "GET" | "PUT" | "MKCOL" | "DELETE") {
        return Err(format!("Unsupported method {}", method));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let is_propfind = method.as_str() == "PROPFIND";
    let mut request = client()?
        .request(method, vault_url(&credentials.url, path)?)
        .basic_auth(&credentials.username, Some(&credentials.password));
    if let Some(depth) = depth {
        request = request.header("Depth", depth);
    }
    if let Some(etag) = if_match {
        request = request.header("If-Match", etag);
    }
    if let Some(body) = body {
        let content_type = if is_propfind {
            "application/xml; charset=utf-8"
        } else {
            "text/markdown; charset=utf-8"
        };
        request = request.header("Content-Type", content_type).body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the vault server: {}", e))?;
    let status = response.status().as_u16();
    let etag = response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read the server's answer: {}", e))?;
    Ok(VaultWebdavResponse {
        status,
        etag,
        body: BASE64.encode(&bytes),
    })
}

/// Checks the address and login against the server, then remembers them.
#[tauri::command]
pub async fn vault_webdav_connect(
    url: String,
    username: String,
    password: String,
) -> Result<VaultWebdavStatus, String> {
    let credentials = Credentials {
        url: normalize_url(&url)?,
        username: username.trim().to_string(),
        password,
    };
    let response = send(&credentials, "PROPFIND", "", Some("0"), None, None).await?;
    match response.status {
        207 | 200 => {}
        401 | 403 => return Err("Wrong username or password.".to_string()),
        404 => return Err("There's no folder at that address.".to_string()),
        status => return Err(format!("The server answered with error {}.", status)),
    }
    write_credentials(&credentials)?;
    Ok(VaultWebdavStatus {
        url: credentials.url,
        username: credentials.username,
    })
}

#[tauri::command]
pub async fn vault_webdav_status() -> Result<Option<VaultWebdavStatus>, String> {
    Ok(read_credentials()?.map(|c| VaultWebdavStatus {
        url: c.url,
        username: c.username,
    }))
}

#[tauri::command]
pub async fn vault_webdav_disconnect() -> Result<(), String> {
    let path = credentials_path()?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to forget the vault server: {}", e))?;
    }
    Ok(())
}

/// One WebDAV request inside the connected vault.
#[tauri::command]
pub async fn vault_webdav_request(
    method: String,
    path: String,
    depth: Option<String>,
    body: Option<String>,
    if_match: Option<String>,
) -> Result<VaultWebdavResponse, String> {
    let credentials = read_credentials()?.ok_or("No vault server is connected.")?;
    send(
        &credentials,
        &method,
        &path,
        depth.as_deref(),
        body,
        if_match.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_stay_inside_the_vault() {
        let base = "https://cloud.example.com/seafdav/Commonplace";
        assert_eq!(vault_url(base, "").unwrap(), format!("{}/", base));
        assert_eq!(
            vault_url(base, "Ideas/Firms underinvest.md").unwrap(),
            format!("{}/Ideas/Firms%20underinvest.md", base)
        );
        assert_eq!(
            vault_url(base, "Papers/").unwrap(),
            format!("{}/Papers/", base)
        );
        assert_eq!(
            vault_url(base, "Ideas/¿Qué?.md").unwrap(),
            format!("{}/Ideas/%C2%BFQu%C3%A9%3F.md", base)
        );
        assert!(vault_url(base, "../other").is_err());
        assert!(vault_url(base, "Ideas/../../x").is_err());
    }

    #[test]
    fn only_https_leaves_this_computer() {
        assert!(normalize_url("http://cloud.example.com/dav").is_err());
        assert_eq!(
            normalize_url(" https://cloud.example.com/dav/ ").unwrap(),
            "https://cloud.example.com/dav"
        );
        assert!(normalize_url("http://localhost:8080/dav").is_ok());
    }
}
