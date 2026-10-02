//! Other AI assistants signed in with the user's own account rather than an
//! API key: OpenAI's Codex CLI (ChatGPT plans) and Google's Gemini CLI
//! (free with a Google account, or a Google AI plan). They are installed in
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
}

impl Engine {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "codex" => Ok(Engine::Codex),
            "gemini" => Ok(Engine::Gemini),
            other => Err(format!("Unknown assistant: {}", other)),
        }
    }

    fn binary(self) -> &'static str {
        match self {
            Engine::Codex => "codex",
            Engine::Gemini => "gemini",
        }
    }

    fn package(self) -> &'static str {
        match self {
            Engine::Codex => "@openai/codex",
            Engine::Gemini => "@google/gemini-cli",
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

fn gemini_login_status() -> (bool, Option<String>) {
    let Some(dir) = gemini_dir() else {
        return (false, None);
    };
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
            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(b"y\n").await;
                let _ = stdin.shutdown().await;
            }
            let _ = tokio::time::timeout(Duration::from_secs(600), child.wait()).await;
            let _ = child.kill().await;
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
}

/// The models one can pick: Codex's own catalog (it changes with OpenAI's
/// line-up), and for Gemini the CLI's aliases, which follow Google's.
#[tauri::command]
pub async fn agent_models(engine: String) -> Result<Vec<AgentModel>, String> {
    let engine = Engine::parse(&engine)?;
    let model = |id: &str, name: &str, description: &str| AgentModel {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
    };
    match engine {
        Engine::Gemini => Ok(vec![
            model("auto", "Auto", "Picks Pro or Flash for each request"),
            model("pro", "Pro", "Most capable"),
            model("flash", "Flash", "Fast, uses less"),
            model("flash-lite", "Flash Lite", "Fastest, lightest"),
        ]),
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
                    })
                })
                .collect())
        }
    }
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
                    "workspace-write",
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
}
