use git2::{DiffOptions, IndexAddOption, Oid, Repository, RepositoryInitOptions, Signature, Sort};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ─── Types ───

#[derive(Serialize, Clone)]
pub struct SnapshotInfo {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
    pub labels: Vec<String>,
    pub changed_files: Vec<String>,
}

#[derive(Serialize)]
pub struct FileDiff {
    pub file_path: String,
    pub status: String, // "added" | "modified" | "deleted"
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

// ─── Helpers ───

/// Where a project's history was kept before: in the project itself. A
/// project in a Seafile or Dropbox folder had it synced to every computer,
/// where each wrote to it and set the other's aside as broken
/// (`history.git.broken-…`), and the restore points were lost.
fn legacy_history_path(project_root: &str) -> PathBuf {
    Path::new(project_root)
        .join(".latex4all")
        .join("history.git")
}

#[cfg(not(test))]
fn history_base() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("Latex4All").join("history"))
}

#[cfg(test)]
thread_local! {
    /// Tests choose where history goes; none keeps it in the project.
    static TEST_BASE: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn history_base() -> Option<PathBuf> {
    TEST_BASE.with(|b| b.borrow().clone())
}

/// Where a project's history is kept: with the app, one per project folder
/// on this computer (`…/Latex4All/history/<id>`), like its builds. Each
/// computer keeps its own; a cloud app never carries it.
pub(crate) fn history_path(project_root: &str) -> PathBuf {
    let root = PathBuf::from(project_root.trim_end_matches(['/', '\\']));
    let Some(base) = history_base() else {
        return legacy_history_path(project_root);
    };
    let canonical = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    let digest = ring::digest::digest(
        &ring::digest::SHA256,
        canonical.to_string_lossy().as_bytes(),
    );
    let id: String = digest.as_ref()[..12]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    base.join(id)
}

/// Copies every file under `from` into `to`.
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// The history kept in the project by earlier versions, copied to where
/// history is kept now, if it's this project's and works. The copy in the
/// project stays as it was (another computer may still use it).
fn adopt_legacy(project_root: &str, git_dir: &Path) -> bool {
    let legacy = legacy_history_path(project_root);
    if legacy == git_dir || !legacy.exists() {
        return false;
    }
    let Ok(old) = Repository::open(&legacy) else {
        return false;
    };
    if !repo_points_here(&old, project_root) || old.head().is_err() {
        return false;
    }
    let from = old.path().to_path_buf();
    drop(old);
    // Copied beside it first, then put in place: cut short (the app quit,
    // a slow disk), it's never taken for the history.
    let partial = git_dir.with_extension("copying");
    let _ = fs::remove_dir_all(&partial);
    if copy_dir(&from, &partial).is_err() || fs::rename(&partial, git_dir).is_err() {
        let _ = fs::remove_dir_all(&partial);
        return false;
    }
    match Repository::open(git_dir) {
        Ok(repo) => {
            if let Ok(mut config) = repo.config() {
                let _ = config.set_str("core.worktree", project_root);
            }
            true
        }
        Err(_) => {
            let _ = fs::remove_dir_all(git_dir);
            false
        }
    }
}

/// libgit2 leaves a `.git` file in the project pointing at the history;
/// nothing needs it, and a cloud app carried it to computers where it points
/// nowhere. Only ours goes: a `.git` of the person's own is never touched.
fn drop_pointer(project_root: &str) {
    let pointer = Path::new(project_root).join(".git");
    if !pointer.is_file() {
        return;
    }
    let Ok(text) = fs::read_to_string(&pointer) else {
        return;
    };
    let Some(target) = text.trim().strip_prefix("gitdir:") else {
        return;
    };
    let target = target.trim().replace('\\', "/");
    if target.contains("/.latex4all/history.git") || target.contains("/Latex4All/history/") {
        let _ = fs::remove_file(pointer);
    }
}

/// Whether a history repo's working folder is this project (one made on
/// another computer has that computer's path).
fn repo_points_here(repo: &Repository, project_root: &str) -> bool {
    let Some(workdir) = repo.workdir() else {
        return false;
    };
    match (
        workdir.canonicalize(),
        Path::new(project_root).canonicalize(),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Moves a broken history repo out of the way, keeping it in case.
fn set_aside(git_dir: &Path) -> Result<(), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = git_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "history.git".into());
    let aside = git_dir.with_file_name(format!("{name}.broken-{stamp}"));
    fs::rename(git_dir, &aside).map_err(|e| format!("Couldn't set the broken history aside: {}", e))
}

fn open_repo(project_root: &str) -> Result<Repository, String> {
    let git_dir = history_path(project_root);
    Repository::open(&git_dir).map_err(|e| format!("Failed to open history repo: {}", e))
}

fn default_signature() -> Result<Signature<'static>, String> {
    Signature::now("Latex4All", "history@latex4all.local")
        .map_err(|e| format!("Failed to create signature: {}", e))
}

