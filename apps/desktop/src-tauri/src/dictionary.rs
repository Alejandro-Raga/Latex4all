//! Word lookup for the editor's dictionary/thesaurus popover.
//!
//! On macOS this uses the public `DCSCopyTextDefinition` API (CoreServices
//! framework), the same mechanism behind the system-wide "Look Up" feature in
//! Safari, Notes, TextEdit, etc., for the definition.
//! `DCSCopyTextDefinition(NULL, ...)` only returns the *first* matching
//! dictionary though, not a merge of everything active — so if the user's
//! Thesaurus is enabled it's never actually consulted that way. To get synonyms
//! we separately enumerate the installed dictionaries (via the undocumented but
//! stable `DCSCopyAvailableDictionaries`, still shipped in CoreServices) to find
//! the active Thesaurus and query it directly.
//!
//! Windows and Linux have no comparable system dictionary, so they are served
//! entirely by the bundled WordNet database (see `wordnet.rs`). macOS falls
//! back to WordNet too, per-field: plenty of Macs have a dictionary enabled but
//! no Thesaurus, which would otherwise leave the popover with no synonyms at
//! all.

use crate::wordnet::{self, WordNet};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryLookupResult {
    /// Definition text, from the user's primary active dictionary on macOS or
    /// from WordNet elsewhere.
    definition: Option<String>,
    /// Raw entry text from the user's active macOS Thesaurus dictionary, if one
    /// is installed and has an entry for the term. The frontend parses this
    /// into synonym and antonym lists. `None` whenever the structured lists
    /// below are populated instead.
    synonyms: Option<String>,
    /// Synonyms as a structured list, from WordNet. When present the frontend
    /// uses these directly rather than parsing `synonyms` prose.
    synonym_list: Option<Vec<String>>,
    /// Antonyms as a structured list, from WordNet.
    antonym_list: Option<Vec<String>>,
    /// False when nothing could answer this language at all, so the popover
    /// can offer to install something instead of claiming the word has no
    /// entry. True on macOS, where the system dictionary answers regardless.
    database_available: bool,
    /// Set when the language is not English and has no installed thesaurus, so
    /// the popover can point at the language pack rather than at WordNet.
    missing_language_pack: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRange, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use std::os::raw::c_void;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        // Public API.
        fn DCSCopyTextDefinition(
            dictionary: *const c_void,
            string: CFStringRef,
            range: CFRange,
        ) -> CFStringRef;

        // Undocumented but present in CoreServices across current macOS versions.
        // Returns an owned CFSetRef of opaque DCSDictionaryRef values.
        fn DCSCopyAvailableDictionaries() -> *const c_void;
        // Borrowed (not owned) CFStringRef; do not release.
        fn DCSDictionaryGetName(dictionary: *const c_void) -> CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFSetGetCount(the_set: *const c_void) -> isize;
        fn CFSetGetValues(the_set: *const c_void, values: *mut *const c_void);
        fn CFRelease(cf: *const c_void);
    }

    fn define_with(dictionary: *const c_void, cf_term: &CFString) -> Option<String> {
        let range = CFRange::init(0, cf_term.char_len());
        unsafe {
            let def_ref = DCSCopyTextDefinition(dictionary, cf_term.as_concrete_TypeRef(), range);
            if def_ref.is_null() {
                None
            } else {
                Some(CFString::wrap_under_create_rule(def_ref).to_string())
            }
        }
    }

    /// Find the best installed Thesaurus dictionary, preferring an English one
    /// when more than one is installed (e.g. alongside a foreign-language pack).
    fn find_thesaurus() -> Option<*const c_void> {
        unsafe {
            let dicts = DCSCopyAvailableDictionaries();
            if dicts.is_null() {
                return None;
            }
            let count = CFSetGetCount(dicts);
            let mut values: Vec<*const c_void> = vec![std::ptr::null(); count.max(0) as usize];
            CFSetGetValues(dicts, values.as_mut_ptr());

            let mut best: Option<*const c_void> = None;
            let mut best_is_english = false;
            for &d in &values {
                if d.is_null() {
                    continue;
                }
                let name_ref = DCSDictionaryGetName(d);
                if name_ref.is_null() {
                    continue;
                }
                let name = CFString::wrap_under_get_rule(name_ref).to_string();
                let lower = name.to_lowercase();
                if lower.contains("thesaurus") {
                    let is_english = lower.contains("english");
                    if best.is_none() || (is_english && !best_is_english) {
                        best = Some(d);
                        best_is_english = is_english;
                    }
                }
            }

            CFRelease(dicts);
            best
        }
    }

    /// `(definition, raw thesaurus entry)`, either of which may be absent
    /// depending on which dictionaries the user has enabled.
    pub fn lookup(term: &str) -> (Option<String>, Option<String>) {
        let cf_term = CFString::new(term);
        let definition = define_with(std::ptr::null(), &cf_term);
        let synonyms = find_thesaurus().and_then(|dict| define_with(dict, &cf_term));
        (definition, synonyms)
    }
}

