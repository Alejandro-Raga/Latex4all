//! Downloadable spelling and thesaurus data for the languages the app offers.
//!
//! The OS spell checkers cover very different ground. macOS ships dictionaries
//! for every language in `CHECK_LANGUAGES`; Windows' `ISpellChecker` only
//! exposes languages the user has added as a Windows language pack, and Linux
//! has no system spell checker at all. So a Spanish document could be checked
//! on a Mac and silently not checked at all on Windows — `misspelled_words`
//! returns an empty list either way, which reads as "nothing is misspelled".
//!
//! A language pack fills that gap without asking anyone for admin rights: the
//! Hunspell affix/dictionary pair drives a pure-Rust checker (`spellbook`), and
//! the MyThes thesaurus behind it gives the lookup popover synonyms in the
//! document's own language. Both come from the LibreOffice dictionary
//! collection, pinned to one commit.
//!
//! Spanish also gets definitions and the thesaurus as prepared files (see
//! `PreparedFile`), brotli-compressed so the whole pack stays a few megabytes.

use serde::Serialize;
use sha2::Digest;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, WebviewWindow};

/// LibreOffice's dictionary collection, pinned so the data can't change under
/// an installed app. Bump deliberately.
const DICTIONARIES_COMMIT: &str = "32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4";

fn raw_url(path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/LibreOffice/dictionaries/{DICTIONARIES_COMMIT}/{path}"
    )
}

struct PackSource {
    /// Path within the LibreOffice repository. Every pinned spelling file is
    /// UTF-8; the one Latin-1 file upstream, the Spanish thesaurus, is served
    /// as a prepared file instead.
    path: &'static str,
    /// Name it is stored under, so runtime code never has to know the
    /// upstream naming (which differs per language: `fr.dic`, `es_ES.dic`,
    /// `de_DE_frami.dic`, ...).
    stored_as: &'static str,
}

pub struct LanguagePack {
    /// Matches the codes in the app's language picker (`CHECK_LANGUAGES`).
    code: &'static str,
    label: &'static str,
    spelling: [PackSource; 2],
    /// English is served by the bundled WordNet, which has real definitions;
    /// pulling a 17 MB MyThes file to duplicate its synonyms would be waste.
    thesaurus: Option<PreparedFile>,
    /// Definitions, where a usable source exists. English has WordNet already.
    definitions: Option<PreparedFile>,
    /// Inflected form -> headword, so definitions are found for the words as
    /// they actually appear in running text.
    forms: Option<PreparedFile>,
    /// What the prepared files' licences oblige us to show.
    attribution: Option<&'static str>,
    /// Rounded total download, for the picker: GitHub-compressed spelling
    /// files from the pinned commit plus any prepared files.
    approx_bytes: u64,
}

fn aff(path: &'static str) -> PackSource {
    PackSource {
        path,
        stored_as: "spelling.aff",
    }
}

fn dic(path: &'static str) -> PackSource {
    PackSource {
        path,
        stored_as: "spelling.dic",
    }
}

/// A brotli-compressed file built by `scripts/build-spanish-definitions.mjs`
/// and published as a release asset, rather than fetched from an upstream
/// project like the spelling files — no one distributes Wiktionary in a form
/// small enough to download on demand, and upstream serves the thesaurus
/// uncompressed at seven times the size.
struct PreparedFile {
    url: &'static str,
    sha256: &'static str,
    stored_as: &'static str,
}

fn catalogue() -> &'static [LanguagePack] {
    static CATALOGUE: OnceLock<Vec<LanguagePack>> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        vec![
            LanguagePack {
                code: "en-US",
                label: "English (US)",
                spelling: [aff("en/en_US.aff"), dic("en/en_US.dic")],
                thesaurus: None,
                definitions: None,
                forms: None,
                attribution: None,
                approx_bytes: 200_000,
            },
            LanguagePack {
                code: "en-GB",
                label: "English (UK)",
                spelling: [aff("en/en_GB.aff"), dic("en/en_GB.dic")],
                thesaurus: None,
                definitions: None,
                forms: None,
                attribution: None,
                approx_bytes: 450_000,
            },
            LanguagePack {
                code: "en-CA",
                label: "English (Canada)",
                spelling: [aff("en/en_CA.aff"), dic("en/en_CA.dic")],
                thesaurus: None,
                definitions: None,
                forms: None,
                attribution: None,
                approx_bytes: 200_000,
            },
            LanguagePack {
                code: "en-AU",
                label: "English (Australia)",
                spelling: [aff("en/en_AU.aff"), dic("en/en_AU.dic")],
                thesaurus: None,
                definitions: None,
                forms: None,
                attribution: None,
                approx_bytes: 200_000,
            },
            // English and Spanish only. Adding a language here means committing
            // to its spelling, grammar and lookup paths all working; see
            // CHECK_LANGUAGES in src/stores/settings-store.ts.
            LanguagePack {
                code: "es",
                label: "Spanish",
                spelling: [aff("es/es_ES.aff"), dic("es/es_ES.dic")],
                thesaurus: Some(PreparedFile {
                    url: "https://github.com/Alejandro-Raga/Latex4all/releases/download/dictionary-data-v2/es-thesaurus.dat.br",
                    sha256: "6e3e8060b089ed8d17a2ec653dc40404d5106f6d718537ede6845caff3a0a101",
                    stored_as: "thesaurus.dat",
                }),
                definitions: Some(PreparedFile {
                    url: "https://github.com/Alejandro-Raga/Latex4all/releases/download/dictionary-data-v2/es-definitions.dat.br",
                    sha256: "7e9f61e7827110a0bc7856c47fcd75a5c02df4ad2a62720c5b834de031b35540",
                    stored_as: "definitions.dat",
                }),
                forms: Some(PreparedFile {
                    url: "https://github.com/Alejandro-Raga/Latex4all/releases/download/dictionary-data-v2/es-forms.dat.br",
                    sha256: "a3ec7ad65720f5352ffcf4a568d01b34b08b2fb56153120c0ced2378133ab3ce",
                    stored_as: FORMS_FILE,
                }),
                attribution: Some("Definitions from Wiktionary (CC BY-SA 4.0)"),
                approx_bytes: 4_150_000,
            },
        ]
    })
}