/// Build a map of tag name → commit OID for quick label lookup
fn tag_map(repo: &Repository) -> HashMap<Oid, Vec<String>> {
    let mut map: HashMap<Oid, Vec<String>> = HashMap::new();
    if let Ok(tags) = repo.tag_names(None) {
        for tag_name in tags.iter().flatten() {
            if let Ok(reference) = repo.revparse_single(tag_name) {
                let oid = reference
                    .peel_to_commit()
                    .map(|c| c.id())
                    .unwrap_or(reference.id());
                map.entry(oid).or_default().push(tag_name.to_string());
            }
        }
    }
    map
}

fn ensure_excludes(project_root: &str, repo: &Repository) {
    let excludes_path = Path::new(project_root)
        .join(".latex4all")
        .join("history-exclude");
    let content = r#"# LaTeX build artifacts
*.aux
*.log
*.out
*.toc
*.lof
*.lot
*.fls
*.fdb_latexmk
*.synctex.gz
*.bbl
*.blg
*.nav
*.snm
*.vrb
*.bcf
*.run.xml

# Output
*.pdf

# OS files
.DS_Store
Thumbs.db

# Git
.git/

# Latex4All internal
.latex4all/
.prism/
"#;
    if !excludes_path.exists() {
        let _ = fs::write(&excludes_path, content);
    } else {
        // Migrate: add .prism/ if missing from existing excludes file
        if let Ok(existing) = fs::read_to_string(&excludes_path) {
            if !existing.contains(".prism/") {
                let _ = fs::write(&excludes_path, content);
            }
        }
    }
    // Configure the repo to use this excludes file
    if let Ok(mut config) = repo.config() {
        let _ = config.set_str("core.excludesFile", &excludes_path.to_string_lossy());
    }
}

// ─── Tauri Commands ───

pub fn history_init(project_root: String) -> Result<(), String> {
    let git_dir = history_path(&project_root);

    if git_dir.exists() {
        // Already initialized — verify and ensure excludes
        match Repository::open(&git_dir) {
            Ok(repo) if repo_points_here(&repo, &project_root) => {
                ensure_excludes(&project_root, &repo);
                drop_pointer(&project_root);
                return Ok(());
            }
            // Unusable: a sync service copied the folder without its
            // contents, or brought one made on another computer that points
            // at that computer's paths (D:/…). Set aside, not deleted, and
            // history starts again here.
            _ => set_aside(&git_dir)?,
        }
    }

    // The history an earlier version kept in the project, carried over.
    if adopt_legacy(&project_root, &git_dir) {
        if let Ok(repo) = Repository::open(&git_dir) {
            ensure_excludes(&project_root, &repo);
        }
        drop_pointer(&project_root);
        return Ok(());
    }

    // Create .latex4all/ dir (for the excludes file)
    let latex4all_dir = Path::new(&project_root).join(".latex4all");
    fs::create_dir_all(&latex4all_dir)
        .map_err(|e| format!("Failed to create .latex4all dir: {}", e))?;
    if let Some(parent) = git_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create the history folder: {}", e))?;
    }

    let repo = if git_dir != legacy_history_path(&project_root) {
        // Kept apart from the project: made bare, then given the project as
        // its working folder, so nothing is written into the project (a
        // `.git` pointer would replace one of the person's own).
        let mut opts = RepositoryInitOptions::new();
        opts.bare(true);
        opts.no_reinit(true);
        let repo = Repository::init_opts(&git_dir, &opts)
            .map_err(|e| format!("Failed to init history repo: {}", e))?;
        let mut config = repo.config().map_err(|e| e.to_string())?;
        config
            .set_bool("core.bare", false)
            .map_err(|e| e.to_string())?;
        config
            .set_str("core.worktree", &project_root)
            .map_err(|e| e.to_string())?;
        drop(config);
        drop(repo);
        Repository::open(&git_dir).map_err(|e| format!("Failed to open history repo: {}", e))?
    } else {
        // Init a repo in the project with workdir pointing to project root
        let mut opts = RepositoryInitOptions::new();
        opts.bare(false);
        opts.workdir_path(Path::new(&project_root));
        opts.no_reinit(true);
        Repository::init_opts(&git_dir, &opts)
            .map_err(|e| format!("Failed to init history repo: {}", e))?
    };

    // Set up excludes file
    ensure_excludes(&project_root, &repo);

    // Create initial commit with all project files
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    // Add all files (respecting .gitignore)
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Failed to add files: {}", e))?;
    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let sig = default_signature()?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "[init] Project opened",
        &tree,
        &[],
    )
    .map_err(|e| format!("Failed to create initial commit: {}", e))?;

    Ok(())
}

