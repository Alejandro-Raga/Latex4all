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
//! Definitions are deliberately not part of this. MyThes records senses and
//! their synonyms but no glosses, so outside English — where WordNet and, on
//! macOS, Dictionary Services already answer — the popover shows synonyms and
//! says plainly that it has no definition.

use serde::Serialize;
use std::collections::HashMap;
use sha2::Digest;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, WebviewWindow};

/// LibreOffice's dictionary collection, pinned so the data can't change under
/// an installed app. Bump deliberately.
const DICTIONARIES_COMMIT: &str = "32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4";

fn raw_url(path: &str) -> String {
    format!("https://raw.githubusercontent.com/LibreOffice/dictionaries/{DICTIONARIES_COMMIT}/{path}")
}

/// How a source file is encoded. Hunspell declares this in the affix file's
/// `SET` line and MyThes on its first line; both are normalised to UTF-8 when
/// the pack is installed, so nothing downstream has to care.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SourceEncoding {
    Utf8,
    Latin1,
}

struct PackSource {
    /// Path within the LibreOffice repository.
    path: &'static str,
    encoding: SourceEncoding,
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
    thesaurus: Option<PackSource>,
    /// Definitions, where a usable source exists. English has WordNet already.
    definitions: Option<DefinitionSource>,
    /// Rounded total download, for the picker. Measured from the pinned commit.
    approx_bytes: u64,
}

fn aff(path: &'static str, encoding: SourceEncoding) -> PackSource {
    PackSource { path, encoding, stored_as: "spelling.aff" }
}

fn dic(path: &'static str, encoding: SourceEncoding) -> PackSource {
    PackSource { path, encoding, stored_as: "spelling.dic" }
}

fn thes(path: &'static str, encoding: SourceEncoding) -> PackSource {
    PackSource { path, encoding, stored_as: "thesaurus.dat" }
}

/// A gzipped record file built by `scripts/build-spanish-definitions.mjs` and
/// published as a release asset, rather than fetched from an upstream project
/// like everything else here — no one distributes Wiktionary in a form small
/// enough to download on demand, so the extract has to be prepared ahead of
/// time.
struct DefinitionSource {
    url: &'static str,
    sha256: &'static str,
    /// Shown in the language picker so the download size is not a surprise.
    approx_bytes: u64,
    /// CC BY-SA obliges us to say where it came from.
    attribution: &'static str,
}

fn catalogue() -> &'static [LanguagePack] {
    use SourceEncoding::{Latin1, Utf8};
    static CATALOGUE: OnceLock<Vec<LanguagePack>> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        vec![
            LanguagePack {
                code: "en-US",
                label: "English (US)",
                spelling: [aff("en/en_US.aff", Utf8), dic("en/en_US.dic", Utf8)],
                thesaurus: None,
                definitions: None,
                approx_bytes: 660_000,
            },
            LanguagePack {
                code: "en-GB",
                label: "English (UK)",
                spelling: [aff("en/en_GB.aff", Utf8), dic("en/en_GB.dic", Utf8)],
                thesaurus: None,
                definitions: None,
                approx_bytes: 1_270_000,
            },
            LanguagePack {
                code: "en-CA",
                label: "English (Canada)",
                spelling: [aff("en/en_CA.aff", Utf8), dic("en/en_CA.dic", Utf8)],
                thesaurus: None,
                definitions: None,
                approx_bytes: 560_000,
            },
            LanguagePack {
                code: "en-AU",
                label: "English (Australia)",
                spelling: [aff("en/en_AU.aff", Utf8), dic("en/en_AU.dic", Utf8)],
                thesaurus: None,
                definitions: None,
                approx_bytes: 560_000,
            },
            // English and Spanish only. Adding a language here means committing
            // to its spelling, grammar and lookup paths all working; see
            // CHECK_LANGUAGES in src/stores/settings-store.ts.
            LanguagePack {
                code: "es",
                label: "Spanish",
                spelling: [aff("es/es_ES.aff", Utf8), dic("es/es_ES.dic", Utf8)],
                // The only one of these still shipped as Latin-1.
                thesaurus: Some(thes("es/th_es_v2.dat", Latin1)),
                definitions: Some(DefinitionSource {
                    url: "https://github.com/Alejandro-Raga/Latex4all/releases/download/dictionary-data-v1/es-definitions.dat.gz",
                    sha256: "72f6d577633c7f693c9eec0bcc4f9938b733cf1997bb28b1a23efd6c6636b72b",
                    approx_bytes: 4_500_000,
                    attribution: "Definitions from Wiktionary (CC BY-SA 4.0)",
                }),
                approx_bytes: 8_260_000,
            },
        ]
    })
}

fn pack_for(code: &str) -> Option<&'static LanguagePack> {
    catalogue().iter().find(|p| p.code.eq_ignore_ascii_case(code))
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
                attribution: pack
                    .definitions
                    .as_ref()
                    .map(|source| source.attribution.to_string()),
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