fn pack_for(code: &str) -> Option<&'static LanguagePack> {
    catalogue()
        .iter()
        .find(|p| p.code.eq_ignore_ascii_case(code))
}

// ── Storage ──

fn packs_root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|dir| dir.join("Latex4All").join("languages"))
        .ok_or_else(|| "Could not determine the local application data directory".to_string())
}

/// One language's directory. The code goes in verbatim, but it is only ever a
/// value from the catalogue — never caller-supplied text.
fn pack_dir(code: &str) -> Result<PathBuf, String> {
    Ok(packs_root()?.join(code))
}

fn is_installed(code: &str) -> bool {
    pack_dir(code)
        .map(|dir| dir.join("spelling.aff").is_file() && dir.join("spelling.dic").is_file())
        .unwrap_or(false)
}

fn has_thesaurus(code: &str) -> bool {
    pack_dir(code)
        .map(|dir| dir.join("thesaurus.dat").is_file())
        .unwrap_or(false)
}

fn has_definitions(code: &str) -> bool {
    pack_dir(code)
        .map(|dir| dir.join("definitions.dat").is_file())
        .unwrap_or(false)
}

const FORMS_FILE: &str = "forms.dat";

// ── Status ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePackInfo {
    code: String,
    label: String,
    /// A pack has been downloaded for this language.
    installed: bool,
    /// The downloaded pack includes a thesaurus (synonyms in the popover).
    has_thesaurus: bool,
    /// This pack would also bring a thesaurus if installed.
    offers_thesaurus: bool,
    /// The downloaded pack includes definitions.
    has_definitions: bool,
    /// This pack would also bring definitions if installed.
    offers_definitions: bool,
    /// Attribution the licence obliges us to show, when there is one.
    attribution: Option<String>,
    /// Installed, but from before the pack gained a file it now offers.
    /// Nothing else would say so: the pack still spell checks, it just
    /// quietly has no definitions.
    needs_update: bool,
    /// The OS already spell checks this language, so a pack is optional.
    system_supported: bool,
    approx_bytes: u64,
}

/// Every language the app can check, and what is available for it here.
#[tauri::command]
pub async fn list_language_packs() -> Result<Vec<LanguagePackInfo>, String> {
    // The Windows check is a COM round-trip per language; keep it off the UI
    // thread like the rest of the spell-checking calls.
    tauri::async_runtime::spawn_blocking(|| {
        catalogue()
            .iter()
            .map(|pack| LanguagePackInfo {
                code: pack.code.to_string(),
                label: pack.label.to_string(),
                installed: is_installed(pack.code),
                has_thesaurus: has_thesaurus(pack.code),
                offers_thesaurus: pack.thesaurus.is_some(),
                has_definitions: has_definitions(pack.code),
                offers_definitions: pack.definitions.is_some(),
                attribution: pack.attribution.map(str::to_string),
                needs_update: is_installed(pack.code)
                    && ((pack.thesaurus.is_some() && !has_thesaurus(pack.code))
                        || (pack.definitions.is_some() && !has_definitions(pack.code))),
                system_supported: crate::spellcheck::system_supports_language(pack.code),
                approx_bytes: pack.approx_bytes,
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

// ── Install ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    code: String,
    message: String,
    percent: Option<u8>,
}

fn emit(window: &WebviewWindow, code: &str, message: impl Into<String>, percent: Option<u8>) {
    let _ = window.emit(
        "language-pack-progress",
        Progress {
            code: code.to_string(),
            message: message.into(),
            percent,
        },
    );
}

fn decode(bytes: Vec<u8>) -> String {
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // A BOM would otherwise become part of the first keyword and make the
    // affix file's opening directive unparseable.
    text.strip_prefix('\u{feff}')
        .map(str::to_string)
        .unwrap_or(text)
}

async fn fetch(client: &reqwest::Client, source: &PackSource) -> Result<String, String> {
    let url = raw_url(source.path);
    // GitHub compresses these on request (the Spanish dictionary drops from
    // 716 KB to 210 KB), but reqwest is built without automatic decompression,
    // so ask for it here and undo it below.
    let response = client
        .get(&url)
        .header(reqwest::header::ACCEPT_ENCODING, "gzip")
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {e}", source.path))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {}: server returned HTTP {}",
            source.path,
            response.status()
        ));
    }
    let gzipped = response
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"gzip"));
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download of {} was interrupted: {e}", source.path))?;
    let bytes = if gzipped {
        let mut plain = Vec::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .read_to_end(&mut plain)
            .map_err(|e| format!("{} could not be decompressed: {e}", source.path))?;
        plain
    } else {
        bytes.to_vec()
    };
    Ok(decode(bytes))
}