// ── Database location ──

/// Princeton's WordNet 3.1 database archive — the same one
/// `scripts/fetch-wordnet.mjs` bakes into a build, re-fetched here when a
/// build shipped without it. Pinned by checksum so a silent upstream change
/// can't swap the database under the user.
const ARCHIVE_URL: &str = "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz";
const ARCHIVE_SHA256: &str = "3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a";
const WORDNET_VERSION: &str = "3.1";

/// Match WordNet's own ceilings, so the popover reads the same either way.
const MAX_THESAURUS_SYNONYMS: usize = 60;
const MAX_THESAURUS_ANTONYMS: usize = 30;

const POS: [&str; 4] = ["noun", "verb", "adj", "adv"];

/// The twelve files lookups actually read; the rest of the distribution
/// (sentence frames, corpus counts, source `dbfiles/`) is discarded.
fn required_files() -> Vec<String> {
    POS.iter()
        .map(|p| format!("index.{p}"))
        .chain(POS.iter().map(|p| format!("data.{p}")))
        .chain(POS.iter().map(|p| format!("{p}.exc")))
        .collect()
}

/// Where a user-installed copy lives, e.g. `%LOCALAPPDATA%\Latex4All\wordnet`
/// on Windows. Mirrors LanguageTool's per-user install: no admin rights, and
/// nothing to clean up outside it.
fn user_dictionary_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|dir| dir.join("Latex4All").join("wordnet"))
        .ok_or_else(|| "Could not determine the local application data directory".to_string())
}

/// Location of the WordNet database bundled with the app. Resolved through
/// Tauri so it works both from a packaged bundle and from `tauri dev`, where
/// resources are read straight out of the source tree.
fn bundled_dictionary_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("resources/wordnet", tauri::path::BaseDirectory::Resource)
        .ok()
}

fn looks_like_database(dir: &Path) -> bool {
    dir.join("index.noun").is_file()
}

/// The database to read, preferring a copy the user installed themselves —
/// that is the one that exists precisely because the bundled resource didn't.
fn wordnet_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = user_dictionary_dir() {
        if looks_like_database(&dir) {
            return Some(dir);
        }
    }
    bundled_dictionary_dir(app).filter(|dir| looks_like_database(dir))
}

// ── Status ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryStatus {
    /// True when a database is present and lookups can answer offline.
    installed: bool,
    /// "bundled" (shipped with the app), "user" (downloaded on this machine),
    /// or "none".
    source: &'static str,
    /// Where a download would go, so the UI can name it.
    install_dir: String,
    /// True on macOS, where Dictionary Services answers even with no WordNet.
    has_system_dictionary: bool,
    version: &'static str,
}

/// Whether the offline dictionary/thesaurus database is available, and from
/// where.
#[tauri::command]
pub fn dictionary_status(app: tauri::AppHandle) -> Result<DictionaryStatus, String> {
    let user_dir = user_dictionary_dir()?;
    let user_installed = looks_like_database(&user_dir);
    let bundled = bundled_dictionary_dir(&app)
        .map(|dir| looks_like_database(&dir))
        .unwrap_or(false);

    Ok(DictionaryStatus {
        installed: user_installed || bundled,
        source: if user_installed {
            "user"
        } else if bundled {
            "bundled"
        } else {
            "none"
        },
        install_dir: user_dir.to_string_lossy().into_owned(),
        has_system_dictionary: cfg!(target_os = "macos"),
        version: WORDNET_VERSION,
    })
}

// ── Install ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// One of "download", "extract", "done".
    phase: &'static str,
    message: String,
    /// 0-100, or `None` for steps with no measurable total.
    percent: Option<u8>,
}

fn emit(window: &WebviewWindow, phase: &'static str, message: impl Into<String>, percent: Option<u8>) {
    let _ = window.emit(
        "dictionary-progress",
        Progress {
            phase,
            message: message.into(),
            percent,
        },
    );
}