/// Latin-1 maps one byte to one code point, which is the whole conversion.
/// Only UTF-8 and Latin-1 appear across the pinned files; anything else would
/// have to be added here deliberately rather than guessed at.
fn decode(bytes: Vec<u8>, encoding: SourceEncoding) -> String {
    match encoding {
        SourceEncoding::Latin1 => bytes.into_iter().map(|b| b as char).collect(),
        SourceEncoding::Utf8 => {
            let text = String::from_utf8_lossy(&bytes).into_owned();
            // A BOM would otherwise become part of the first keyword and make
            // the affix file's opening directive unparseable.
            text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text)
        }
    }
}

async fn fetch(client: &reqwest::Client, source: &PackSource) -> Result<String, String> {
    let url = raw_url(source.path);
    let response = client
        .get(&url)
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
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download of {} was interrupted: {e}", source.path))?;
    Ok(decode(bytes.to_vec(), source.encoding))
}

/// Downloads, verifies and decompresses the definition database.
async fn fetch_definitions(
    client: &reqwest::Client,
    source: &DefinitionSource,
) -> Result<String, String> {
    let response = client
        .get(source.url)
        .send()
        .await
        .map_err(|e| format!("Failed to download the definition database: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download the definition database: server returned HTTP {}",
            response.status()
        ));
    }
    let compressed = response
        .bytes()
        .await
        .map_err(|e| format!("Download of the definition database was interrupted: {e}"))?;

    let digest = format!("{:x}", sha2::Sha256::digest(&compressed));
    if digest != source.sha256 {
        return Err(format!(
            "The downloaded definition database does not match its expected checksum \
             (expected {}, got {digest}). Nothing was installed.",
            source.sha256
        ));
    }

    let mut text = String::new();
    flate2::read::GzDecoder::new(&compressed[..])
        .read_to_string(&mut text)
        .map_err(|e| format!("The definition database could not be decompressed: {e}"))?;
    Ok(text)
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
    let sources: Vec<&PackSource> = pack
        .spelling
        .iter()
        .chain(pack.thesaurus.iter())
        .collect();
    let total = sources.len();

    for (index, source) in sources.into_iter().enumerate() {
        emit(
            &window,
            pack.code,
            format!("Downloading {} ({} of {total})…", pack.label, index + 1),
            Some(((index * 100) / total) as u8),
        );
        downloaded.push((source.stored_as, fetch(&client, source).await?));
    }

    // The definition database is a prepared artifact rather than an upstream
    // file, so it is checksummed: nothing else would notice if it were served
    // truncated or replaced.
    if let Some(source) = &pack.definitions {
        emit(
            &window,
            pack.code,
            format!("Downloading {} definitions…", pack.label),
            Some(75),
        );
        downloaded.push(("definitions.dat", fetch_definitions(&client, source).await?));
    }

    emit(&window, pack.code, format!("Installing {}…", pack.label), Some(95));

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
        format!("The downloaded {} dictionary could not be read: {e}", pack.label)
    })?;

    let _ = std::fs::remove_dir_all(&dest);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    std::fs::rename(&staging, &dest)
        .map_err(|e| format!("Failed to install the {} pack: {e}", pack.label))?;

    forget_cached(pack.code);
    emit(&window, pack.code, format!("{} is ready.", pack.label), Some(100));
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
}

fn caches() -> &'static Mutex<Caches> {
    static CACHES: OnceLock<Mutex<Caches>> = OnceLock::new();
    CACHES.get_or_init(|| {
        Mutex::new(Caches {
            dictionaries: HashMap::new(),
            thesauri: HashMap::new(),
            definitions: HashMap::new(),
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
            assert_eq!(stored, vec!["spelling.aff", "spelling.dic"], "{}", pack.code);
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
    fn latin1_bytes_become_the_characters_they_stand_for() {
        // "función" in ISO8859-1: ó is a single byte 0xF3.
        let bytes = vec![b'f', b'u', b'n', b'c', b'i', 0xF3, b'n'];
        assert_eq!(decode(bytes, SourceEncoding::Latin1), "función");
    }

    #[test]
    fn a_utf8_byte_order_mark_is_stripped() {
        // en_GB.aff carries one; left in place it would corrupt the first
        // directive and the whole affix file with it.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"SET UTF-8\n");
        assert_eq!(decode(bytes, SourceEncoding::Utf8), "SET UTF-8\n");
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

    #[test]
    fn the_encoding_header_is_not_mistaken_for_an_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_thesaurus(tmp.path(), SAMPLE);
        let thesaurus = Thesaurus::open(&path).unwrap();
        assert!(thesaurus.lookup("UTF-8").is_empty());
        assert_eq!(thesaurus.0.offsets.len(), 2);
    }
}