/// Downloads, verifies and decompresses one prepared file, returning it in
/// the form it is stored on disk.
async fn fetch_prepared(client: &reqwest::Client, file: &PreparedFile) -> Result<String, String> {
    let response = client
        .get(file.url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {e}", file.stored_as))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {}: server returned HTTP {}",
            file.stored_as,
            response.status()
        ));
    }
    let compressed = response
        .bytes()
        .await
        .map_err(|e| format!("Download of {} was interrupted: {e}", file.stored_as))?;

    // These are our own artifacts rather than upstream files, so they are
    // checksummed: nothing else would notice one served truncated or replaced.
    let digest = format!("{:x}", sha2::Sha256::digest(&compressed));
    if digest != file.sha256 {
        return Err(format!(
            "The downloaded {} does not match its expected checksum \
             (expected {}, got {digest}). Nothing was installed.",
            file.stored_as, file.sha256
        ));
    }

    let mut text = String::new();
    brotli_decompressor::Decompressor::new(&compressed[..], 64 * 1024)
        .read_to_string(&mut text)
        .map_err(|e| format!("{} could not be decompressed: {e}", file.stored_as))?;

    if file.stored_as == FORMS_FILE {
        expand_forms(&text)
    } else {
        Ok(text)
    }
}

/// Downloads the spelling dictionary — and the thesaurus, where one exists —
/// for `code`, storing everything as UTF-8 so nothing downstream deals with
/// encodings. Progress is reported through `language-pack-progress`.
#[tauri::command]
pub async fn install_language_pack(window: WebviewWindow, code: String) -> Result<(), String> {
    let pack = pack_for(&code).ok_or_else(|| format!("Unknown language: {code}"))?;
    let dest = pack_dir(pack.code)?;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut downloaded: Vec<(&'static str, String)> = Vec::new();
    let prepared: Vec<&PreparedFile> = [&pack.thesaurus, &pack.definitions, &pack.forms]
        .into_iter()
        .flatten()
        .collect();
    let total = pack.spelling.len() + prepared.len();
    let progress = |index: usize| {
        emit(
            &window,
            pack.code,
            format!("Downloading {} ({} of {total})…", pack.label, index + 1),
            Some(((index * 95) / total) as u8),
        );
    };

    for (index, source) in pack.spelling.iter().enumerate() {
        progress(index);
        downloaded.push((source.stored_as, fetch(&client, source).await?));
    }
    for (index, file) in prepared.into_iter().enumerate() {
        progress(pack.spelling.len() + index);
        downloaded.push((file.stored_as, fetch_prepared(&client, file).await?));
    }

    emit(
        &window,
        pack.code,
        format!("Installing {}…", pack.label),
        Some(95),
    );

    // Written to a staging directory and swapped in, so a failed download can
    // never leave a half-written pack that `is_installed` would accept.
    let staging = dest.with_extension("incoming");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("Failed to create {}: {e}", staging.display()))?;
    for (name, contents) in &downloaded {
        std::fs::write(staging.join(name), contents)
            .map_err(|e| format!("Failed to write {name}: {e}"))?;
    }

    // Prove the pack actually loads before it replaces anything: a dictionary
    // that spellbook rejects would otherwise fail silently at every keystroke.
    let aff = staging.join("spelling.aff");
    let dic = staging.join("spelling.dic");
    load_dictionary(&aff, &dic).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        format!(
            "The downloaded {} dictionary could not be read: {e}",
            pack.label
        )
    })?;

    let _ = std::fs::remove_dir_all(&dest);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    std::fs::rename(&staging, &dest)
        .map_err(|e| format!("Failed to install the {} pack: {e}", pack.label))?;

    forget_cached(pack.code);
    emit(
        &window,
        pack.code,
        format!("{} is ready.", pack.label),
        Some(100),
    );
    Ok(())
}

/// Deletes a downloaded pack. The OS checker, where it has the language, takes
/// over again.
#[tauri::command]
pub async fn remove_language_pack(code: String) -> Result<(), String> {
    let pack = pack_for(&code).ok_or_else(|| format!("Unknown language: {code}"))?;
    let dir = pack_dir(pack.code)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Failed to remove the {} pack: {e}", pack.label))?;
    }
    forget_cached(pack.code);
    Ok(())
}

// ── Spelling ──

type Dict = spellbook::Dictionary;

struct Caches {
    dictionaries: HashMap<String, Option<&'static Dict>>,
    thesauri: HashMap<String, Option<&'static Thesaurus>>,
    definitions: HashMap<String, Option<&'static Definitions>>,
    forms: HashMap<String, &'static Forms>,
}

fn caches() -> &'static Mutex<Caches> {
    static CACHES: OnceLock<Mutex<Caches>> = OnceLock::new();
    CACHES.get_or_init(|| {
        Mutex::new(Caches {
            dictionaries: HashMap::new(),
            thesauri: HashMap::new(),
            definitions: HashMap::new(),
            forms: HashMap::new(),
        })
    })
}

/// Drops what was cached for `code`, so installing or removing a pack takes
/// effect on the next keystroke rather than after a restart.
fn forget_cached(code: &str) {
    if let Ok(mut caches) = caches().lock() {
        caches.dictionaries.remove(code);
        caches.thesauri.remove(code);
        caches.definitions.remove(code);
        caches.forms.remove(code);
    }
}

fn load_dictionary(aff: &Path, dic: &Path) -> Result<Dict, String> {
    let aff = std::fs::read_to_string(aff).map_err(|e| e.to_string())?;
    let dic = std::fs::read_to_string(dic).map_err(|e| e.to_string())?;
    Dict::new(&aff, &dic).map_err(|e| e.to_string())
}

