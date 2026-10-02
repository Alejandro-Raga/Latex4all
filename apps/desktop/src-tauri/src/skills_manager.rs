//! Which AI uses which skill. Every skill in ~/.claude/skills and
//! ~/.claude/skills-disabled is one library; ~/.latex4all/skills.json says,
//! per assistant, which are on, and any group the user put a skill in.
//!
//! Claude Code (Claude, and the API-key services that run through it) sees
//! what's in ~/.claude/skills, so a skill off for it moves to
//! skills-disabled. Codex and Gemini get links (copies on Windows) to the
//! skills on for them, in their own folders.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The assistants skills are set for.
pub const AIS: [&str; 4] = ["claude", "codex", "gemini", "copilot"];

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct SkillSettings {
    /// Assistant → skill folder → on.
    #[serde(default)]
    pub enabled: HashMap<String, HashMap<String, bool>>,
    /// Skill folder → the group the user put it in.
    #[serde(default)]
    pub groups: HashMap<String, String>,
}

fn settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".latex4all").join("skills.json"))
}

pub fn load_settings() -> SkillSettings {
    settings_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(settings: &SkillSettings) -> Result<(), String> {
    let path = settings_path().ok_or("No home folder")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// ~/.claude/skills and ~/.claude/skills-disabled.
fn claude_dirs() -> Option<(PathBuf, PathBuf)> {
    let home = dirs::home_dir()?;
    let claude = home.join(".claude");
    Some((claude.join("skills"), claude.join("skills-disabled")))
}

fn has_skill_md(dir: &Path) -> bool {
    dir.join("SKILL.md").is_file() || dir.join("skill.md").is_file()
}

/// A skill in the library, where it is now.
#[derive(Clone)]
pub struct LibSkill {
    pub folder: String,
    pub path: PathBuf,
    /// In ~/.claude/skills (on for Claude Code), not skills-disabled.
    pub in_claude: bool,
}

fn skills_in(dir: &Path, in_claude: bool) -> Vec<LibSkill> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| has_skill_md(&e.path()))
        .map(|e| LibSkill {
            folder: e.file_name().to_string_lossy().to_string(),
            path: e.path(),
            in_claude,
        })
        .collect()
}

/// Every skill, on or off; one entry per folder name (an active copy wins).
pub fn library() -> Vec<LibSkill> {
    let Some((on, off)) = claude_dirs() else {
        return Vec::new();
    };
    let mut skills = skills_in(&on, true);
    for skill in skills_in(&off, false) {
        if !skills.iter().any(|s| s.folder == skill.folder) {
            skills.push(skill);
        }
    }
    skills.sort_by(|a, b| a.folder.cmp(&b.folder));
    skills
}

/// Whether `ai` uses `skill`: as set, else as Claude does (and Claude, by
/// where the skill is).
pub fn is_enabled(settings: &SkillSettings, ai: &str, skill: &LibSkill) -> bool {
    let set = settings
        .enabled
        .get(ai)
        .and_then(|m| m.get(&skill.folder))
        .copied();
    match set {
        Some(on) => on,
        None if ai == "claude" => skill.in_claude,
        None => is_enabled(settings, "claude", skill),
    }
}

/// The `name` and `description` from a SKILL.md's frontmatter (the part
/// every request carries), with a folded or literal block read whole.
pub fn frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let body: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    let field = |key: &str| -> Option<String> {
        let start = body
            .iter()
            .position(|l| l.starts_with(&format!("{}:", key)))?;
        let first = body[start][key.len() + 1..].trim();
        let block = first.is_empty() || first.starts_with('>') || first.starts_with('|');
        let mut text = if block {
            String::new()
        } else {
            first.trim_matches(|c| c == '"' || c == '\'').to_string()
        };
        if block {
            for line in &body[start + 1..] {
                if !line.starts_with(' ') && !line.trim().is_empty() {
                    break;
                }
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(line.trim());
            }
        }
        let text = text.trim().to_string();
        (!text.is_empty()).then_some(text)
    };
    (field("name"), field("description"))
}