/// Downloads the WordNet database into the per-user directory. Used when a
/// build shipped without the bundled resource — without this the dictionary
/// popover on Windows and Linux has nothing to answer from and no way to say
/// so. Roughly 16 MB compressed, 27 MB unpacked; progress is reported through
/// `dictionary-progress`.
#[tauri::command]
pub async fn install_dictionary(window: WebviewWindow) -> Result<(), String> {
    let dest = user_dictionary_dir()?;
    emit(&window, "download", "Downloading the dictionary database…", Some(0));

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let mut response = client
        .get(ARCHIVE_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to download the dictionary database: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download the dictionary database: server returned HTTP {}",
            response.status()
        ));
    }

    let total = response.content_length();
    let mut archive: Vec<u8> = Vec::with_capacity(total.unwrap_or(16 * 1024 * 1024) as usize);
    let mut last_percent = 0u8;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Download of the dictionary database was interrupted: {e}"))?
    {
        archive.extend_from_slice(&chunk);
        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = (((archive.len() as u64).saturating_mul(100)) / total).min(100) as u8;
            // Emitting on every chunk would flood the webview; 1% steps are plenty.
            if percent > last_percent {
                last_percent = percent;
                emit(
                    &window,
                    "download",
                    format!(
                        "Downloading the dictionary database… {} of {} MB",
                        archive.len() as u64 / 1_048_576,
                        total / 1_048_576
                    ),
                    Some(percent),
                );
            }
        }
    }

    let digest = format!("{:x}", Sha256::digest(&archive));
    if digest != ARCHIVE_SHA256 {
        return Err(format!(
            "The downloaded dictionary database does not match its expected checksum \
             (expected {ARCHIVE_SHA256}, got {digest}). Nothing was installed."
        ));
    }

    emit(&window, "extract", "Unpacking the dictionary database…", None);
    tauri::async_runtime::spawn_blocking(move || extract_database(&archive, &dest))
        .await
        .map_err(|e| e.to_string())??;

    emit(&window, "done", "The dictionary is ready.", Some(100));
    Ok(())
}