/// The checker for `code`, or `None` when no pack is installed. Leaked on first
/// use: a dictionary is a few MB, is loaded at most once, and lives as long as
/// the process would keep it anyway.
fn dictionary(code: &str) -> Option<&'static Dict> {
    let mut caches = caches().lock().ok()?;
    if let Some(cached) = caches.dictionaries.get(code) {
        return *cached;
    }
    let loaded = pack_dir(code).ok().and_then(|dir| {
        let (aff, dic) = (dir.join("spelling.aff"), dir.join("spelling.dic"));
        if !aff.is_file() || !dic.is_file() {
            return None;
        }
        match load_dictionary(&aff, &dic) {
            Ok(dict) => Some(&*Box::leak(Box::new(dict))),
            Err(error) => {
                eprintln!("[language-packs] {code} dictionary failed to load: {error}");
                None
            }
        }
    });
    caches.dictionaries.insert(code.to_string(), loaded);
    loaded
}

/// Which of `words` a downloaded pack considers misspelled. `None` means there
/// is no pack for this language — distinct from "a pack checked these and
/// found nothing wrong".
pub fn misspelled_words(words: &[String], code: &str) -> Option<Vec<String>> {
    let dict = dictionary(code)?;
    Some(
        words
            .iter()
            .filter(|word| !dict.check(word))
            .cloned()
            .collect(),
    )
}

pub fn suggestions(word: &str, code: &str, limit: usize) -> Option<Vec<String>> {
    let dict = dictionary(code)?;
    if dict.check(word) {
        return Some(Vec::new()); // correctly spelled — nothing to suggest
    }
    let mut out = Vec::new();
    dict.suggest(word, &mut out);
    out.truncate(limit);
    Some(out)
}

// ── Record files (MyThes shape) ──

/// A file of `lemma|<line count>` headers, each followed by that many
/// `|`-separated field lines, after a first line naming the encoding. MyThes
/// uses this shape for thesauri; the generated Spanish definition database
/// reuses it so both can share one indexer.
///
/// Indexed by byte offset rather than read into memory: these files run to
/// tens of megabytes, which is a lot to hold resident for a right-click that
/// may never come.
struct RecordFile {
    path: PathBuf,
    /// Lowercased lemma -> byte offset of its header line.
    offsets: HashMap<String, u64>,
}

impl RecordFile {
    fn open(path: &Path) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(file);
        let mut offsets = HashMap::new();
        let mut offset = 0u64;
        let mut line = String::new();
        let mut skip_lines = 0usize;
        let mut first = true;

        loop {
            line.clear();
            let read = reader.read_line(&mut line).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            let start = offset;
            offset += read as u64;

            if first {
                first = false; // encoding header
                continue;
            }
            if skip_lines > 0 {
                skip_lines -= 1;
                continue;
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            let Some((lemma, count)) = trimmed.rsplit_once('|') else {
                continue;
            };
            let Ok(count) = count.trim().parse::<usize>() else {
                continue;
            };
            skip_lines = count;
            offsets.insert(lemma.to_lowercase(), start);
        }

        Ok(Self {
            path: path.to_path_buf(),
            offsets,
        })
    }

    /// The fields of each line belonging to `term`, or empty when unknown.
    fn lookup(&self, term: &str) -> Vec<Vec<String>> {
        let Some(&offset) = self.offsets.get(&term.trim().to_lowercase()) else {
            return Vec::new();
        };
        let Ok(file) = std::fs::File::open(&self.path) else {
            return Vec::new();
        };
        let mut reader = BufReader::new(file);
        if reader.seek(SeekFrom::Start(offset)).is_err() {
            return Vec::new();
        }

        let mut header = String::new();
        if reader.read_line(&mut header).is_err() {
            return Vec::new();
        }
        let count = header
            .trim_end_matches(['\r', '\n'])
            .rsplit_once('|')
            .and_then(|(_, count)| count.trim().parse::<usize>().ok())
            .unwrap_or(0);

        let mut rows = Vec::with_capacity(count);
        for _ in 0..count {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            rows.push(
                line.trim_end_matches(['\r', '\n'])
                    .split('|')
                    .map(str::trim)
                    .map(str::to_string)
                    .collect(),
            );
        }
        rows
    }
}

// ── Thesaurus ──

pub struct Thesaurus(RecordFile);

/// One sense of a word: the part of speech MyThes records, and its synonyms.
pub struct ThesaurusSense {
    pub part_of_speech: Option<String>,
    pub synonyms: Vec<String>,
}

/// MyThes writes "-" where it records no part of speech, and wraps real ones
/// in parentheses.
fn part_of_speech(field: &str) -> Option<String> {
    match field.trim() {
        "" | "-" => None,
        other => Some(other.trim_matches(['(', ')']).to_string()),
    }
}

impl Thesaurus {
    fn open(path: &Path) -> Result<Self, String> {
        RecordFile::open(path).map(Self)
    }

    pub fn lookup(&self, term: &str) -> Vec<ThesaurusSense> {
        self.0
            .lookup(term)
            .into_iter()
            .filter_map(|fields| {
                let synonyms: Vec<String> = fields
                    .iter()
                    .skip(1)
                    .filter(|s| !s.is_empty())
                    .cloned()
                    .collect();
                if synonyms.is_empty() {
                    return None;
                }
                Some(ThesaurusSense {
                    part_of_speech: part_of_speech(fields.first().map_or("", String::as_str)),
                    synonyms,
                })
            })
            .collect()
    }
}

// ── Definitions ──

pub struct Definitions(RecordFile);

/// One sense of a word: its part of speech, what it means, and the words
/// Wiktionary relates it to. MyThes carries no antonyms at all, so these are
/// the only ones Spanish has.
pub struct DefinitionSense {
    pub part_of_speech: Option<String>,
    pub text: String,
    pub synonyms: Vec<String>,
    pub antonyms: Vec<String>,
}

