//! Other AI assistants signed in with the user's own account rather than an
//! API key: OpenAI's Codex CLI (ChatGPT plans), Google's Gemini CLI (Gemini
//! Code Assist plans) and GitHub Copilot CLI (Copilot plans, free included). They are installed in
//! Latex4All's own folder with npm, sign in through the browser, and run
//! like Claude Code: one process per request, its JSON lines streamed to the
//! chat (which translates them, see src/lib/agent-events.ts).

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::WebviewWindow;
use tokio::io::AsyncWriteExt;

use crate::claude::create_command;
use crate::claude_process::spawn_claude_process;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Engine {
    Codex,
    Gemini,
    Copilot,
}

impl Engine {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "codex" => Ok(Engine::Codex),
            "gemini" => Ok(Engine::Gemini),
            "copilot" => Ok(Engine::Copilot),
            other => Err(format!("Unknown assistant: {}", other)),
        }
    }

    fn binary(self) -> &'static str {
        match self {
            Engine::Codex => "codex",
            Engine::Gemini => "gemini",
            Engine::Copilot => "copilot",
        }
    }

    fn package(self) -> &'static str {
        match self {
            Engine::Codex => "@openai/codex",
            Engine::Gemini => "@google/gemini-cli",
            Engine::Copilot => "@github/copilot",
        }
    }
}

/// Where Latex4All installs these: ~/.latex4all/agents.
fn agents_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".latex4all").join("agents"))
}

fn gemini_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".gemini"))
}

/// The engine's program: ours first, then one the user installed.
fn find_binary(engine: Engine) -> Option<String> {
    let name = engine.binary();
    if let Some(dir) = agents_dir() {
        let bin = dir.join("node_modules").join(".bin");
        #[cfg(target_os = "windows")]
        let ours = bin.join(format!("{}.cmd", name));
        #[cfg(not(target_os = "windows"))]
        let ours = bin.join(name);
        if ours.exists() {
            return Some(ours.to_string_lossy().to_string());
        }
    }
    if let Ok(path) = which::which(name) {
        return Some(path.to_string_lossy().to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
            let candidate = PathBuf::from(dir).join(name);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        if let Some(path) = crate::claude::run_login_shell_command(&format!("command -v {}", name))
        {
            if PathBuf::from(&path).exists() {
                return Some(path);
            }
        }
    }
    None
}

fn find_npm() -> Option<String> {
    #[cfg(target_os = "windows")]
    let name = "npm.cmd";
    #[cfg(not(target_os = "windows"))]
    let name = "npm";
    if let Ok(path) = which::which(name) {
        return Some(path.to_string_lossy().to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
            let candidate = PathBuf::from(dir).join("npm");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        if let Some(path) = crate::claude::run_login_shell_command("command -v npm") {
            if PathBuf::from(&path).exists() {
                return Some(path);
            }
        }
    }
    None
}

fn home_string() -> String {
    dirs::home_dir()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

#[derive(Serialize)]
pub struct AgentStatus {
    installed: bool,
    signed_in: bool,
    /// Who is signed in, when the engine says.
    account: Option<String>,
    /// Whether npm is there to install it with.
    can_install: bool,
}

async fn codex_login_status(program: &str) -> (bool, Option<String>) {
    let mut cmd = create_command(
        program,
        vec!["login".into(), "status".into()],
        &home_string(),
        None,
    );
    cmd.stdin(std::process::Stdio::null());
    match tokio::time::timeout(Duration::from_secs(20), cmd.output()).await {
        Ok(Ok(output)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let line = text
                .lines()
                .find(|l| l.to_lowercase().contains("logged in"))
                .map(|l| l.trim().to_string());
            let signed_in = output.status.success()
                && line
                    .as_deref()
                    .map(|l| !l.to_lowercase().contains("not logged in"))
                    .unwrap_or(false);
            (signed_in, if signed_in { line } else { None })
        }
        _ => (false, None),
    }
}

/// Set when Google refused the signed-in account (a free one).
fn gemini_refused_marker() -> Option<PathBuf> {
    agents_dir().map(|dir| dir.join("gemini-not-paid"))
}

fn gemini_login_status() -> (bool, Option<String>) {
    let Some(dir) = gemini_dir() else {
        return (false, None);
    };
    if gemini_refused_marker().is_some_and(|m| m.exists()) {
        return (false, None);
    }
    if !dir.join("oauth_creds.json").exists() {
        return (false, None);
    }
    let account = std::fs::read_to_string(dir.join("google_accounts.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| {
            value
                .get("active")
                .and_then(|a| a.as_str())
                .map(str::to_string)
        });
    (true, account)
}

fn copilot_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".copilot"))
}