/// Where the project's history is, for carrying it when the folder moves
/// (asked before the move: the key comes from the folder as it is).
pub fn history_location(project_root: String) -> String {
    history_path(&project_root).to_string_lossy().into_owned()
}

/// The project's folder moved or was renamed: its history, at `from` (see
/// `history_location`), goes with it, pointed at the new folder.
pub fn history_relocate(from: String, project_root: String) -> Result<(), String> {
    let from = PathBuf::from(from);
    let to = history_path(&project_root);
    if from == to || !from.exists() {
        return Ok(());
    }
    if to.exists() {
        set_aside(&to)?;
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| format!("Couldn't move the history: {}", e))?;
    // Set in its config file directly: opened, the repo would look for the
    // old folder and fail.
    let mut config = git2::Config::open(&to.join("config")).map_err(|e| e.to_string())?;
    config
        .set_str("core.worktree", &project_root)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn history_snapshot(
    project_root: String,
    message: String,
) -> Result<Option<SnapshotInfo>, String> {
    let repo = open_repo(&project_root)?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    // Stage all changes
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Failed to add files: {}", e))?;

    // Remove deleted files from index
    let workdir = repo.workdir().ok_or("No workdir")?;
    let entries: Vec<_> = index.iter().map(|e| e.path.clone()).collect();
    for path_bytes in &entries {
        let path_str = String::from_utf8_lossy(path_bytes);
        let full_path = workdir.join(path_str.as_ref());
        if !full_path.exists() {
            let _ = index.remove_path(Path::new(path_str.as_ref()));
        }
    }

    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;

    // Check if there are actual changes vs HEAD
    if let Ok(head) = repo.head() {
        if let Ok(head_commit) = head.peel_to_commit() {
            if head_commit.tree().map(|t| t.id()).unwrap_or(Oid::zero()) == tree_oid {
                // No changes — skip snapshot
                return Ok(None);
            }
        }
    }

    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let sig = default_signature()?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| format!("Failed to create commit: {}", e))?;

    // Collect changed file paths
    let changed_files = if let Some(parent_commit) = parent.as_ref() {
        let parent_tree = parent_commit.tree().ok();
        repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
            .map(|d| {
                d.deltas()
                    .filter_map(|delta| {
                        delta
                            .new_file()
                            .path()
                            .or_else(|| delta.old_file().path())
                            .map(|p| p.to_string_lossy().to_string())
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    Ok(Some(SnapshotInfo {
        id: oid.to_string(),
        message,
        timestamp: chrono::Utc::now().timestamp(),
        labels: vec![],
        changed_files,
    }))
}

pub fn history_list(
    project_root: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<SnapshotInfo>, String> {
    let repo = open_repo(&project_root)?;
    let tags = tag_map(&repo);

    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Failed to create revwalk: {}", e))?;
    revwalk
        .push_head()
        .map_err(|e| format!("Failed to push HEAD: {}", e))?;
    revwalk
        .set_sorting(Sort::TIME)
        .map_err(|e| format!("Sort error: {}", e))?;

    let mut snapshots = Vec::new();
    let mut count = 0u32;

    for oid_result in revwalk {
        let oid = oid_result.map_err(|e| format!("Revwalk error: {}", e))?;

        if count < offset {
            count += 1;
            continue;
        }
        if snapshots.len() >= limit as usize {
            break;
        }

        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Failed to find commit: {}", e))?;

        let message = commit.message().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();
        let labels = tags.get(&oid).cloned().unwrap_or_default();

        // Collect changed file paths (vs parent)
        let changed_files = if let Some(parent) = commit.parents().next() {
            let old_tree = parent.tree().ok();
            let new_tree = commit.tree().ok();
            repo.diff_tree_to_tree(old_tree.as_ref(), new_tree.as_ref(), None)
                .map(|d| {
                    d.deltas()
                        .filter_map(|delta| {
                            delta
                                .new_file()
                                .path()
                                .or_else(|| delta.old_file().path())
                                .map(|p| p.to_string_lossy().to_string())
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        } else {
            vec![]
        };

        snapshots.push(SnapshotInfo {
            id: oid.to_string(),
            message,
            timestamp,
            labels,
            changed_files,
        });

        count += 1;
    }

    Ok(snapshots)
}

pub fn history_diff(
    project_root: String,
    from_id: String,
    to_id: String,
) -> Result<Vec<FileDiff>, String> {
    let repo = open_repo(&project_root)?;

    let from_oid = Oid::from_str(&from_id).map_err(|e| format!("Invalid from_id: {}", e))?;
    let to_oid = Oid::from_str(&to_id).map_err(|e| format!("Invalid to_id: {}", e))?;

    let from_commit = repo
        .find_commit(from_oid)
        .map_err(|e| format!("Commit not found: {}", e))?;
    let to_commit = repo
        .find_commit(to_oid)
        .map_err(|e| format!("Commit not found: {}", e))?;

    let from_tree = from_commit
        .tree()
        .map_err(|e| format!("Tree error: {}", e))?;
    let to_tree = to_commit.tree().map_err(|e| format!("Tree error: {}", e))?;

    let mut diff_opts = DiffOptions::new();
    let diff = repo
        .diff_tree_to_tree(Some(&from_tree), Some(&to_tree), Some(&mut diff_opts))
        .map_err(|e| format!("Diff error: {}", e))?;

    let mut results = Vec::new();

    for delta in diff.deltas() {
        let file_path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            _ => "modified",
        }
        .to_string();

        let old_content = if delta.status() != git2::Delta::Added {
            let old_blob = repo.find_blob(delta.old_file().id()).ok();
            old_blob.and_then(|b| {
                if b.is_binary() {
                    None
                } else {
                    Some(String::from_utf8_lossy(b.content()).to_string())
                }
            })
        } else {
            None
        };

        let new_content = if delta.status() != git2::Delta::Deleted {
            let new_blob = repo.find_blob(delta.new_file().id()).ok();
            new_blob.and_then(|b| {
                if b.is_binary() {
                    None
                } else {
                    Some(String::from_utf8_lossy(b.content()).to_string())
                }
            })
        } else {
            None
        };

        results.push(FileDiff {
            file_path,
            status,
            old_content,
            new_content,
        });
    }

    Ok(results)
}

pub fn history_file_at(
    project_root: String,
    snapshot_id: String,
    file_path: String,
) -> Result<String, String> {
    let repo = open_repo(&project_root)?;
    let oid = Oid::from_str(&snapshot_id).map_err(|e| format!("Invalid snapshot_id: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;
    let tree = commit.tree().map_err(|e| format!("Tree error: {}", e))?;
    let entry = tree
        .get_path(Path::new(&file_path))
        .map_err(|e| format!("File not found in snapshot: {}", e))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Blob error: {}", e))?;

    if blob.is_binary() {
        return Err("Binary file".into());
    }

    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

pub fn history_restore(project_root: String, snapshot_id: String) -> Result<SnapshotInfo, String> {
    let repo = open_repo(&project_root)?;
    let oid = Oid::from_str(&snapshot_id).map_err(|e| format!("Invalid snapshot_id: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;
    let tree = commit.tree().map_err(|e| format!("Tree error: {}", e))?;

    // Checkout the tree to working directory
    repo.checkout_tree(
        tree.as_object(),
        Some(git2::build::CheckoutBuilder::new().force()),
    )
    .map_err(|e| format!("Checkout failed: {}", e))?;

    // Create a new "restore" commit on HEAD (not moving HEAD to old commit)
    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Add error: {}", e))?;
    index.write().map_err(|e| format!("Write error: {}", e))?;

    let new_tree_oid = index
        .write_tree()
        .map_err(|e| format!("Write tree error: {}", e))?;
    let new_tree = repo
        .find_tree(new_tree_oid)
        .map_err(|e| format!("Find tree error: {}", e))?;

    let sig = default_signature()?;
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = head_commit.iter().collect();

    let short_id = &snapshot_id[..8.min(snapshot_id.len())];
    let msg = format!("[restore] Restored to {}", short_id);
    let new_oid = repo
        .commit(Some("HEAD"), &sig, &sig, &msg, &new_tree, &parents)
        .map_err(|e| format!("Commit error: {}", e))?;

    Ok(SnapshotInfo {
        id: new_oid.to_string(),
        message: msg,
        timestamp: chrono::Utc::now().timestamp(),
        labels: vec![],
        changed_files: vec![],
    })
}

pub fn history_add_label(
    project_root: String,
    snapshot_id: String,
    label: String,
) -> Result<(), String> {
    let repo = open_repo(&project_root)?;
    let oid = Oid::from_str(&snapshot_id).map_err(|e| format!("Invalid snapshot_id: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;

    repo.tag_lightweight(&label, commit.as_object(), false)
        .map_err(|e| format!("Failed to create label: {}", e))?;

    Ok(())
}

pub fn history_remove_label(project_root: String, label: String) -> Result<(), String> {
    let repo = open_repo(&project_root)?;
    let tag_ref = format!("refs/tags/{}", label);
    repo.find_reference(&tag_ref)
        .map_err(|e| format!("Label not found: {}", e))?
        .delete()
        .map_err(|e| format!("Failed to delete label: {}", e))?;
    Ok(())
}


/// The commands, each run on a worker thread: run on the main thread (as
/// plain commands are), a slow one (the first copy of a long history on
/// Windows, a snapshot of a large project) froze the whole window, which
/// then couldn't even be closed.
pub mod commands {
    use super::*;

    /// One at a time, as on the main thread: a snapshot never runs while
    /// the history is still being made or copied.
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());

    async fn off_main<T: Send + 'static>(
        work: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
            work()
        })
        .await
        .map_err(|e| format!("History task failed: {e}"))?
    }

    #[tauri::command]
    pub async fn history_init(project_root: String) -> Result<(), String> {
        off_main(move || super::history_init(project_root)).await
    }

    #[tauri::command]
    pub async fn history_location(project_root: String) -> Result<String, String> {
        off_main(move || Ok(super::history_location(project_root))).await
    }

    #[tauri::command]
    pub async fn history_relocate(from: String, project_root: String) -> Result<(), String> {
        off_main(move || super::history_relocate(from, project_root)).await
    }

    #[tauri::command]
    pub async fn history_snapshot(project_root: String, message: String) -> Result<Option<SnapshotInfo>, String> {
        off_main(move || super::history_snapshot(project_root, message)).await
    }

    #[tauri::command]
    pub async fn history_list(project_root: String, limit: u32, offset: u32) -> Result<Vec<SnapshotInfo>, String> {
        off_main(move || super::history_list(project_root, limit, offset)).await
    }

    #[tauri::command]
    pub async fn history_diff(project_root: String, from_id: String, to_id: String) -> Result<Vec<FileDiff>, String> {
        off_main(move || super::history_diff(project_root, from_id, to_id)).await
    }

    #[tauri::command]
    pub async fn history_file_at(project_root: String, snapshot_id: String, file_path: String) -> Result<String, String> {
        off_main(move || super::history_file_at(project_root, snapshot_id, file_path)).await
    }

    #[tauri::command]
    pub async fn history_restore(project_root: String, snapshot_id: String) -> Result<SnapshotInfo, String> {
        off_main(move || super::history_restore(project_root, snapshot_id)).await
    }

    #[tauri::command]
    pub async fn history_add_label(project_root: String, snapshot_id: String, label: String) -> Result<(), String> {
        off_main(move || super::history_add_label(project_root, snapshot_id, label)).await
    }

    #[tauri::command]
    pub async fn history_remove_label(project_root: String, label: String) -> Result<(), String> {
        off_main(move || super::history_remove_label(project_root, label)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create a temp project dir with the given files.
    fn setup_project(files: &[(&str, &str)]) -> TempDir {
        let dir = TempDir::new().unwrap();
        for (name, content) in files {
            let path = dir.path().join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, content).unwrap();
        }
        dir
    }

    fn root(dir: &TempDir) -> String {
        dir.path().to_string_lossy().to_string()
    }

    // ─── history_init ───

    #[test]
    fn test_history_init_creates_repo() {
        let dir = setup_project(&[("main.tex", "\\documentclass{article}")]);
        history_init(root(&dir)).unwrap();

        let git_dir = dir.path().join(".latex4all").join("history.git");
        assert!(git_dir.exists(), "history.git should be created");

        // Should have an initial commit
        let repo = Repository::open(&git_dir).unwrap();
        let head = repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();
        assert!(commit.message().unwrap().contains("[init]"));
    }

    #[test]
    fn test_history_init_sets_aside_an_empty_repo_folder() {
        // What a sync service leaves: the folder, without its contents.
        let dir = setup_project(&[("main.tex", "hello")]);
        fs::create_dir_all(dir.path().join(".latex4all").join("history.git")).unwrap();
        history_init(root(&dir)).unwrap();
        let repo = Repository::open(dir.path().join(".latex4all").join("history.git")).unwrap();
        assert!(repo.head().is_ok());
        let aside = fs::read_dir(dir.path().join(".latex4all"))
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("history.git.broken-")
            });
        assert!(aside, "the broken one is kept aside");
    }

    #[test]
    fn test_history_init_sets_aside_a_repo_from_another_computer() {
        // Made for another folder (on Windows, D:/…): its working folder isn't this one.
        let elsewhere = setup_project(&[("main.tex", "elsewhere")]);
        history_init(root(&elsewhere)).unwrap();
        let dir = setup_project(&[("main.tex", "here")]);
        fs::create_dir_all(dir.path().join(".latex4all")).unwrap();
        fs::rename(
            elsewhere.path().join(".latex4all").join("history.git"),
            dir.path().join(".latex4all").join("history.git"),
        )
        .unwrap();
        history_init(root(&dir)).unwrap();
        let repo = Repository::open(dir.path().join(".latex4all").join("history.git")).unwrap();
        assert_eq!(
            repo.workdir().unwrap().canonicalize().unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn test_history_init_idempotent() {
        let dir = setup_project(&[("main.tex", "hello")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();
        // Second call should succeed without error
        history_init(r).unwrap();
    }

    #[test]
    fn test_history_init_creates_excludes() {
        let dir = setup_project(&[("main.tex", "doc")]);
        history_init(root(&dir)).unwrap();

        let excludes = dir.path().join(".latex4all").join("history-exclude");
        assert!(excludes.exists());
        let content = fs::read_to_string(&excludes).unwrap();
        assert!(content.contains("*.aux"));
        assert!(content.contains(".latex4all/"));
        assert!(content.contains(".prism/"));
    }

    // ─── history_snapshot ───

    #[test]
    fn test_history_snapshot_after_modification() {
        let dir = setup_project(&[("main.tex", "v1")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        // Modify a file
        fs::write(dir.path().join("main.tex"), "v2").unwrap();

        let result = history_snapshot(r, "edited main.tex".into()).unwrap();
        assert!(result.is_some());
        let snap = result.unwrap();
        assert_eq!(snap.message, "edited main.tex");
        assert!(snap.changed_files.contains(&"main.tex".to_string()));
    }

    #[test]
    fn test_history_snapshot_no_change_returns_none() {
        let dir = setup_project(&[("main.tex", "same")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        // No modification → None
        let result = history_snapshot(r, "no-op".into()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_history_snapshot_detects_new_file() {
        let dir = setup_project(&[("main.tex", "doc")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        // Add a new file
        fs::write(dir.path().join("chapter1.tex"), "new chapter").unwrap();

        let snap = history_snapshot(r, "add chapter".into()).unwrap().unwrap();
        assert!(snap.changed_files.contains(&"chapter1.tex".to_string()));
    }

    // ─── history_list ───

    #[test]
    fn test_history_list_after_snapshots() {
        let dir = setup_project(&[("main.tex", "v1")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        fs::write(dir.path().join("main.tex"), "v2").unwrap();
        history_snapshot(r.clone(), "snap 1".into()).unwrap();

        fs::write(dir.path().join("main.tex"), "v3").unwrap();
        history_snapshot(r.clone(), "snap 2".into()).unwrap();

        let list = history_list(r, 10, 0).unwrap();
        assert_eq!(list.len(), 3); // init + 2 snapshots
        let msgs: Vec<&str> = list.iter().map(|s| s.message.as_str()).collect();
        assert!(msgs.contains(&"snap 1"));
        assert!(msgs.contains(&"snap 2"));
        assert!(msgs.iter().any(|m| m.contains("[init]")));
    }

    #[test]
    fn test_history_list_pagination() {
        let dir = setup_project(&[("a.tex", "x")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        fs::write(dir.path().join("a.tex"), "y").unwrap();
        history_snapshot(r.clone(), "s1".into()).unwrap();

        fs::write(dir.path().join("a.tex"), "z").unwrap();
        history_snapshot(r.clone(), "s2".into()).unwrap();

        // limit=1 → returns exactly 1 entry
        let page1 = history_list(r.clone(), 1, 0).unwrap();
        assert_eq!(page1.len(), 1);

        // offset=1 → returns a different entry
        let page2 = history_list(r.clone(), 1, 1).unwrap();
        assert_eq!(page2.len(), 1);
        assert_ne!(page1[0].id, page2[0].id);

        // All 3 entries accessible
        let all = history_list(r, 10, 0).unwrap();
        assert_eq!(all.len(), 3);
    }

    // ─── history_diff ───

    #[test]
    fn test_history_diff_shows_changes() {
        let dir = setup_project(&[("main.tex", "old content")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        fs::write(dir.path().join("main.tex"), "new content").unwrap();
        let snap = history_snapshot(r.clone(), "update".into())
            .unwrap()
            .unwrap();

        let list = history_list(r.clone(), 10, 0).unwrap();
        let from_id = list[1].id.clone(); // init
        let to_id = snap.id.clone();

        let diffs = history_diff(r, from_id, to_id).unwrap();
        assert!(!diffs.is_empty());
        let d = diffs.iter().find(|d| d.file_path == "main.tex").unwrap();
        assert_eq!(d.status, "modified");
        assert_eq!(d.old_content.as_deref(), Some("old content"));
        assert_eq!(d.new_content.as_deref(), Some("new content"));
    }

    #[test]
    fn test_history_diff_added_file() {
        let dir = setup_project(&[("a.tex", "a")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        fs::write(dir.path().join("b.tex"), "new file").unwrap();
        let snap = history_snapshot(r.clone(), "add b".into())
            .unwrap()
            .unwrap();

        let list = history_list(r.clone(), 10, 0).unwrap();
        let from_id = list[1].id.clone(); // init
        let to_id = snap.id;

        let diffs = history_diff(r, from_id, to_id).unwrap();
        let d = diffs.iter().find(|d| d.file_path == "b.tex").unwrap();
        assert_eq!(d.status, "added");
        assert!(d.old_content.is_none());
        assert_eq!(d.new_content.as_deref(), Some("new file"));
    }

    // ─── history_file_at ───

    #[test]
    fn test_history_file_at_returns_content() {
        let dir = setup_project(&[("main.tex", "version one")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let init_id = list[0].id.clone();

        let content = history_file_at(r, init_id, "main.tex".into()).unwrap();
        assert_eq!(content, "version one");
    }

    #[test]
    fn test_history_file_at_nonexistent_file_errors() {
        let dir = setup_project(&[("main.tex", "x")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let id = list[0].id.clone();

        let result = history_file_at(r, id, "nonexistent.tex".into());
        assert!(result.is_err());
    }

    // ─── history_restore ───

    #[test]
    fn test_history_restore_reverts_content() {
        let dir = setup_project(&[("main.tex", "original")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let init_id = list[0].id.clone();

        // Modify
        fs::write(dir.path().join("main.tex"), "modified").unwrap();
        history_snapshot(r.clone(), "modify".into()).unwrap();

        // Restore to init
        let restore_info = history_restore(r.clone(), init_id).unwrap();
        assert!(restore_info.message.contains("[restore]"));

        // Working directory should have original content
        let content = fs::read_to_string(dir.path().join("main.tex")).unwrap();
        assert_eq!(content, "original");
    }

    // ─── labels ───

    #[test]
    fn test_history_add_and_remove_label() {
        let dir = setup_project(&[("main.tex", "doc")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let id = list[0].id.clone();

        // Add label
        history_add_label(r.clone(), id.clone(), "v1.0".into()).unwrap();

        // Verify label appears in list
        let list = history_list(r.clone(), 1, 0).unwrap();
        assert!(list[0].labels.contains(&"v1.0".to_string()));

        // Remove label
        history_remove_label(r.clone(), "v1.0".into()).unwrap();

        // Verify label gone
        let list = history_list(r.clone(), 1, 0).unwrap();
        assert!(!list[0].labels.contains(&"v1.0".to_string()));
    }

    #[test]
    fn test_history_remove_nonexistent_label_errors() {
        let dir = setup_project(&[("main.tex", "x")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let result = history_remove_label(r, "nope".into());
        assert!(result.is_err());
    }

    // ─── tag_map ───

    #[test]
    fn test_tag_map_groups_by_oid() {
        let dir = setup_project(&[("main.tex", "x")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let id = list[0].id.clone();

        history_add_label(r.clone(), id.clone(), "alpha".into()).unwrap();
        history_add_label(r.clone(), id.clone(), "beta".into()).unwrap();

        let repo = open_repo(&r).unwrap();
        let map = tag_map(&repo);
        let oid = Oid::from_str(&id).unwrap();
        let labels = map.get(&oid).unwrap();
        assert!(labels.contains(&"alpha".to_string()));
        assert!(labels.contains(&"beta".to_string()));
    }

    // ─── ensure_excludes ───

    #[test]
    fn test_ensure_excludes_migrates_missing_prism() {
        let dir = setup_project(&[("main.tex", "x")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        // Write an excludes file WITHOUT .prism/
        let excludes_path = dir.path().join(".latex4all").join("history-exclude");
        fs::write(&excludes_path, "*.aux\n*.log\n.latex4all/\n").unwrap();

        let repo = open_repo(&r).unwrap();
        ensure_excludes(&r, &repo);

        let content = fs::read_to_string(&excludes_path).unwrap();
        assert!(
            content.contains(".prism/"),
            "should migrate to include .prism/"
        );
    }

    // ─── edge cases ───

    #[test]
    fn test_history_snapshot_deleted_file() {
        let dir = setup_project(&[("a.tex", "aaa"), ("b.tex", "bbb")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        // Delete a file
        fs::remove_file(dir.path().join("b.tex")).unwrap();

        let snap = history_snapshot(r.clone(), "delete b".into())
            .unwrap()
            .unwrap();
        assert!(!snap.changed_files.is_empty());
    }

    #[test]
    fn test_history_diff_deleted_file() {
        let dir = setup_project(&[("a.tex", "keep"), ("b.tex", "remove me")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let init_id = list[0].id.clone();

        fs::remove_file(dir.path().join("b.tex")).unwrap();
        let snap = history_snapshot(r.clone(), "delete b".into())
            .unwrap()
            .unwrap();

        let diffs = history_diff(r, init_id, snap.id).unwrap();
        let d = diffs.iter().find(|d| d.file_path == "b.tex").unwrap();
        assert_eq!(d.status, "deleted");
        assert_eq!(d.old_content.as_deref(), Some("remove me"));
        assert!(d.new_content.is_none());
    }

    #[test]
    fn test_history_diff_nonadjacent_snapshots() {
        let dir = setup_project(&[("a.tex", "v1")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list0 = history_list(r.clone(), 1, 0).unwrap();
        let init_id = list0[0].id.clone();

        fs::write(dir.path().join("a.tex"), "v2").unwrap();
        history_snapshot(r.clone(), "s1".into()).unwrap();

        fs::write(dir.path().join("a.tex"), "v3").unwrap();
        let snap3 = history_snapshot(r.clone(), "s2".into()).unwrap().unwrap();

        // Diff from init directly to s2 (skipping s1)
        let diffs = history_diff(r, init_id, snap3.id).unwrap();
        let d = diffs.iter().find(|d| d.file_path == "a.tex").unwrap();
        assert_eq!(d.old_content.as_deref(), Some("v1"));
        assert_eq!(d.new_content.as_deref(), Some("v3"));
    }

    #[test]
    fn test_history_add_duplicate_label_errors() {
        let dir = setup_project(&[("main.tex", "x")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let list = history_list(r.clone(), 1, 0).unwrap();
        let id = list[0].id.clone();

        history_add_label(r.clone(), id.clone(), "dup".into()).unwrap();
        // Adding same label again should error
        let result = history_add_label(r, id, "dup".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_history_restore_creates_restore_commit() {
        let dir = setup_project(&[("main.tex", "original")]);
        let r = root(&dir);
        history_init(r.clone()).unwrap();

        let init_list = history_list(r.clone(), 1, 0).unwrap();
        let init_id = init_list[0].id.clone();

        fs::write(dir.path().join("main.tex"), "changed").unwrap();
        history_snapshot(r.clone(), "change".into()).unwrap();

        history_restore(r.clone(), init_id).unwrap();

        // Should now have 4 entries: init, change, restore
        let list = history_list(r, 10, 0).unwrap();
        assert_eq!(list.len(), 3);
        assert!(list.iter().any(|s| s.message.contains("[restore]")));
    }

    // ─── Kept with the app ───

    /// History kept in `base` for the rest of this test (as the app does).
    fn keep_in(base: &TempDir) {
        TEST_BASE.with(|b| *b.borrow_mut() = Some(base.path().to_path_buf()));
    }

    #[test]
    fn test_history_kept_with_the_app_not_in_the_project() {
        let base = TempDir::new().unwrap();
        keep_in(&base);
        let dir = setup_project(&[("main.tex", "hello")]);
        history_init(root(&dir)).unwrap();
        assert!(!dir.path().join(".latex4all").join("history.git").exists());
        assert!(
            !dir.path().join(".git").exists(),
            "no pointer left in the project"
        );
        fs::write(dir.path().join("main.tex"), "hello again").unwrap();
        assert!(history_snapshot(root(&dir), "edit".into())
            .unwrap()
            .is_some());
        assert_eq!(history_list(root(&dir), 50, 0).unwrap().len(), 2);
    }

    #[test]
    fn test_history_in_the_project_is_carried_over() {
        let dir = setup_project(&[("main.tex", "v1")]);
        history_init(root(&dir)).unwrap(); // in the project, as before
        fs::write(dir.path().join("main.tex"), "v2").unwrap();
        history_snapshot(root(&dir), "earlier".into()).unwrap();

        let base = TempDir::new().unwrap();
        keep_in(&base);
        history_init(root(&dir)).unwrap();
        let list = history_list(root(&dir), 50, 0).unwrap();
        assert_eq!(list.len(), 2, "both earlier snapshots are there");
        assert!(dir.path().join(".latex4all").join("history.git").exists());
    }

    #[test]
    fn test_history_follows_a_renamed_folder() {
        let base = TempDir::new().unwrap();
        keep_in(&base);
        let parent = TempDir::new().unwrap();
        let old = parent.path().join("Old");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("main.tex"), "text").unwrap();
        let old_root = old.to_string_lossy().to_string();
        history_init(old_root.clone()).unwrap();
        let from = history_location(old_root);
        let new = parent.path().join("New");
        fs::rename(&old, &new).unwrap();
        let new_root = new.to_string_lossy().to_string();
        history_relocate(from, new_root.clone()).unwrap();
        history_init(new_root.clone()).unwrap();
        assert_eq!(history_list(new_root, 50, 0).unwrap().len(), 1);
    }

    #[test]
    fn test_a_git_folder_of_ones_own_is_left_alone() {
        let base = TempDir::new().unwrap();
        keep_in(&base);
        let dir = setup_project(&[
            ("main.tex", "x"),
            (".git", "gitdir: /work/repo/.git/worktrees/x"),
        ]);
        history_init(root(&dir)).unwrap();
        assert!(dir.path().join(".git").exists());
    }
}