/// `a;b;c` -> ["a", "b", "c"], tolerating an empty field.
fn related(field: Option<&String>) -> Vec<String> {
    field
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

impl Definitions {
    fn open(path: &Path) -> Result<Self, String> {
        RecordFile::open(path).map(Self)
    }

    fn contains(&self, term: &str) -> bool {
        self.0.offsets.contains_key(&term.trim().to_lowercase())
    }

    pub fn lookup(&self, term: &str) -> Vec<DefinitionSense> {
        self.0
            .lookup(term)
            .into_iter()
            .filter_map(|fields| {
                let text = fields.get(1).cloned().unwrap_or_default();
                if text.is_empty() {
                    return None;
                }
                Some(DefinitionSense {
                    part_of_speech: part_of_speech(fields.first().map_or("", String::as_str)),
                    text,
                    synonyms: related(fields.get(2)),
                    antonyms: related(fields.get(3)),
                })
            })
            .collect()
    }
}

// ── Inflected forms ──

/// Most headwords one word is resolved to. "fueron" is a form of *ir*, *irse*
/// and *ser*; a fourth would push the useful ones out of the popover.
const MAX_HEADWORDS: usize = 3;

/// The headwords whose definitions answer `term`: the word itself when it has
/// an entry, then whatever it is an inflected form of. When that finds nothing,
/// regular patterns the Wiktionary tables don't list are undone and tried
/// again (see `spanish_candidates`).
pub fn headwords(code: &str, term: &str) -> Vec<String> {
    let Some(definitions) = definitions(code) else {
        return Vec::new();
    };
    let forms = forms(code);
    let resolve = |word: &str| -> Vec<String> {
        let mut found = Vec::new();
        if definitions.contains(word) {
            found.push(word.to_string());
        }
        for lemma in forms.map(|forms| forms.lookup(word)).unwrap_or_default() {
            if definitions.contains(&lemma)
                && !found
                    .iter()
                    .any(|f: &String| f.eq_ignore_ascii_case(&lemma))
            {
                found.push(lemma);
            }
        }
        found.truncate(MAX_HEADWORDS);
        found
    };

    let term = term.trim();
    let found = resolve(term);
    if !found.is_empty() || !code.to_lowercase().starts_with("es") {
        return found;
    }
    spanish_candidates(&term.to_lowercase())
        .iter()
        .map(|candidate| resolve(candidate))
        .find(|found| !found.is_empty())
        .unwrap_or_default()
}

/// Enclitic pronouns, longest first so "selo" is stripped whole.
const SPANISH_CLITICS: [&str; 25] = [
    "selos", "selas", "seles", "noslo", "nosla", "selo", "sela", "sele", "melo", "mela", "telo",
    "tela", "oslo", "osla", "los", "las", "les", "nos", "me", "te", "se", "lo", "la", "le", "os",
];

/// Guesses at the word a Spanish form comes from, for what the form tables
/// miss: participles agreeing in gender and number ("obtenidas"), adverbs in
/// -mente ("parcialmente"), and pronouns attached to a verb ("investigarse",
/// "diciéndolo"). Only ever tried when the word itself finds nothing, and each
/// guess must still land on a real headword, so a wrong one costs nothing.
fn spanish_candidates(word: &str) -> Vec<String> {
    fn unaccent(word: &str) -> String {
        word.chars()
            .map(|c| match c {
                'á' => 'a',
                'é' => 'e',
                'í' => 'i',
                'ó' => 'o',
                'ú' => 'u',
                other => other,
            })
            .collect()
    }

    let mut bases: Vec<String> = Vec::new();
    // Built on the feminine adjective: "claramente" -> "clara" -> *claro*.
    if let Some(stem) = word
        .strip_suffix("mente")
        .filter(|stem| stem.chars().count() >= 3)
    {
        bases.push(stem.to_string());
    }
    for clitic in SPANISH_CLITICS {
        let Some(stem) = word
            .strip_suffix(clitic)
            .filter(|stem| stem.chars().count() >= 3)
        else {
            continue;
        };
        // Attaching a pronoun often adds an accent: "diciéndolo", "dárselo".
        let plain = unaccent(stem);
        if ["ar", "er", "ir", "ndo", "ad", "ed", "id"]
            .iter()
            .any(|end| plain.ends_with(end))
        {
            if plain != stem {
                bases.push(stem.to_string());
            }
            bases.push(plain);
        }
    }
    bases.push(word.to_string());

    let mut candidates = bases.clone();
    for base in &bases {
        let singulars = [base.strip_suffix("es"), base.strip_suffix('s')];
        for singular in singulars.into_iter().flatten() {
            candidates.push(singular.to_string());
            if let Some(stem) = singular.strip_suffix('a') {
                candidates.push(format!("{stem}o"));
            }
        }
        if let Some(stem) = base.strip_suffix('a') {
            candidates.push(format!("{stem}o"));
        }
    }
    candidates.retain(|candidate| candidate != word && !candidate.is_empty());
    candidates
}

/// Expands the front-coded transfer format (see the build script) into one
/// `form|lemma;lemma` line per form, sorted by form, which `Forms` can search
/// without holding it in memory.
fn expand_forms(encoded: &str) -> Result<String, String> {
    /// `<digits><rest>` -> (digits, rest)
    fn split_count(field: &str) -> Option<(usize, &str)> {
        let digits = field.len() - field.trim_start_matches(|c: char| c.is_ascii_digit()).len();
        Some((field[..digits].parse().ok()?, &field[digits..]))
    }

    let mut out = String::with_capacity(encoded.len() * 3);
    let mut previous: Vec<char> = Vec::new();

    for (number, line) in encoded.lines().enumerate() {
        let bad = || format!("The forms file is malformed at line {}.", number + 1);
        let (form_field, lemma_field) = line.split_once('|').ok_or_else(bad)?;
        let (shared, rest) = split_count(form_field).ok_or_else(bad)?;
        if shared > previous.len() {
            return Err(bad());
        }
        let mut form: Vec<char> = previous[..shared].to_vec();
        form.extend(rest.chars());

        out.extend(form.iter());
        out.push('|');
        for (index, script) in lemma_field.split(';').enumerate() {
            let (drop, append) = split_count(script).ok_or_else(bad)?;
            if drop > form.len() {
                return Err(bad());
            }
            if index > 0 {
                out.push(';');
            }
            out.extend(form[..form.len() - drop].iter());
            out.push_str(append);
        }
        out.push('\n');
        previous = form;
    }
    Ok(out)
}

/// Sorted `form|lemma;lemma` lines, searched by bisecting the file on disk: a
/// quarter of a million entries is more than is worth keeping resident for
/// the occasional right-click.
pub struct Forms {
    path: PathBuf,
    len: u64,
}

impl Forms {
    fn open(path: &Path) -> Result<Self, String> {
        let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        Ok(Self {
            path: path.to_path_buf(),
            len,
        })
    }

    /// The headwords `term` is an inflected form of, or empty when it is not
    /// one (or is not known).
    pub fn lookup(&self, term: &str) -> Vec<String> {
        let key = term.trim().to_lowercase();
        if key.is_empty() {
            return Vec::new();
        }
        self.find(&key)
            .map(|lemmas| lemmas.split(';').map(str::to_string).collect())
            .unwrap_or_default()
    }

    fn find(&self, key: &str) -> Option<String> {
        let file = std::fs::File::open(&self.path).ok()?;
        let mut reader = BufReader::new(file);
        // Bytes, not `String`: a seek can land inside a multi-byte character,
        // and `read_line` would reject that partial line as invalid UTF-8.
        let mut line = Vec::new();
        let key = key.as_bytes();

        // Invariant: `lo` is the start of a line, and the matching line, if
        // any, starts in `lo..hi`.
        let (mut lo, mut hi) = (0u64, self.len);
        while hi - lo > 4096 {
            let mid = lo + (hi - lo) / 2;
            reader.seek(SeekFrom::Start(mid)).ok()?;
            line.clear();
            // Finish whichever line `mid` landed in; the next one starts at `next`.
            let next = mid + reader.read_until(b'\n', &mut line).ok()? as u64;
            if next >= hi {
                hi = mid + 1;
                continue;
            }
            line.clear();
            reader.read_until(b'\n', &mut line).ok()?;
            match form_of(&line).cmp(key) {
                std::cmp::Ordering::Equal => return lemmas_of(&line),
                std::cmp::Ordering::Less => lo = next,
                std::cmp::Ordering::Greater => hi = next,
            }
        }

        reader.seek(SeekFrom::Start(lo)).ok()?;
        let mut position = lo;
        while position < hi {
            line.clear();
            let read = reader.read_until(b'\n', &mut line).ok()?;
            if read == 0 {
                break;
            }
            position += read as u64;
            match form_of(&line).cmp(key) {
                std::cmp::Ordering::Equal => return lemmas_of(&line),
                std::cmp::Ordering::Greater => break,
                std::cmp::Ordering::Less => {}
            }
        }
        None
    }
}

fn form_of(line: &[u8]) -> &[u8] {
    line.iter()
        .position(|&b| b == b'|')
        .map_or(line, |bar| &line[..bar])
}

fn lemmas_of(line: &[u8]) -> Option<String> {
    let bar = line.iter().position(|&b| b == b'|')?;
    let lemmas = std::str::from_utf8(&line[bar + 1..]).ok()?;
    Some(lemmas.trim_end_matches(['\r', '\n']).to_string())
}

// ── Cached readers ──

/// The thesaurus for `code`, or `None` when no pack with one is installed.
pub fn thesaurus(code: &str) -> Option<&'static Thesaurus> {
    let mut caches = caches().lock().ok()?;
    if let Some(cached) = caches.thesauri.get(code) {
        return *cached;
    }
    let loaded = load_cached(code, "thesaurus.dat", Thesaurus::open, "thesaurus");
    caches.thesauri.insert(code.to_string(), loaded);
    loaded
}