/// Copilot's settings file: JSON with "//" comment lines on top.
fn copilot_config() -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(copilot_dir()?.join("config.json")).ok()?;
    let json: String = text
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    serde_json::from_str(&json).ok()
}

/// The GitHub token Copilot would use besides its own sign-in: one in the
/// environment, or the GitHub CLI's (Copilot accepts both).
async fn github_token() -> Option<String> {
    for key in ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(token) = std::env::var(key) {
            if !token.trim().is_empty() {
                return Some(token.trim().to_string());
            }
        }
    }
    let gh = which::which("gh")
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| {
            ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
                .iter()
                .find(|p| PathBuf::from(p).exists())
                .map(|p| p.to_string())
        })?;
    let mut cmd = create_command(
        &gh,
        vec!["auth".into(), "token".into()],
        &home_string(),
        None,
    );
    cmd.stdin(std::process::Stdio::null());
    let output = tokio::time::timeout(Duration::from_secs(10), cmd.output())
        .await
        .ok()?
        .ok()?;
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !token.is_empty()).then_some(token)
}

/// Signed in to Copilot: with its own login (its config names the user),
/// or through a GitHub token it picks up.
async fn copilot_login_status() -> (bool, Option<String>) {
    let config = copilot_config();
    let user = config.as_ref().and_then(|c| {
        c.get("lastLoggedInUser")
            .or_else(|| c.get("last_logged_in_user"))
            .and_then(|u| u.get("login"))
            .and_then(|l| l.as_str())
            .map(str::to_string)
            .or_else(|| {
                c.get("loggedInUsers")
                    .or_else(|| c.get("logged_in_users"))
                    .and_then(|u| u.as_array())
                    .and_then(|u| u.first())
                    .and_then(|u| u.get("login"))
                    .and_then(|l| l.as_str())
                    .map(str::to_string)
            })
    });
    if let Some(user) = user {
        return (true, Some(user));
    }
    if github_token().await.is_some() {
        return (true, Some("Your GitHub account (GitHub CLI)".to_string()));
    }
    (false, None)
}

#[tauri::command]
pub async fn agent_status(engine: String) -> Result<AgentStatus, String> {
    let engine = Engine::parse(&engine)?;
    let can_install = find_npm().is_some();
    let Some(program) = find_binary(engine) else {
        return Ok(AgentStatus {
            installed: false,
            signed_in: false,
            account: None,
            can_install,
        });
    };
    let (signed_in, account) = match engine {
        Engine::Codex => codex_login_status(&program).await,
        Engine::Gemini => gemini_login_status(),
        Engine::Copilot => copilot_login_status().await,
    };
    Ok(AgentStatus {
        installed: true,
        signed_in,
        account,
        can_install,
    })
}