/// Unpacks just the twelve files lookups need out of the WordNet tarball,
/// which stores them under a single `dict/` directory.
fn extract_database(archive: &[u8], dest: &Path) -> Result<(), String> {
    let wanted = required_files();
    let staging = dest.with_extension("incoming");
    // Replace any half-finished previous attempt rather than merging into it.
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("Failed to create {}: {e}", staging.display()))?;

    let decoder = flate2::read::GzDecoder::new(archive);
    let mut tar = tar::Archive::new(decoder);
    for entry in tar
        .entries()
        .map_err(|e| format!("Failed to read the dictionary archive: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("Corrupt dictionary archive entry: {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("Corrupt dictionary archive entry: {e}"))?
            .into_owned();
        // Match on the file name alone, so nothing in the archive can steer
        // the write outside `staging` via `..` or an absolute path.
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !wanted.iter().any(|w| w == name) {
            continue;
        }
        let target = staging.join(name);
        let mut out = std::fs::File::create(&target)
            .map_err(|e| format!("Failed to create {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Failed to extract {}: {e}", target.display()))?;
    }

    let missing: Vec<&String> = wanted
        .iter()
        .filter(|f| !staging.join(f).is_file())
        .collect();
    if !missing.is_empty() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!(
            "The dictionary archive was missing {} of the files lookups need ({}).",
            missing.len(),
            missing
                .iter()
                .map(|f| f.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    // Swap into place only once every file is on disk, so a failed install
    // never leaves a half-populated directory that `looks_like_database`
    // would happily accept.
    let _ = std::fs::remove_dir_all(dest);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    std::fs::rename(&staging, dest).map_err(|e| {
        format!(
            "Failed to move the dictionary into {}: {e}",
            dest.display()
        )
    })?;
    Ok(())
}

// ── Lookup ──

/// Look up `term` for a document in `language`, filling in whatever is
/// available.
///
/// English is served by the bundled WordNet (and, on macOS, by Dictionary
/// Services). Other languages have no glossed database to draw definitions
/// from, so they get synonyms out of the language pack's thesaurus — which is
/// the half a writer reaches for anyway — and an honest "no definition".
#[tauri::command]
pub fn lookup_dictionary_definition(
    app: tauri::AppHandle,
    term: String,
    language: Option<String>,
) -> DictionaryLookupResult {
    let language = language.unwrap_or_default();
    let is_english = language.is_empty()
        || language.eq_ignore_ascii_case("auto")
        || language.to_lowercase().starts_with("en");

    let trimmed = term.trim();
    if trimmed.is_empty() {
        return DictionaryLookupResult {
            database_available: true,
            ..Default::default()
        };
    }

    if !is_english {
        return lookup_non_english(trimmed, &language);
    }

    let dir = wordnet_dir(&app);
    // On macOS the system dictionary answers on its own, so a missing WordNet
    // database is not the reason a word came back empty.
    let database_available = dir.is_some() || cfg!(target_os = "macos");

    #[cfg(target_os = "macos")]
    let (definition, thesaurus_entry) = macos::lookup(trimmed);
    #[cfg(not(target_os = "macos"))]
    let (definition, thesaurus_entry): (Option<String>, Option<String>) = (None, None);

    // WordNet covers whatever the system dictionary didn't. On Windows and
    // Linux that's everything; on macOS it's typically just the thesaurus half.
    let needs_wordnet = definition.is_none() || thesaurus_entry.is_none();
    let wordnet_entry = if needs_wordnet {
        dir.and_then(|dir| WordNet::shared(&dir).ok())
            .map(|wn| wn.lookup(trimmed))
            .filter(|entry| !entry.is_empty())
    } else {
        None
    };

    let wordnet_definition = wordnet_entry
        .as_ref()
        .and_then(wordnet::format_definition);

    // Only surface the structured lists when the system thesaurus came up
    // empty — otherwise the frontend would show two competing synonym sets.
    let (synonym_list, antonym_list) = match (&thesaurus_entry, &wordnet_entry) {
        (None, Some(entry)) => (
            Some(entry.synonyms.clone()).filter(|s| !s.is_empty()),
            Some(entry.antonyms.clone()).filter(|a| !a.is_empty()),
        ),
        _ => (None, None),
    };

    DictionaryLookupResult {
        definition: definition.or(wordnet_definition),
        synonyms: thesaurus_entry,
        synonym_list,
        antonym_list,
        database_available,
        missing_language_pack: None,
    }
}

/// Definitions, synonyms and antonyms from the installed language pack.
///
/// Definitions come from the prepared Wiktionary database; synonyms are the
/// union of Wiktionary's and the MyThes thesaurus's, since the two disagree
/// about coverage and neither is a superset. Antonyms exist only in the
/// Wiktionary half — MyThes records none at all.
fn lookup_non_english(term: &str, language: &str) -> DictionaryLookupResult {
    let definitions = crate::language_packs::definitions(language);
    let thesaurus = crate::language_packs::thesaurus(language);
    if definitions.is_none() && thesaurus.is_none() {
        return DictionaryLookupResult {
            database_available: false,
            missing_language_pack: Some(language.to_string()),
            ..Default::default()
        };
    }

    let senses = definitions
        .map(|source| source.lookup(term))
        .unwrap_or_default();

    let mut synonyms: Vec<String> = Vec::new();
    let mut antonyms: Vec<String> = Vec::new();
    let push = |list: &mut Vec<String>, word: &str, limit: usize| {
        if list.len() < limit
            && !word.eq_ignore_ascii_case(term)
            && !list.iter().any(|existing| existing.eq_ignore_ascii_case(word))
        {
            list.push(word.to_string());
        }
    };

    for sense in &senses {
        for word in &sense.synonyms {
            push(&mut synonyms, word, MAX_THESAURUS_SYNONYMS);
        }
        for word in &sense.antonyms {
            push(&mut antonyms, word, MAX_THESAURUS_ANTONYMS);
        }
    }
    if let Some(thesaurus) = thesaurus {
        for sense in thesaurus.lookup(term) {
            for word in sense.synonyms {
                push(&mut synonyms, &word, MAX_THESAURUS_SYNONYMS);
            }
        }
    }

    DictionaryLookupResult {
        definition: format_pack_definition(term, &senses),
        synonyms: None,
        synonym_list: Some(synonyms).filter(|s| !s.is_empty()),
        antonym_list: Some(antonyms).filter(|a| !a.is_empty()),
        database_available: true,
        missing_language_pack: None,
    }
}

/// Renders senses the way `wordnet::format_definition` renders English ones,
/// so the popover reads the same in either language: the headword and its part
/// of speech, then numbered senses.
fn format_pack_definition(
    term: &str,
    senses: &[crate::language_packs::DefinitionSense],
) -> Option<String> {
    if senses.is_empty() {
        return None;
    }

    let mut out = String::new();
    let mut current_pos: Option<&str> = None;
    let mut index = 0usize;

    for sense in senses {
        let pos = sense.part_of_speech.as_deref();
        if current_pos != pos {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(term);
            if let Some(pos) = pos {
                out.push(' ');
                out.push_str(pos);
            }
            out.push('\n');
            current_pos = pos;
            index = 0;
        }
        index += 1;
        out.push_str(&format!("{index}. {}\n", sense.text));
    }

    Some(out.trim_end().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// One raw ustar record. Written by hand rather than with `tar::Builder`
    /// because the builder refuses to *write* a traversal path — and a
    /// traversal path is exactly what the extractor has to survive reading.
    fn tar_record(name: &str, contents: &str) -> Vec<u8> {
        let mut header = [0u8; 512];
        let write = |header: &mut [u8; 512], at: usize, value: &[u8]| {
            header[at..at + value.len()].copy_from_slice(value);
        };
        write(&mut header, 0, name.as_bytes());
        write(&mut header, 100, b"0000644\0"); // mode
        write(&mut header, 108, b"0000000\0"); // uid
        write(&mut header, 116, b"0000000\0"); // gid
        write(&mut header, 124, format!("{:011o}\0", contents.len()).as_bytes());
        write(&mut header, 136, b"00000000000\0"); // mtime
        write(&mut header, 148, b"        "); // checksum field, spaces while summing
        write(&mut header, 156, b"0"); // typeflag: regular file
        write(&mut header, 257, b"ustar\000");
        let checksum: u32 = header.iter().map(|b| u32::from(*b)).sum();
        write(&mut header, 148, format!("{checksum:06o}\0 ").as_bytes());

        let mut record = header.to_vec();
        record.extend_from_slice(contents.as_bytes());
        record.resize(record.len().div_ceil(512) * 512, 0);
        record
    }

    /// A gzipped tarball shaped like Princeton's: everything under `dict/`.
    fn fake_archive(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut tar_bytes = Vec::new();
        for (name, contents) in entries {
            tar_bytes.extend_from_slice(&tar_record(name, contents));
        }
        tar_bytes.extend_from_slice(&[0u8; 1024]); // end-of-archive marker

        let mut encoder =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&tar_bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn complete_entries() -> Vec<(String, String)> {
        required_files()
            .into_iter()
            .map(|f| (format!("dict/{f}"), format!("contents of {f}")))
            .collect()
    }

    fn as_refs(entries: &[(String, String)]) -> Vec<(&str, &str)> {
        entries
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect()
    }

    #[test]
    fn extract_keeps_the_files_lookups_need() {
        let entries = complete_entries();
        let archive = fake_archive(&as_refs(&entries));
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("wordnet");

        extract_database(&archive, &dest).unwrap();

        assert!(looks_like_database(&dest));
        for file in required_files() {
            assert!(dest.join(&file).is_file(), "missing {file}");
        }
    }

    #[test]
    fn extract_ignores_everything_else_in_the_archive() {
        let mut entries = complete_entries();
        entries.push(("dict/cntlist.rev".into(), "not needed".into()));
        entries.push(("dict/dbfiles/noun.animal".into(), "not needed".into()));
        let archive = fake_archive(&as_refs(&entries));
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("wordnet");

        extract_database(&archive, &dest).unwrap();

        assert!(!dest.join("cntlist.rev").exists());
        assert!(!dest.join("dbfiles").exists());
    }

    #[test]
    fn extract_cannot_be_steered_outside_the_destination() {
        let mut entries = complete_entries();
        entries.push(("../../escaped.txt".into(), "pwned".into()));
        let archive = fake_archive(&as_refs(&entries));
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("nested").join("wordnet");

        extract_database(&archive, &dest).unwrap();

        assert!(!tmp.path().join("escaped.txt").exists());
        assert!(!dest.join("escaped.txt").exists());
    }

    #[test]
    fn an_incomplete_archive_installs_nothing() {
        let mut entries = complete_entries();
        entries.pop(); // one file short
        let archive = fake_archive(&as_refs(&entries));
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("wordnet");

        let error = extract_database(&archive, &dest).expect_err("should refuse");
        assert!(error.contains("missing"), "unexpected error: {error}");
        // A half-populated directory would look installed to `wordnet_dir`.
        assert!(!dest.exists());
        assert!(!dest.with_extension("incoming").exists());
    }

    #[test]
    fn extract_replaces_a_previous_install() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("wordnet");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("stale.txt"), "old")
            .unwrap();

        let entries = complete_entries();
        let archive = fake_archive(&as_refs(&entries));
        extract_database(&archive, &dest).unwrap();

        assert!(!dest.join("stale.txt").exists());
        assert!(looks_like_database(&dest));
    }
}