/// The definition database for `code`, or `None` when the pack has none.
pub fn definitions(code: &str) -> Option<&'static Definitions> {
    let mut caches = caches().lock().ok()?;
    if let Some(cached) = caches.definitions.get(code) {
        return *cached;
    }
    let loaded = load_cached(code, "definitions.dat", Definitions::open, "definitions");
    caches.definitions.insert(code.to_string(), loaded);
    loaded
}

/// The form -> headword index for `code`, or `None` when there is none yet.
///
/// Packs installed before the index existed have definitions but no forms
/// file. Rather than asking the user to update a pack that seems to work, the
/// missing file (a few hundred KB) is fetched in the background on first use,
/// and lookups pick it up as soon as it lands.
pub fn forms(code: &str) -> Option<&'static Forms> {
    let pack = pack_for(code)?;
    let mut caches = caches().lock().ok()?;
    if let Some(cached) = caches.forms.get(pack.code) {
        return Some(*cached);
    }
    // Deliberately not caching a miss, so the background fetch takes effect.
    match load_cached(pack.code, FORMS_FILE, Forms::open, "forms") {
        Some(loaded) => {
            caches.forms.insert(pack.code.to_string(), loaded);
            Some(loaded)
        }
        None => {
            drop(caches);
            fetch_missing_forms(pack);
            None
        }
    }
}