/// Installs (or updates) the engine into ~/.latex4all/agents with npm.
#[tauri::command]
pub async fn agent_install(engine: String) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    let npm = find_npm().ok_or_else(|| {
        "Installing needs Node.js. Get it from nodejs.org, then try again.".to_string()
    })?;
    let dir = agents_dir().ok_or("No home folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let args = vec![
        "install".to_string(),
        "--prefix".to_string(),
        dir.to_string_lossy().to_string(),
        format!("{}@latest", engine.package()),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
    ];
    let mut cmd = create_command(&npm, args, &dir.to_string_lossy(), None);
    cmd.stdin(std::process::Stdio::null());
    let output = tokio::time::timeout(Duration::from_secs(600), cmd.output())
        .await
        .map_err(|_| "Installing took too long.".to_string())?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = err.lines().rev().take(6).collect();
        return Err(format!(
            "npm couldn't install it: {}",
            tail.into_iter().rev().collect::<Vec<_>>().join(" ")
        ));
    }
    Ok(())
}

/// Signs in through the browser; waits until it's done (or ten minutes).
#[tauri::command]
pub async fn agent_login(engine: String) -> Result<bool, String> {
    let engine = Engine::parse(&engine)?;
    let program = find_binary(engine).ok_or("Install it first.")?;
    match engine {
        Engine::Codex => {
            let mut cmd = create_command(&program, vec!["login".into()], &home_string(), None);
            cmd.stdin(std::process::Stdio::null());
            let _ = tokio::time::timeout(Duration::from_secs(600), cmd.output()).await;
            Ok(codex_login_status(&program).await.0)
        }
        Engine::Copilot => {
            let mut cmd = create_command(&program, vec!["login".into()], &home_string(), None);
            cmd.stdin(std::process::Stdio::null());
            let _ = tokio::time::timeout(Duration::from_secs(600), cmd.output()).await;
            Ok(copilot_login_status().await.0)
        }
        Engine::Gemini => {
            // A tiny request with "Login with Google" selected: Gemini asks
            // for consent on stdin, then opens the browser to sign in.
            let args = vec![
                "-p".to_string(),
                "Reply with the word ok.".to_string(),
                "-o".to_string(),
                "json".to_string(),
                "--skip-trust".to_string(),
            ];
            let mut cmd = create_command(&program, args, &home_string(), None);
            cmd.env("GOOGLE_GENAI_USE_GCA", "true");
            cmd.stdin(std::process::Stdio::piped());
            cmd.kill_on_drop(true);
            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(b"y\n").await;
                let _ = stdin.shutdown().await;
            }
            let output =
                tokio::time::timeout(Duration::from_secs(600), child.wait_with_output()).await;
            // Signed in, but Google turns free accounts away: said now, not
            // at the first message.
            let refused = output
                .ok()
                .and_then(|o| o.ok())
                .map(|o| String::from_utf8_lossy(&o.stderr).contains("IneligibleTier"))
                .unwrap_or(false);
            if let Some(marker) = gemini_refused_marker() {
                if refused {
                    let _ = std::fs::write(&marker, "");
                } else {
                    let _ = std::fs::remove_file(&marker);
                }
            }
            if refused {
                return Err(
                    "Only for paid Gemini plans. For free Gemini, add a Gemini API key."
                        .to_string(),
                );
            }
            Ok(gemini_login_status().0)
        }
    }
}