/// Latex4All's mark on a skill folder it copied (Windows, where linking
/// needs admin rights), so it knows it may refresh or remove it.
pub const COPY_MARK: &str = ".latex4all-skill";

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn modified(path: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Puts exactly `wanted` (name → skill folder) in `target`, as links (or
/// copies). What we made that isn't wanted, or points elsewhere now, goes;
/// links into `ours` count as ours. Anything else there is left alone.
pub fn mirror_skill_list(wanted: &[(OsString, PathBuf)], ours: &[PathBuf], target: &Path) {
    if let Ok(entries) = std::fs::read_dir(target) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let want = wanted.iter().find(|(name, _)| *name == entry.file_name());
            if let Ok(dest) = std::fs::read_link(&path) {
                let mine = ours.iter().any(|root| dest.starts_with(root));
                let right = want.map(|(_, p)| *p == dest).unwrap_or(false);
                if mine && !right {
                    let _ = std::fs::remove_file(&path);
                }
            } else if path.join(COPY_MARK).exists() && want.is_none() {
                let _ = std::fs::remove_dir_all(&path);
            }
        }
    }
    if wanted.is_empty() || std::fs::create_dir_all(target).is_err() {
        return;
    }
    for (name, path) in wanted {
        let dest = target.join(name);
        let exists = std::fs::symlink_metadata(&dest).is_ok();
        #[cfg(not(target_os = "windows"))]
        {
            if !exists {
                let _ = std::os::unix::fs::symlink(path, &dest);
            }
        }
        #[cfg(target_os = "windows")]
        {
            let mine = dest.join(COPY_MARK).exists();
            if exists && !mine {
                continue;
            }
            let stale =
                !exists || modified(&path.join("SKILL.md")) != modified(&dest.join("SKILL.md"));
            if stale {
                let _ = std::fs::remove_dir_all(&dest);
                if copy_dir(path, &dest).is_ok() {
                    let _ = std::fs::write(dest.join(COPY_MARK), "");
                    if let (Some(time), Ok(file)) = (
                        modified(&path.join("SKILL.md")),
                        std::fs::File::options()
                            .write(true)
                            .open(dest.join("SKILL.md")),
                    ) {
                        let _ = file.set_modified(time);
                    }
                }
            }
        }
    }
}

/// Moves Claude Code's skills in or out of ~/.claude/skills as set.
fn apply_claude(settings: &SkillSettings) {
    let Some((on, off)) = claude_dirs() else {
        return;
    };
    for skill in library() {
        let want = is_enabled(settings, "claude", &skill);
        if want == skill.in_claude {
            continue;
        }
        let dest = if want { &on } else { &off };
        let _ = std::fs::create_dir_all(dest);
        let target = dest.join(&skill.folder);
        if !target.exists() {
            let _ = std::fs::rename(&skill.path, &target);
        }
    }
}

/// Links the skills on for Codex or Gemini into their folder.
pub fn apply_engine(ai: &str) {
    let (Some(home), Some((on, off))) = (dirs::home_dir(), claude_dirs()) else {
        return;
    };
    let tool_home = match ai {
        "codex" => home.join(".codex"),
        "gemini" => home.join(".gemini"),
        "copilot" => home.join(".copilot"),
        _ => return,
    };
    // Not for a tool never used here: no folders in an unused one's place.
    if !tool_home.is_dir() {
        return;
    }
    let target = tool_home.join("skills");
    let settings = load_settings();
    let wanted: Vec<(OsString, PathBuf)> = library()
        .into_iter()
        .filter(|s| is_enabled(&settings, ai, s))
        .map(|s| (OsString::from(&s.folder), s.path))
        .collect();
    mirror_skill_list(&wanted, &[on, off], &target);
}

fn apply_all(settings: &SkillSettings) {
    apply_claude(settings);
    apply_engine("codex");
    apply_engine("gemini");
    apply_engine("copilot");
}

#[derive(Serialize)]
pub struct LibrarySkill {
    folder: String,
    name: String,
    description: String,
    /// The group the user chose, if any (the app falls back to the
    /// installer's categories).
    group: Option<String>,
    /// Roughly what it adds to every request, in tokens.
    tokens: u32,
    /// Assistant → on.
    enabled: HashMap<String, bool>,
}