fn fetch_missing_forms(pack: &'static LanguagePack) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    let Some(file) = &pack.forms else {
        return;
    };
    if !is_installed(pack.code) || STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let result = async {
            let client = reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(20))
                .read_timeout(std::time::Duration::from_secs(60))
                .build()
                .map_err(|e| e.to_string())?;
            let text = fetch_prepared(&client, file).await?;
            let dir = pack_dir(pack.code)?;
            // Written aside and renamed, so a lookup never reads half a file.
            let partial = dir.join(format!("{FORMS_FILE}.incoming"));
            std::fs::write(&partial, text).map_err(|e| e.to_string())?;
            std::fs::rename(&partial, dir.join(FORMS_FILE)).map_err(|e| e.to_string())
        }
        .await;
        if let Err(error) = result {
            eprintln!(
                "[language-packs] {} forms could not be fetched: {error}",
                pack.code
            );
            // Try again on a later lookup rather than never.
            STARTED.store(false, Ordering::SeqCst);
        }
    });
}

/// Opens `file_name` from `code`'s pack and leaks it, so it is read at most
/// once and stays valid for the rest of the process.
fn load_cached<T: 'static>(
    code: &str,
    file_name: &str,
    open: fn(&Path) -> Result<T, String>,
    label: &str,
) -> Option<&'static T> {
    let dir = pack_dir(code).ok()?;
    let path = dir.join(file_name);
    if !path.is_file() {
        return None;
    }
    match open(&path) {
        Ok(value) => Some(&*Box::leak(Box::new(value))),
        Err(error) => {
            eprintln!("[language-packs] {code} {label} failed to load: {error}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every language the picker offers must have an entry here, or choosing
    /// it would silently leave the user with no way to get a dictionary.
    /// Mirrors CHECK_LANGUAGES in src/stores/settings-store.ts.
    #[test]
    fn the_catalogue_covers_every_offered_language() {
        let codes: Vec<&str> = catalogue().iter().map(|p| p.code).collect();
        assert_eq!(codes, vec!["en-US", "en-GB", "en-CA", "en-AU", "es"]);
    }

    #[test]
    fn every_pack_names_an_affix_and_a_dictionary() {
        for pack in catalogue() {
            let stored: Vec<&str> = pack.spelling.iter().map(|s| s.stored_as).collect();
            assert_eq!(
                stored,
                vec!["spelling.aff", "spelling.dic"],
                "{}",
                pack.code
            );
            assert!(pack.approx_bytes > 0, "{}", pack.code);
        }
    }

    #[test]
    fn english_relies_on_wordnet_rather_than_a_second_thesaurus() {
        for pack in catalogue() {
            let english = pack.code.starts_with("en");
            assert_eq!(
                pack.thesaurus.is_none(),
                english,
                "{} thesaurus expectation",
                pack.code
            );
        }
    }

    #[test]
    fn lookup_is_case_insensitive_on_the_language_code() {
        assert!(pack_for("ES").is_some());
        assert!(pack_for("en-us").is_some());
        assert!(pack_for("klingon").is_none());
        // Withdrawn languages must not resolve, or a stale setting would keep
        // pointing at data the app no longer offers.
        assert!(pack_for("de").is_none());
        assert!(pack_for("pt-PT").is_none());
    }

    // ── Encoding ──

    #[test]
    fn a_utf8_byte_order_mark_is_stripped() {
        // en_GB.aff carries one; left in place it would corrupt the first
        // directive and the whole affix file with it.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"SET UTF-8\n");
        assert_eq!(decode(bytes), "SET UTF-8\n");
    }

    // ── Thesaurus ──

    fn write_thesaurus(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("thesaurus.dat");
        std::fs::write(&path, body).unwrap();
        path
    }

    const SAMPLE: &str = "UTF-8\n\
        análisis|2\n\
        (sustantivo)|estudio|examen|investigación\n\
        -|descomposición|separación\n\
        casa|1\n\
        (sustantivo)|vivienda|hogar|domicilio\n";

    #[test]
    fn thesaurus_reads_every_sense_of_a_word() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_thesaurus(tmp.path(), SAMPLE);
        let thesaurus = Thesaurus::open(&path).unwrap();

        let senses = thesaurus.lookup("análisis");
        assert_eq!(senses.len(), 2);
        assert_eq!(senses[0].part_of_speech.as_deref(), Some("sustantivo"));
        assert_eq!(
            senses[0].synonyms,
            vec!["estudio", "examen", "investigación"]
        );
        // "-" means the dictionary records no part of speech for that sense.
        assert_eq!(senses[1].part_of_speech, None);
        assert_eq!(senses[1].synonyms, vec!["descomposición", "separación"]);
    }

    #[test]
    fn thesaurus_finds_a_later_entry_by_its_own_offset() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_thesaurus(tmp.path(), SAMPLE);
        let thesaurus = Thesaurus::open(&path).unwrap();

        let senses = thesaurus.lookup("casa");
        assert_eq!(senses.len(), 1);
        assert_eq!(senses[0].synonyms, vec!["vivienda", "hogar", "domicilio"]);
    }

    #[test]
    fn thesaurus_matches_regardless_of_case() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_thesaurus(tmp.path(), SAMPLE);
        let thesaurus = Thesaurus::open(&path).unwrap();
        assert_eq!(thesaurus.lookup("CASA").len(), 1);
        assert_eq!(thesaurus.lookup("  casa  ").len(), 1);
    }

    const DEFINITIONS_SAMPLE: &str = "UTF-8\n\
        bueno|2\n\
        adj|Que tiene bondad en su corazón.|bondadoso;generoso|malo;malvado\n\
        noun|Persona de buen carácter.||\n\
        análisis|1\n\
        noun|La acción y el efecto de separar un todo en sus elementos.||\n";

    #[test]
    fn definitions_carry_their_related_words() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("definitions.dat");
        std::fs::write(&path, DEFINITIONS_SAMPLE).unwrap();
        let definitions = Definitions::open(&path).unwrap();

        let senses = definitions.lookup("bueno");
        assert_eq!(senses.len(), 2);
        assert_eq!(senses[0].part_of_speech.as_deref(), Some("adj"));
        assert_eq!(senses[0].text, "Que tiene bondad en su corazón.");
        assert_eq!(senses[0].synonyms, vec!["bondadoso", "generoso"]);
        // MyThes has no antonyms at all, so these are the only ones Spanish gets.
        assert_eq!(senses[0].antonyms, vec!["malo", "malvado"]);
    }

    #[test]
    fn a_sense_with_no_related_words_still_reads() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("definitions.dat");
        std::fs::write(&path, DEFINITIONS_SAMPLE).unwrap();
        let definitions = Definitions::open(&path).unwrap();

        let senses = definitions.lookup("análisis");
        assert_eq!(senses.len(), 1);
        assert!(senses[0].synonyms.is_empty());
        assert!(senses[0].antonyms.is_empty());
        assert!(senses[0].text.starts_with("La acción"));
    }

    #[test]
    fn a_definition_ending_in_a_number_is_not_read_as_a_header() {
        // "Número atómico 12" ends in `|<digits>`, exactly the shape of an
        // entry header; only tracking the declared line count keeps the index
        // from tearing the file apart from that point on.
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("definitions.dat");
        std::fs::write(
            &path,
            "UTF-8\nmagnesio|1\nnoun|Elemento químico de número atómico|12\nzinc|1\nnoun|Otro elemento.||\n",
        )
        .unwrap();
        let definitions = Definitions::open(&path).unwrap();
        assert_eq!(definitions.lookup("zinc").len(), 1);
        assert_eq!(definitions.0.offsets.len(), 2);
    }

    #[test]
    fn an_unknown_word_yields_no_senses() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_thesaurus(tmp.path(), SAMPLE);
        let thesaurus = Thesaurus::open(&path).unwrap();
        assert!(thesaurus.lookup("xyzzy").is_empty());
    }

    // ── Inflected forms ──

    #[test]
    fn front_coded_forms_expand_to_one_line_per_form() {
        // casas -> casa; casó -> casar; sugieren -> sugerir; fueron -> ir;ser
        let encoded = "0casas|1\n3ó|1ar\n0fueron|6ir;6ser\n0sugieren|5erir\n";
        assert_eq!(
            expand_forms(encoded).unwrap(),
            "casas|casa\ncasó|casar\nfueron|ir;ser\nsugieren|sugerir\n"
        );
    }

    #[test]
    fn malformed_forms_are_rejected_rather_than_misread() {
        assert!(expand_forms("0casas\n").is_err());
        assert!(expand_forms("9casas|1\n").is_err());
        assert!(expand_forms("0casas|9\n").is_err());
    }

    fn write_forms(dir: &Path, count: usize) -> (Forms, Vec<String>) {
        // Enough lines to exercise the bisection, with multi-byte characters
        // so seeks land mid-character.
        let mut words: Vec<String> = (0..count).map(|i| format!("ñandú{i:05}")).collect();
        words.push("árbol".into());
        words.push("sugieren".into());
        words.sort();
        let body: String = words.iter().map(|w| format!("{w}|lema-{w}\n")).collect();
        let path = dir.join(FORMS_FILE);
        std::fs::write(&path, body).unwrap();
        (Forms::open(&path).unwrap(), words)
    }

    #[test]
    fn every_form_is_found_by_bisection() {
        let tmp = tempfile::tempdir().unwrap();
        let (forms, words) = write_forms(tmp.path(), 5000);
        for word in &words {
            assert_eq!(forms.lookup(word), vec![format!("lema-{word}")], "{word}");
        }
    }

    #[test]
    fn unknown_forms_find_nothing_and_case_is_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let (forms, _) = write_forms(tmp.path(), 5000);
        assert_eq!(forms.lookup(" SUGIEREN "), vec!["lema-sugieren"]);
        for word in ["", "a", "ñandú", "ñandú99999", "zzz", "sugiere"] {
            assert!(forms.lookup(word).is_empty(), "{word}");
        }
    }

    #[test]
    fn spanish_guesses_undo_agreement_adverbs_and_pronouns() {
        let guesses = |word: &str| spanish_candidates(word);
        assert!(guesses("obtenidas").contains(&"obtenido".to_string()));
        assert!(guesses("parcialmente").contains(&"parcial".to_string()));
        assert!(guesses("claramente").contains(&"claro".to_string()));
        assert!(guesses("investigarse").contains(&"investigar".to_string()));
        assert!(guesses("diciéndolo").contains(&"diciendo".to_string()));
        assert!(guesses("dárselo").contains(&"dar".to_string()));
        assert!(guesses("conductuales").contains(&"conductual".to_string()));
        assert!(!guesses("casa").contains(&"casa".to_string()));
    }

    #[test]
    fn the_encoding_header_is_not_mistaken_for_an_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_thesaurus(tmp.path(), SAMPLE);
        let thesaurus = Thesaurus::open(&path).unwrap();
        assert!(thesaurus.lookup("UTF-8").is_empty());
        assert_eq!(thesaurus.0.offsets.len(), 2);
    }
}