#[tauri::command]
pub async fn agent_logout(engine: String) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    match engine {
        Engine::Codex => {
            let program = find_binary(engine).ok_or("Not installed.")?;
            let mut cmd = create_command(&program, vec!["logout".into()], &home_string(), None);
            cmd.stdin(std::process::Stdio::null());
            let _ = tokio::time::timeout(Duration::from_secs(30), cmd.output()).await;
        }
        Engine::Gemini => {
            if let Some(dir) = gemini_dir() {
                let _ = std::fs::remove_file(dir.join("oauth_creds.json"));
            }
            if let Some(marker) = gemini_refused_marker() {
                let _ = std::fs::remove_file(marker);
            }
        }
        Engine::Copilot => {
            let program = find_binary(engine).ok_or("Not installed.")?;
            let mut cmd = create_command(&program, vec!["logout".into()], &home_string(), None);
            cmd.stdin(std::process::Stdio::null());
            let _ = tokio::time::timeout(Duration::from_secs(30), cmd.output()).await;
            if copilot_login_status().await.0 {
                return Err(
                    "Copilot is still signed in through the GitHub CLI. Run gh auth logout to disconnect it."
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

/// Claude's skills, for Codex and Gemini: yours, as set for each in
/// Settings → Skills (see skills_manager.rs), and the project's
/// (.claude/skills), where each of them looks for skills.
fn share_claude_skills(engine: Engine, project_path: &str) {
    crate::skills_manager::apply_engine(engine.binary());
    let project = PathBuf::from(project_path);
    let source = project.join(".claude").join("skills");
    let target = match engine {
        Engine::Codex => project.join(".agents").join("skills"),
        Engine::Gemini => project.join(".gemini").join("skills"),
        Engine::Copilot => project.join(".github").join("skills"),
    };
    if !source.is_dir() && !target.is_dir() {
        return;
    }
    let wanted: Vec<(std::ffi::OsString, PathBuf)> = std::fs::read_dir(&source)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().join("SKILL.md").is_file())
                .map(|e| (e.file_name(), e.path()))
                .collect()
        })
        .unwrap_or_default();
    crate::skills_manager::mirror_skill_list(&wanted, &[source], &target);
}

#[derive(Serialize)]
pub struct AgentModel {
    id: String,
    name: String,
    description: String,
    /// Copilot: "light", "versatile" or "powerful".
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    /// Copilot: "available", "enable" (off in GitHub's settings) or
    /// "upgrade" (not in the plan).
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
}

/// The models one can pick: Codex's own catalog (it changes with OpenAI's
/// line-up), for Gemini the CLI's aliases, which follow Google's, and for
/// Copilot the ones the account's plan lets it pick (a free plan: Auto).
#[tauri::command]
pub async fn agent_models(engine: String) -> Result<Vec<AgentModel>, String> {
    let engine = Engine::parse(&engine)?;
    let model = |id: &str, name: &str, description: &str| AgentModel {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        category: None,
        status: None,
    };
    match engine {
        Engine::Gemini => Ok(vec![
            model("auto", "Auto", "Picks Pro or Flash for each request"),
            model("pro", "Pro", "Most capable"),
            model("flash", "Flash", "Fast, uses less"),
            model("flash-lite", "Flash Lite", "Fastest, lightest"),
        ]),
        Engine::Copilot => {
            let mut models = vec![model(
                "auto",
                "Auto",
                "Copilot picks a model for each request",
            )];
            if let Some(token) = github_token().await {
                models.extend(copilot_models(&token).await.unwrap_or_default());
                models[0].status = Some("available".to_string());
            }
            Ok(models)
        }
        Engine::Codex => {
            let program = find_binary(engine).ok_or("Not installed.")?;
            let mut cmd = create_command(
                &program,
                vec!["debug".into(), "models".into()],
                &home_string(),
                None,
            );
            cmd.stdin(std::process::Stdio::null());
            let output = tokio::time::timeout(Duration::from_secs(30), cmd.output())
                .await
                .map_err(|_| "Codex took too long to list its models.".to_string())?
                .map_err(|e| e.to_string())?;
            let catalog: serde_json::Value =
                serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
            let models = catalog
                .get("models")
                .and_then(|m| m.as_array())
                .cloned()
                .unwrap_or_default();
            Ok(models
                .iter()
                .filter(|m| m.get("visibility").and_then(|v| v.as_str()) == Some("list"))
                .filter_map(|m| {
                    let id = m.get("slug")?.as_str()?;
                    let text = |key: &str| {
                        m.get(key)
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string()
                    };
                    let name = text("display_name");
                    Some(AgentModel {
                        id: id.to_string(),
                        name: if name.is_empty() {
                            id.to_string()
                        } else {
                            name
                        },
                        description: text("description"),
                        category: None,
                        status: None,
                    })
                })
                .collect())
        }
    }
}

/// Copilot's model catalog, as the account sees it: the ones its plan lets
/// one pick (others are chosen by Auto only).
async fn copilot_models(token: &str) -> Result<Vec<AgentModel>, String> {
    let catalog: serde_json::Value = reqwest::Client::new()
        .get("https://api.githubcopilot.com/models")
        .bearer_auth(token)
        .header("Copilot-Integration-Id", "copilot-developer-cli")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
    Ok(copilot_pickable(&catalog))
}

fn copilot_pickable(catalog: &serde_json::Value) -> Vec<AgentModel> {
    let text = |m: &serde_json::Value, key: &str| {
        m.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let mut models: Vec<AgentModel> = catalog
        .get("data")
        .and_then(|d| d.as_array())
        .map(|models| {
            models
                .iter()
                .filter(|m| {
                    m.pointer("/capabilities/type").and_then(|v| v.as_str()) == Some("chat")
                })
                // Without a picker category it's internal (search, compaction)
                // or an old snapshot.
                .filter_map(|m| {
                    let category = match m.get("model_picker_category")?.as_str()? {
                        "lightweight" => "light",
                        "versatile" => "versatile",
                        "powerful" => "powerful",
                        _ => return None,
                    };
                    let pickable =
                        m.get("model_picker_enabled").and_then(|v| v.as_bool()) == Some(true);
                    let off =
                        m.pointer("/policy/state").and_then(|v| v.as_str()) == Some("disabled");
                    let status = match (pickable, off) {
                        (true, false) => "available",
                        (true, true) => "enable",
                        (false, _) => "upgrade",
                    };
                    let id = text(m, "id");
                    let name = text(m, "name");
                    Some(AgentModel {
                        name: if name.is_empty() { id.clone() } else { name },
                        description: text(m, "vendor"),
                        id,
                        category: Some(category.to_string()),
                        status: Some(status.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    // Usable ones first, then by how capable.
    let rank = |m: &AgentModel| {
        let status = match m.status.as_deref() {
            Some("available") => 0,
            Some("enable") => 1,
            _ => 2,
        };
        let category = match m.category.as_deref() {
            Some("light") => 0,
            Some("versatile") => 1,
            _ => 2,
        };
        (status, category)
    };
    models.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.name.cmp(&b.name)));
    models
}

/// Copilot's monthly allowance of premium requests, as GitHub counts it.
#[derive(Serialize)]
pub struct CopilotQuota {
    plan: Option<String>,
    /// The kind of access: "free_educational_quota", "free_limited_copilot"…
    sku: Option<String>,
    entitlement: f64,
    remaining: f64,
    unlimited: bool,
    /// Seconds since the epoch.
    resets_at: Option<i64>,
}

#[tauri::command]
pub async fn copilot_quota() -> Result<Option<CopilotQuota>, String> {
    let Some(token) = github_token().await else {
        return Ok(None);
    };
    let user: serde_json::Value = reqwest::Client::new()
        .get("https://api.github.com/copilot_internal/user")
        .bearer_auth(token)
        .header("User-Agent", "Latex4All")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
    Ok(copilot_quota_from(&user))
}

fn copilot_quota_from(user: &serde_json::Value) -> Option<CopilotQuota> {
    let premium = user.pointer("/quota_snapshots/premium_interactions")?;
    let number = |key: &str| premium.get(key).and_then(|v| v.as_f64());
    let resets_at = user
        .get("quota_reset_date_utc")
        .and_then(|v| v.as_str())
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.timestamp());
    Some(CopilotQuota {
        plan: user
            .get("copilot_plan")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        sku: user
            .get("access_type_sku")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        entitlement: number("entitlement").unwrap_or(0.0),
        remaining: number("remaining")
            .or_else(|| number("quota_remaining"))
            .unwrap_or(0.0),
        unlimited: premium.get("unlimited").and_then(|v| v.as_bool()) == Some(true),
        resets_at,
    })
}

/// The tokens a Copilot session's latest run used: its log totals them per
/// session, so the last total less the one before.
#[tauri::command]
pub async fn copilot_run_usage(session_id: String) -> Result<Option<serde_json::Value>, String> {
    if session_id.is_empty() || session_id.contains(['/', '\\', '.']) {
        return Ok(None);
    }
    let Some(file) = copilot_dir().map(|d| {
        d.join("session-state")
            .join(&session_id)
            .join("events.jsonl")
    }) else {
        return Ok(None);
    };
    let Ok(text) = std::fs::read_to_string(file) else {
        return Ok(None);
    };
    Ok(copilot_run_usage_from(&text))
}

fn copilot_run_usage_from(text: &str) -> Option<serde_json::Value> {
    let totals: Vec<serde_json::Value> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("session.shutdown"))
        .filter_map(|e| e.get("data").cloned())
        .collect();
    let last = totals.last()?;
    let count = |d: Option<&serde_json::Value>, key: &str| {
        d.and_then(|d| d.pointer(&format!("/tokenDetails/{}/tokenCount", key)))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
    };
    let premium = |d: Option<&serde_json::Value>| {
        d.and_then(|d| d.get("totalPremiumRequests"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
    };
    let before = totals.len().checked_sub(2).and_then(|i| totals.get(i));
    let delta = |key: &str| (count(Some(last), key) - count(before, key)).max(0.0);
    Some(serde_json::json!({
        "input": delta("input"),
        "cache_read": delta("cache_read"),
        "cache_write": delta("cache_write"),
        "output": delta("output"),
        "premium_requests": (premium(Some(last)) - premium(before)).max(0.0),
        "models": last
            .get("modelMetrics")
            .and_then(|m| m.as_object())
            .map(|m| m.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
    }))
}

/// Codex's session files: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl.
fn codex_session_files() -> Vec<PathBuf> {
    let Some(root) = dirs::home_dir().map(|h| h.join(".codex").join("sessions")) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    let mut stack = vec![(root, 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() && depth < 4 {
                stack.push((path, depth + 1));
            } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                files.push(path);
            }
        }
    }
    files
}

/// How full the ChatGPT plan's windows are, as Codex last recorded them:
/// for one session (its thread id), or the latest of all. Codex writes it
/// with each turn's token count.
#[tauri::command]
pub async fn codex_rate_limits(
    thread_id: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let mut files = codex_session_files();
    if let Some(id) = thread_id.filter(|id| !id.is_empty()) {
        files.retain(|f| {
            f.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(&format!("{}.jsonl", id)))
        });
    }
    files.sort_by_key(|f| std::fs::metadata(f).and_then(|m| m.modified()).ok());
    for file in files.iter().rev().take(5) {
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        for line in text.lines().rev() {
            if !line.contains("\"rate_limits\"") {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            if let Some(limits) = value.pointer("/payload/rate_limits") {
                if !limits.is_null() {
                    return Ok(Some(limits.clone()));
                }
            }
        }
    }
    Ok(None)
}

/// Codex's sandbox: on macOS and Linux it lets Codex write in the project
/// and nowhere else. On Windows that sandbox needs a setup of its own (an
/// elevated one, or it falls back) and without it Codex can't write the
/// project at all, so there it runs as Claude Code does here: with full
/// access, every edit still going through the app's review and Undo.
#[cfg(target_os = "windows")]
const CODEX_SANDBOX: &str = "danger-full-access";
#[cfg(not(target_os = "windows"))]
const CODEX_SANDBOX: &str = "workspace-write";

/// The command line for one request, the prompt going in on stdin.
fn agent_args(
    engine: Engine,
    project_path: &str,
    model: Option<&str>,
    session_id: Option<&str>,
    effort_level: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match engine {
        Engine::Codex => {
            args.extend(
                [
                    "exec",
                    "--json",
                    "--skip-git-repo-check",
                    "--sandbox",
                    CODEX_SANDBOX,
                    "-c",
                    "approval_policy=\"never\"",
                    "--cd",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
            args.push(project_path.to_string());
            if let Some(m) = model.filter(|m| !m.is_empty()) {
                args.push("-m".into());
                args.push(m.to_string());
            }
            if let Some(e) = effort_level.filter(|e| matches!(*e, "low" | "medium" | "high")) {
                args.push("-c".into());
                args.push(format!("model_reasoning_effort=\"{}\"", e));
            }
            if let Some(id) = session_id.filter(|id| !id.is_empty()) {
                args.push("resume".into());
                args.push(id.to_string());
            }
            args.push("-".into());
        }
        Engine::Copilot => {
            // The prompt on stdin, as for the others; every tool allowed
            // (changes still go through the chat's review), no banner or
            // update check.
            args.extend(
                [
                    "--output-format",
                    "json",
                    "--allow-all-tools",
                    "--no-auto-update",
                    "--disable-builtin-mcps",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
            let model = model.filter(|m| !m.is_empty()).unwrap_or("auto");
            args.push("--model".into());
            args.push(model.to_string());
            // Auto picks the model, and with it the effort: Copilot refuses
            // one set by hand.
            if model != "auto" {
                if let Some(e) = effort_level.filter(|e| matches!(*e, "low" | "medium" | "high")) {
                    args.push("--reasoning-effort".into());
                    args.push(e.to_string());
                }
            }
            if let Some(id) = session_id.filter(|id| !id.is_empty()) {
                args.push("--resume".into());
                args.push(id.to_string());
            }
        }
        Engine::Gemini => {
            args.extend(
                [
                    "-o",
                    "stream-json",
                    "--approval-mode",
                    "yolo",
                    "--skip-trust",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
            if let Some(m) = model.filter(|m| !m.is_empty()) {
                args.push("-m".into());
                args.push(m.to_string());
            }
            if let Some(id) = session_id.filter(|id| !id.is_empty()) {
                args.push("--resume".into());
                args.push(id.to_string());
            }
        }
    }
    args
}

#[tauri::command]
pub async fn execute_agent(
    window: WebviewWindow,
    engine: String,
    project_path: String,
    prompt: String,
    tab_id: String,
    model: Option<String>,
    session_id: Option<String>,
    effort_level: Option<String>,
) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    let program = find_binary(engine).ok_or_else(|| {
        format!(
            "{} isn't installed. Set it up in Settings → Provider.",
            engine.binary()
        )
    })?;
    let args = agent_args(
        engine,
        &project_path,
        model.as_deref(),
        session_id.as_deref(),
        effort_level.as_deref(),
    );
    share_claude_skills(engine, &project_path);
    let mut cmd = create_command(&program, args, &project_path, None);
    if engine == Engine::Gemini {
        cmd.env("GOOGLE_GENAI_USE_GCA", "true");
    }
    spawn_claude_process(window, cmd, tab_id, Some(prompt), None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_resumes_with_the_prompt_on_stdin() {
        let args = agent_args(Engine::Codex, "/p", Some("gpt-5"), Some("T1"), Some("low"));
        assert_eq!(args[0], "exec");
        assert!(args.contains(&"--json".to_string()));
        let resume = args.iter().position(|a| a == "resume").unwrap();
        assert_eq!(args[resume + 1], "T1");
        assert_eq!(args.last().unwrap(), "-");
        assert!(args.contains(&"model_reasoning_effort=\"low\"".to_string()));
    }

    #[test]
    fn gemini_streams_json_and_resumes_by_id() {
        let args = agent_args(Engine::Gemini, "/p", None, Some("S1"), None);
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"yolo".to_string()));
        let resume = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[resume + 1], "S1");
        assert!(!args.contains(&"-m".to_string()));
    }

    #[test]
    fn copilot_runs_on_auto_unless_told_and_resumes() {
        let args = agent_args(Engine::Copilot, "/p", None, Some("S1"), Some("high"));
        let model = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(args[model + 1], "auto");
        assert!(args.contains(&"--allow-all-tools".to_string()));
        let resume = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[resume + 1], "S1");
        // Auto takes no effort; a named model does.
        assert!(!args.contains(&"--reasoning-effort".to_string()));
        let args = agent_args(
            Engine::Copilot,
            "/p",
            Some("gpt-6-luna"),
            None,
            Some("high"),
        );
        let effort = args.iter().position(|a| a == "--reasoning-effort").unwrap();
        assert_eq!(args[effort + 1], "high");
    }

    #[test]
    fn copilot_lists_its_models_with_what_the_plan_allows() {
        let catalog = serde_json::json!({"data": [
            {"id": "claude-sonnet-5", "name": "Claude Sonnet 5", "vendor": "Anthropic", "model_picker_enabled": true,
             "model_picker_category": "versatile", "policy": {"state": "disabled"}, "capabilities": {"type": "chat"}},
            {"id": "gpt-6-luna", "name": "GPT-6 Luna", "vendor": "OpenAI", "model_picker_enabled": true,
             "model_picker_category": "lightweight", "policy": {"state": "enabled"}, "capabilities": {"type": "chat"}},
            {"id": "gpt-6-sol", "name": "GPT-6 Sol", "model_picker_enabled": false,
             "model_picker_category": "powerful", "policy": {"state": "enabled"}, "capabilities": {"type": "chat"}},
            {"id": "exec-agent-a", "model_picker_enabled": false, "capabilities": {"type": "chat"}},
            {"id": "text-embedding-3-small", "model_picker_category": "lightweight", "capabilities": {"type": "embeddings"}}
        ]});
        let models = copilot_pickable(&catalog);
        let seen: Vec<(&str, &str, &str)> = models
            .iter()
            .map(|m| {
                (
                    m.id.as_str(),
                    m.status.as_deref().unwrap(),
                    m.category.as_deref().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            vec![
                ("gpt-6-luna", "available", "light"),
                ("claude-sonnet-5", "enable", "versatile"),
                ("gpt-6-sol", "upgrade", "powerful"),
            ]
        );
    }

    #[test]
    fn copilot_run_usage_is_the_latest_run_alone() {
        let log = [
            r#"{"type":"session.shutdown","data":{"totalPremiumRequests":1,"tokenDetails":{"input":{"tokenCount":9},"cache_read":{"tokenCount":26386},"cache_write":{"tokenCount":13369},"output":{"tokenCount":173}},"modelMetrics":{"gpt-5.6-luna":{}}}}"#,
            r#"{"type":"user.message","data":{}}"#,
            r#"{"type":"session.shutdown","data":{"totalPremiumRequests":2,"tokenDetails":{"input":{"tokenCount":12},"cache_read":{"tokenCount":39533},"cache_write":{"tokenCount":13622},"output":{"tokenCount":178}},"modelMetrics":{"gpt-5.6-luna":{}}}}"#,
        ]
        .join("\n");
        let usage = copilot_run_usage_from(&log).unwrap();
        assert_eq!(usage["input"], 3.0);
        assert_eq!(usage["cache_read"], 13147.0);
        assert_eq!(usage["output"], 5.0);
        assert_eq!(usage["premium_requests"], 1.0);
        assert_eq!(usage["models"][0], "gpt-5.6-luna");
    }

    #[test]
    fn copilot_quota_reads_premium_requests() {
        let user = serde_json::json!({
            "copilot_plan": "individual",
            "quota_reset_date_utc": "2026-11-01T00:00:00.000Z",
            "quota_snapshots": {"premium_interactions": {"entitlement": 200, "remaining": 150, "unlimited": false}}
        });
        let q = copilot_quota_from(&user).unwrap();
        assert_eq!(q.entitlement, 200.0);
        assert_eq!(q.remaining, 150.0);
        assert_eq!(q.resets_at, Some(1793491200));
    }
}
