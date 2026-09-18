//! Moving a project folder somewhere else on disk.

use std::path::Path;

/// Copies a folder and everything in it, for a move to another drive.
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Moves `old` to `new`. A rename is enough on the same drive; across drives
/// nothing can be renamed, so everything is copied first and the original is
/// only removed once it has all arrived.
pub fn move_project_folder(old: &Path, new: &Path) -> Result<(), String> {
    if !old.is_dir() {
        return Err("That project folder no longer exists.".into());
    }
    if !new.is_absolute() {
        return Err("Choose a folder to move the project into.".into());
    }
    if new.exists() {
        return Err("There is already a folder with that name there.".into());
    }
    if new.starts_with(old) {
        return Err("A project can't be moved inside itself.".into());
    }
    if let Some(parent) = new.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Couldn't reach that folder: {}", e))?;
    }
    if std::fs::rename(old, new).is_ok() {
        return Ok(());
    }
    if let Err(err) = copy_dir_all(old, new) {
        let _ = std::fs::remove_dir_all(new);
        return Err(format!("Couldn't copy the project: {}", err));
    }
    std::fs::remove_dir_all(old).map_err(|e| {
        format!(
            "The project was copied to its new place, but the old folder couldn't be removed: {}",
            e
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn project(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("move-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("figures")).unwrap();
        std::fs::create_dir_all(dir.join(".latex4all")).unwrap();
        std::fs::write(dir.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(dir.join("figures/plot.png"), [1u8, 2, 3]).unwrap();
        std::fs::write(dir.join(".latex4all/collab.json"), "{}").unwrap();
        dir
    }

    #[test]
    fn moves_everything_including_hidden_files() {
        let old = project("src");
        let new = std::env::temp_dir().join(format!("moved-{}", uuid::Uuid::new_v4()));
        move_project_folder(&old, &new).unwrap();
        assert!(!old.exists());
        assert_eq!(
            std::fs::read_to_string(new.join("main.tex")).unwrap(),
            "\\documentclass{article}"
        );
        assert_eq!(
            std::fs::read(new.join("figures/plot.png")).unwrap(),
            [1, 2, 3]
        );
        // The app's own folder travels with it, so a shared project stays shared.
        assert!(new.join(".latex4all/collab.json").exists());
        std::fs::remove_dir_all(new).unwrap();
    }

    #[test]
    fn copies_everything_before_removing_the_original() {
        // The path a move to another drive takes, where renaming isn't possible.
        let old = project("copy");
        let new = std::env::temp_dir().join(format!("copied-{}", uuid::Uuid::new_v4()));
        copy_dir_all(&old, &new).unwrap();
        assert!(old.join("main.tex").exists());
        assert!(new.join("figures/plot.png").exists());
        assert!(new.join(".latex4all/collab.json").exists());
        std::fs::remove_dir_all(old).unwrap();
        std::fs::remove_dir_all(new).unwrap();
    }

    #[test]
    fn refuses_moves_that_would_lose_the_project() {
        let old = project("guard");
        let taken = std::env::temp_dir().join(format!("taken-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&taken).unwrap();

        // Somewhere there's already a folder of that name.
        assert!(move_project_folder(&old, &taken).is_err());
        // Into itself.
        assert!(move_project_folder(&old, &old.join("inside")).is_err());
        // A relative destination, which would land wherever the app is running.
        assert!(move_project_folder(&old, Path::new("elsewhere")).is_err());
        // A project that isn't there any more.
        assert!(move_project_folder(&taken.join("gone"), &taken.join("x")).is_err());
        assert!(old.join("main.tex").exists());

        std::fs::remove_dir_all(old).unwrap();
        std::fs::remove_dir_all(taken).unwrap();
    }
}
