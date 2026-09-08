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
use std::io::{BufRead, BufReader, Seek, SeekFrom};
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
                approx_bytes: 660_000,
            },
            LanguagePack {
                code: "en-GB",
                label: "English (UK)",
                spelling: [aff("en/en_GB.aff", Utf8), dic("en/en_GB.dic", Utf8)],
                thesaurus: None,
                approx_bytes: 1_270_000,
            },
            LanguagePack {
                code: "en-CA",
                label: "English (Canada)",
                spelling: [aff("en/en_CA.aff", Utf8), dic("en/en_CA.dic", Utf8)],
                thesaurus: None,
                approx_bytes: 560_000,
            },
            LanguagePack {
                code: "en-AU",
                label: "English (Australia)",
                spelling: [aff("en/en_AU.aff", Utf8), dic("en/en_AU.dic", Utf8)],
                thesaurus: None,
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
                approx_bytes: 3_760_000,
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
}

fn caches() -> &'static Mutex<Caches> {
    static CACHES: OnceLock<Mutex<Caches>> = OnceLock::new();
    CACHES.get_or_init(|| {
        Mutex::new(Caches {
            dictionaries: HashMap::new(),
            thesauri: HashMap::new(),
        })
    })
}

/// Drops what was cached for `code`, so installing or removing a pack takes
/// effect on the next keystroke rather than after a restart.
fn forget_cached(code: &str) {
    if let Ok(mut caches) = caches().lock() {
        caches.dictionaries.remove(code);
        caches.thesauri.remove(code);
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

// ── Thesaurus (MyThes) ──

/// A MyThes `.dat` file, indexed by byte offset rather than read into memory:
/// the German thesaurus is 30 MB, which is a lot to hold resident for a
/// right-click that may never come.
pub struct Thesaurus {
    path: PathBuf,
    /// Lowercased lemma -> byte offset of its header line.
    offsets: HashMap<String, u64>,
}

/// One sense of a word: the part of speech MyThes records, and its synonyms.
pub struct ThesaurusSense {
    pub part_of_speech: Option<String>,
    pub synonyms: Vec<String>,
}

impl Thesaurus {
    /// Scans the file once to record where each entry starts. The format is
    /// `lemma|<sense count>` followed by that many `pos|syn|syn|...` lines,
    /// after a first line naming the encoding (always UTF-8 here — packs are
    /// normalised on install).
    fn open(path: &Path) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(file);
        let mut offsets = HashMap::new();
        let mut offset = 0u64;
        let mut line = String::new();
        let mut skip_senses = 0usize;
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
            if skip_senses > 0 {
                skip_senses -= 1;
                continue;
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            let Some((lemma, count)) = trimmed.rsplit_once('|') else {
                continue;
            };
            let Ok(count) = count.trim().parse::<usize>() else {
                continue;
            };
            skip_senses = count;
            offsets.insert(lemma.to_lowercase(), start);
        }

        Ok(Self {
            path: path.to_path_buf(),
            offsets,
        })
    }

    pub fn lookup(&self, term: &str) -> Vec<ThesaurusSense> {
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

        let mut senses = Vec::with_capacity(count);
        for _ in 0..count {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            let mut fields = line.trim_end_matches(['\r', '\n']).split('|');
            // The first field is a part-of-speech tag like "(noun)", or "-"
            // in the dictionaries that don't record one.
            let pos = fields.next().unwrap_or("").trim();
            let synonyms: Vec<String> = fields
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            if synonyms.is_empty() {
                continue;
            }
            senses.push(ThesaurusSense {
                part_of_speech: match pos {
                    "" | "-" => None,
                    other => Some(other.trim_matches(['(', ')']).to_string()),
                },
                synonyms,
            });
        }
        senses
    }
}

/// The thesaurus for `code`, or `None` when no pack with one is installed.
pub fn thesaurus(code: &str) -> Option<&'static Thesaurus> {
    let mut caches = caches().lock().ok()?;
    if let Some(cached) = caches.thesauri.get(code) {
        return *cached;
    }
    let loaded = pack_dir(code).ok().and_then(|dir| {
        let path = dir.join("thesaurus.dat");
        if !path.is_file() {
            return None;
        }
        match Thesaurus::open(&path) {
            Ok(thesaurus) => Some(&*Box::leak(Box::new(thesaurus))),
            Err(error) => {
                eprintln!("[language-packs] {code} thesaurus failed to load: {error}");
                None
            }
        }
    });
    caches.thesauri.insert(code.to_string(), loaded);
    loaded
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
        assert_eq!(thesaurus.offsets.len(), 2);
    }
}