#[tauri::command]
pub async fn skills_library() -> Result<Vec<LibrarySkill>, String> {
    let settings = load_settings();
    Ok(library()
        .into_iter()
        .map(|skill| {
            let content = ["SKILL.md", "skill.md"]
                .iter()
                .find_map(|f| std::fs::read_to_string(skill.path.join(f)).ok())
                .unwrap_or_default();
            let (name, description) = frontmatter(&content);
            let name = name.unwrap_or_else(|| skill.folder.clone());
            let description = description.unwrap_or_default();
            let tokens = ((name.len() + description.len() + 40) / 4) as u32;
            let enabled = AIS
                .iter()
                .map(|ai| (ai.to_string(), is_enabled(&settings, ai, &skill)))
                .collect();
            LibrarySkill {
                group: settings.groups.get(&skill.folder).cloned(),
                folder: skill.folder,
                name,
                description,
                tokens,
                enabled,
            }
        })
        .collect())
}

#[derive(Deserialize)]
pub struct SkillToggle {
    folder: String,
    ai: String,
    enabled: bool,
}

/// Turns skills on or off for assistants, and applies it.
#[tauri::command]
pub async fn skills_set(changes: Vec<SkillToggle>) -> Result<(), String> {
    let mut settings = load_settings();
    for change in changes {
        if !AIS.contains(&change.ai.as_str()) {
            continue;
        }
        settings
            .enabled
            .entry(change.ai)
            .or_default()
            .insert(change.folder, change.enabled);
    }
    save_settings(&settings)?;
    apply_all(&settings);
    Ok(())
}

/// Puts skills in a group of the user's (None: back to their category).
#[tauri::command]
pub async fn skills_set_group(folders: Vec<String>, group: Option<String>) -> Result<(), String> {
    let mut settings = load_settings();
    for folder in folders {
        match group.as_deref().map(str::trim).filter(|g| !g.is_empty()) {
            Some(g) => {
                settings.groups.insert(folder, g.to_string());
            }
            None => {
                settings.groups.remove(&folder);
            }
        }
    }
    save_settings(&settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_description_every_request_carries() {
        let md = "---\nname: stats\ndescription: >\n  Statistics for\n  papers.\nlicense: MIT\n---\n# Stats\n";
        assert_eq!(
            frontmatter(md),
            (Some("stats".into()), Some("Statistics for papers.".into()))
        );
        let quoted = "---\nname: x\ndescription: \"One line.\"\n---\n";
        assert_eq!(frontmatter(quoted).1.as_deref(), Some("One line."));
        assert_eq!(frontmatter("# No frontmatter"), (None, None));
    }

    #[test]
    fn others_follow_claude_until_set() {
        let skill = LibSkill {
            folder: "stats".into(),
            path: PathBuf::from("/x/stats"),
            in_claude: false,
        };
        let mut settings = SkillSettings::default();
        assert!(!is_enabled(&settings, "claude", &skill));
        assert!(!is_enabled(&settings, "gemini", &skill));
        settings
            .enabled
            .entry("gemini".into())
            .or_default()
            .insert("stats".into(), true);
        assert!(is_enabled(&settings, "gemini", &skill));
        assert!(!is_enabled(&settings, "codex", &skill));
    }

    #[test]
    fn mirrors_exactly_what_is_wanted() {
        let root = std::env::temp_dir().join(format!("l4a-mirror-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let on = root.join("skills");
        let off = root.join("skills-disabled");
        let target = root.join("codex");
        for dir in [on.join("a"), off.join("b")] {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("SKILL.md"), "---\nname: s\n---").unwrap();
        }
        std::fs::create_dir_all(target.join("mine")).unwrap();
        let ours = [on.clone(), off.clone()];

        let both = vec![
            (OsString::from("a"), on.join("a")),
            (OsString::from("b"), off.join("b")),
        ];
        mirror_skill_list(&both, &ours, &target);
        assert!(target.join("a").join("SKILL.md").exists());
        assert!(target.join("b").join("SKILL.md").exists());

        // "a" off for this one; "b" moved (turned on for Claude): re-linked.
        std::fs::create_dir_all(&on).unwrap();
        std::fs::rename(off.join("b"), on.join("b")).unwrap();
        mirror_skill_list(&[(OsString::from("b"), on.join("b"))], &ours, &target);
        assert!(std::fs::symlink_metadata(target.join("a")).is_err());
        assert!(target.join("b").join("SKILL.md").exists());
        assert!(target.join("mine").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
