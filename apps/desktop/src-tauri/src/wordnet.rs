//! Offline dictionary/thesaurus backed by the Princeton WordNet 3.1 database.
//!
//! macOS gets definitions and synonyms from Dictionary Services (see
//! `dictionary.rs`), but Windows ships no comparable API — and Linux has none
//! either. WordNet fills that gap: the `dict/` database files are bundled as a
//! Tauri resource and read directly here, so lookups work fully offline.
//!
//! Only the four index/data/exception file sets are shipped (`noun`, `verb`,
//! `adj`, `adv`); the rest of the WordNet distribution (sentence frames, corpus
//! counts, source `dbfiles/`) is not needed for lookups.
//!
//! File formats are documented in WordNet's `wndb(5)` and `morphy(7)` man pages.
//! The short version:
//!
//! * `index.<pos>` — ASCII-sorted, one lemma per line, after a fixed 29-line
//!   license header:
//!   `lemma pos synset_cnt p_cnt [ptr_symbol...] sense_cnt tagsense_cnt offset...`
//! * `data.<pos>` — records addressed by the byte offsets from the index:
//!   `offset lex_filenum ss_type w_cnt word lex_id... p_cnt [ptr...] | gloss`
//! * `<pos>.exc` — irregular inflections: `inflected base [base...]`

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Every WordNet index and data file opens with the same 29-line license
/// banner. Binary search has to start below it.
const HEADER_LINES: usize = 29;

/// Ceilings on what a single lookup will return, so a very common word can't
/// produce an unreadable wall of text in the popover.
const MAX_SENSES: usize = 8;
const MAX_SYNONYMS: usize = 60;
const MAX_ANTONYMS: usize = 30;
/// Adjective synonyms come mostly from "similar to" satellites; following every
/// one of them for a word like "good" explodes the list, so cap the expansion.
const MAX_SIMILAR_SYNSETS: usize = 12;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Pos {
    Noun,
    Verb,
    Adj,
    Adv,
}

impl Pos {
    const ALL: [Pos; 4] = [Pos::Noun, Pos::Verb, Pos::Adj, Pos::Adv];

    /// Suffix used by the on-disk file names (`index.noun`, `noun.exc`, ...).
    fn file_suffix(self) -> &'static str {
        match self {
            Pos::Noun => "noun",
            Pos::Verb => "verb",
            Pos::Adj => "adj",
            Pos::Adv => "adv",
        }
    }

    /// Human-readable part of speech, matching how the macOS dictionary labels
    /// its entries so the popover reads the same on both platforms.
    fn label(self) -> &'static str {
        match self {
            Pos::Noun => "noun",
            Pos::Verb => "verb",
            Pos::Adj => "adjective",
            Pos::Adv => "adverb",
        }
    }

    /// `ss_type` characters in `data.<pos>`. Adjectives use both `a` (head) and
    /// `s` (satellite), and pointers can name either.
    fn from_ss_type(c: char) -> Option<Pos> {
        match c {
            'n' => Some(Pos::Noun),
            'v' => Some(Pos::Verb),
            'a' | 's' => Some(Pos::Adj),
            'r' => Some(Pos::Adv),
            _ => None,
        }
    }
}

/// One sense of a word: its gloss and any usage examples WordNet records.
pub struct Sense {
    /// The lemma the search term actually resolved to. A search for "geese"
    /// lands on "goose", and the entry should be headed by the real word.
    pub lemma: String,
    pub pos: Pos,
    pub gloss: String,
    pub examples: Vec<String>,
}

#[derive(Default)]
pub struct Entry {
    pub senses: Vec<Sense>,
    pub synonyms: Vec<String>,
    pub antonyms: Vec<String>,
}

impl Entry {
    pub fn is_empty(&self) -> bool {
        self.senses.is_empty() && self.synonyms.is_empty() && self.antonyms.is_empty()
    }
}

/// A parsed `data.<pos>` record — only the fields lookups actually use.
struct Synset {
    /// Synset members, in file order, already de-underscored.
    words: Vec<String>,
    /// `(symbol, offset, pos, source_word, target_word)`. Word numbers are
    /// 1-based; `0` on both means the pointer applies to the whole synset.
    pointers: Vec<(String, u64, Pos, usize, usize)>,
    gloss: String,
    examples: Vec<String>,
}

pub struct WordNet {
    dir: PathBuf,
    /// `index.<pos>` contents, loaded on first use. Together they are ~6 MB,
    /// small enough to keep resident and far simpler than seeking the files.
    indexes: Mutex<HashMap<&'static str, &'static [u8]>>,
    /// `<pos>.exc` irregular-inflection tables, loaded on first use.
    exceptions: Mutex<HashMap<&'static str, &'static HashMap<String, Vec<String>>>>,
}

impl WordNet {
    /// `dir` is the bundled `wordnet/` resource directory holding the database
    /// files. Fails fast if it doesn't look like a WordNet install.
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self, String> {
        let dir = dir.into();
        if !dir.join("index.noun").is_file() {
            return Err(format!(
                "WordNet database not found at {} (missing index.noun)",
                dir.display()
            ));
        }
        Ok(Self {
            dir,
            indexes: Mutex::new(HashMap::new()),
            exceptions: Mutex::new(HashMap::new()),
        })
    }

    /// Process-wide instance for the bundled database at `dir`. Returns the
    /// same `Err` on every call if the resource is missing, rather than
    /// retrying the filesystem on each keystroke.
    pub fn shared(dir: &Path) -> Result<&'static WordNet, String> {
        static INSTANCE: OnceLock<Result<WordNet, String>> = OnceLock::new();
        INSTANCE
            .get_or_init(|| WordNet::open(dir))
            .as_ref()
            .map_err(|e| e.clone())
    }

    // ── File access ──

    /// Index files are leaked deliberately: they are loaded at most once each,
    /// live for the rest of the process, and a `&'static [u8]` keeps the
    /// binary-search code free of lifetime plumbing behind the mutex.
    fn index(&self, pos: Pos) -> Result<&'static [u8], String> {
        let key = pos.file_suffix();
        let mut cache = self
            .indexes
            .lock()
            .map_err(|_| "WordNet index cache poisoned".to_string())?;
        if let Some(bytes) = cache.get(key) {
            return Ok(bytes);
        }
        let path = self.dir.join(format!("index.{key}"));
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        let leaked: &'static [u8] = Box::leak(bytes.into_boxed_slice());
        cache.insert(key, leaked);
        Ok(leaked)
    }

    /// Same leaking rationale as `index`; the exception tables total ~100 KB.
    fn exceptions(&self, pos: Pos) -> Result<&'static HashMap<String, Vec<String>>, String> {
        let key = pos.file_suffix();
        let mut cache = self
            .exceptions
            .lock()
            .map_err(|_| "WordNet exception cache poisoned".to_string())?;
        if let Some(table) = cache.get(key) {
            return Ok(table);
        }
        let path = self.dir.join(format!("{key}.exc"));
        let mut table: HashMap<String, Vec<String>> = HashMap::new();
        if let Ok(file) = File::open(&path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                let mut parts = line.split_whitespace();
                if let Some(inflected) = parts.next() {
                    let bases: Vec<String> = parts.map(str::to_string).collect();
                    if !bases.is_empty() {
                        table.insert(inflected.to_string(), bases);
                    }
                }
            }
        }
        let leaked: &'static HashMap<String, Vec<String>> = Box::leak(Box::new(table));
        cache.insert(key, leaked);
        Ok(leaked)
    }

    /// Read the single `data.<pos>` record starting at `offset`.
    fn read_synset(&self, pos: Pos, offset: u64) -> Option<Synset> {
        let path = self.dir.join(format!("data.{}", pos.file_suffix()));
        let mut file = File::open(path).ok()?;
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut reader = BufReader::new(&mut file);
        let mut line = Vec::new();
        // Records are one line each; a truncated read still parses whatever
        // arrived, so an unexpected EOF degrades instead of erroring.
        read_line_bytes(&mut reader, &mut line).ok()?;
        parse_synset(&String::from_utf8_lossy(&line))
    }

    // ── Lookup ──

    /// Definitions, synonyms and antonyms for `term`. Unknown words yield an
    /// empty `Entry` rather than an error — the caller renders "no entry".
    pub fn lookup(&self, term: &str) -> Entry {
        let normalized = normalize_term(term);
        if normalized.is_empty() {
            return Entry::default();
        }

        let mut entry = Entry::default();
        let mut seen_synonyms = LowercaseSet::new(&normalized);
        let mut seen_antonyms = LowercaseSet::new(&normalized);

        for pos in Pos::ALL {
            // Try the word as typed first, then morphological base forms, so
            // "running" finds "run" but "saw" still prefers the noun "saw".
            let Some((lemma, offsets)) = self.resolve(pos, &normalized) else {
                continue;
            };

            for offset in offsets {
                let Some(synset) = self.read_synset(pos, offset) else {
                    continue;
                };
                let word_number = synset
                    .words
                    .iter()
                    .position(|w| w.eq_ignore_ascii_case(&lemma))
                    .map(|i| i + 1);

                let sense_synonyms: Vec<String> = synset
                    .words
                    .iter()
                    .filter(|w| !w.eq_ignore_ascii_case(&lemma))
                    .cloned()
                    .collect();

                if entry.senses.len() < MAX_SENSES {
                    entry.senses.push(Sense {
                        lemma: lemma.replace('_', " "),
                        pos,
                        gloss: synset.gloss.clone(),
                        examples: synset.examples.clone(),
                    });
                }

                for word in sense_synonyms {
                    seen_synonyms.push(&mut entry.synonyms, word, MAX_SYNONYMS);
                }

                self.follow_pointers(
                    &synset,
                    word_number,
                    &mut entry,
                    &mut seen_synonyms,
                    &mut seen_antonyms,
                );
            }
        }

        entry
    }

    /// Expand a synset's pointers: `!` gives antonyms, and for adjectives `&`
    /// ("similar to") supplies the synonyms a head synset otherwise lacks —
    /// "happy" alone is a one-word synset, but its satellites hold "blissful",
    /// "blithe", "content" and so on.
    fn follow_pointers(
        &self,
        synset: &Synset,
        word_number: Option<usize>,
        entry: &mut Entry,
        seen_synonyms: &mut LowercaseSet,
        seen_antonyms: &mut LowercaseSet,
    ) {
        let mut similar_followed = 0usize;

        for (symbol, target_offset, target_pos, source_word, target_word) in &synset.pointers {
            match symbol.as_str() {
                "!" => {
                    // Antonymy is lexical: the pointer belongs to one specific
                    // word of the synset. Skip it when it isn't ours.
                    if *source_word != 0 {
                        match word_number {
                            Some(n) if n == *source_word => {}
                            _ => continue,
                        }
                    }
                    let Some(target) = self.read_synset(*target_pos, *target_offset) else {
                        continue;
                    };
                    let words: Vec<String> = if *target_word == 0 {
                        target.words.clone()
                    } else {
                        target
                            .words
                            .get(*target_word - 1)
                            .cloned()
                            .into_iter()
                            .collect()
                    };
                    for word in words {
                        seen_antonyms.push(&mut entry.antonyms, word, MAX_ANTONYMS);
                    }
                }
                "&" => {
                    if similar_followed >= MAX_SIMILAR_SYNSETS {
                        continue;
                    }
                    similar_followed += 1;
                    let Some(target) = self.read_synset(*target_pos, *target_offset) else {
                        continue;
                    };
                    for word in target.words {
                        seen_synonyms.push(&mut entry.synonyms, word, MAX_SYNONYMS);
                    }
                }
                _ => {}
            }
        }
    }

    /// Find the index entry for `term` under `pos`, trying the surface form
    /// first and then Morphy base forms. Returns the lemma that matched
    /// alongside its synset offsets.
    fn resolve(&self, pos: Pos, term: &str) -> Option<(String, Vec<u64>)> {
        for candidate in self.base_forms(pos, term) {
            if let Some(offsets) = self.index_lookup(pos, &candidate) {
                return Some((candidate, offsets));
            }
        }
        None
    }

    /// Morphy: the exception list for irregular forms, plus the standard
    /// suffix-detachment rules. Candidates are returned in preference order,
    /// starting with the word exactly as given.
    fn base_forms(&self, pos: Pos, term: &str) -> Vec<String> {
        let mut candidates = vec![term.to_string()];

        if let Ok(exceptions) = self.exceptions(pos) {
            if let Some(bases) = exceptions.get(term) {
                candidates.extend(bases.iter().cloned());
            }
        }

        for (suffix, replacement) in detachment_rules(pos) {
            if let Some(stem) = term.strip_suffix(suffix) {
                // WordNet's rules never strip a word down to nothing.
                if !stem.is_empty() {
                    candidates.push(format!("{stem}{replacement}"));
                }
            }
        }

        candidates.dedup();
        candidates
    }

    /// Binary search `index.<pos>` for `lemma`, returning its synset offsets.
    fn index_lookup(&self, pos: Pos, lemma: &str) -> Option<Vec<u64>> {
        let data = self.index(pos).ok()?;
        let start = header_end(data);
        let line = binary_search_line(data, start, lemma.as_bytes())?;
        parse_index_line(&String::from_utf8_lossy(line))
    }
}

// ── Parsing helpers ──

/// Lowercases and underscores a search term the way WordNet stores lemmas
/// ("New York" → "new_york"), and drops anything that isn't a word character.
fn normalize_term(term: &str) -> String {
    term.trim()
        .to_lowercase()
        .chars()
        .filter_map(|c| match c {
            c if c.is_alphanumeric() => Some(c),
            ' ' | '_' | '-' | '.' | '\'' => Some(if c == ' ' { '_' } else { c }),
            _ => None,
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

/// Morphy's suffix-detachment table, as `(suffix, replacement)` pairs applied
/// in order. Adverbs have no rules.
fn detachment_rules(pos: Pos) -> &'static [(&'static str, &'static str)] {
    match pos {
        Pos::Noun => &[
            ("ses", "s"),
            ("xes", "x"),
            ("zes", "z"),
            ("ches", "ch"),
            ("shes", "sh"),
            ("men", "man"),
            ("ies", "y"),
            ("s", ""),
        ],
        Pos::Verb => &[
            ("ies", "y"),
            ("es", "e"),
            ("es", ""),
            ("ed", "e"),
            ("ed", ""),
            ("ing", "e"),
            ("ing", ""),
            ("s", ""),
        ],
        Pos::Adj => &[("est", ""), ("est", "e"), ("er", ""), ("er", "e")],
        Pos::Adv => &[],
    }
}

/// Byte offset of the first line after WordNet's 29-line license header.
fn header_end(data: &[u8]) -> usize {
    let mut offset = 0usize;
    for _ in 0..HEADER_LINES {
        match data[offset..].iter().position(|&b| b == b'\n') {
            Some(i) => offset += i + 1,
            None => return data.len(),
        }
    }
    offset
}

/// Binary search a newline-delimited, ASCII-sorted region for the line whose
/// first space-delimited field equals `key`.
fn binary_search_line<'a>(data: &'a [u8], start: usize, key: &[u8]) -> Option<&'a [u8]> {
    let mut lo = start;
    let mut hi = data.len();

    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        // Land on a line boundary: walk back to just after the previous newline.
        let line_start = match data[start..mid].iter().rposition(|&b| b == b'\n') {
            Some(i) => start + i + 1,
            None => start,
        };
        let line_end = match data[line_start..].iter().position(|&b| b == b'\n') {
            Some(i) => line_start + i,
            None => data.len(),
        };
        let line = &data[line_start..line_end];
        let field = line.split(|&b| b == b' ').next().unwrap_or(line);

        match field.cmp(key) {
            std::cmp::Ordering::Equal => return Some(line),
            std::cmp::Ordering::Less => {
                // Everything up to and including this line is too small.
                let next = line_end + 1;
                if next <= lo {
                    return None;
                }
                lo = next;
            }
            std::cmp::Ordering::Greater => {
                if line_start <= start && hi <= line_start {
                    return None;
                }
                if line_start == hi {
                    return None;
                }
                hi = line_start;
            }
        }
    }
    None
}

/// `lemma pos synset_cnt p_cnt [ptr_symbol...] sense_cnt tagsense_cnt offset...`
fn parse_index_line(line: &str) -> Option<Vec<u64>> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    // lemma, pos, synset_cnt, p_cnt is the minimum before the pointer symbols.
    let synset_cnt: usize = fields.get(2)?.parse().ok()?;
    let p_cnt: usize = fields.get(3)?.parse().ok()?;
    // Skip p_cnt pointer symbols, then sense_cnt and tagsense_cnt.
    let offsets_start = 4 + p_cnt + 2;
    let offsets: Vec<u64> = fields
        .get(offsets_start..)?
        .iter()
        .filter_map(|f| f.parse::<u64>().ok())
        .take(synset_cnt)
        .collect();
    if offsets.is_empty() {
        None
    } else {
        Some(offsets)
    }
}

/// `offset lex_filenum ss_type w_cnt word lex_id... p_cnt [ptr...] | gloss`
///
/// Verb records carry a sentence-frame block between the pointers and the
/// gloss; it is skipped implicitly by reading only the fields we name and then
/// jumping to the `|` delimiter.
fn parse_synset(line: &str) -> Option<Synset> {
    let (head, gloss_part) = match line.split_once('|') {
        Some((head, gloss)) => (head, gloss.trim()),
        None => (line, ""),
    };

    let fields: Vec<&str> = head.split_whitespace().collect();
    // Field 2 is the ss_type; parsing it is how we reject a malformed record.
    Pos::from_ss_type(fields.get(2)?.chars().next()?)?;
    let w_cnt = usize::from_str_radix(fields.get(3)?, 16).ok()?;

    let mut words = Vec::with_capacity(w_cnt);
    let mut cursor = 4;
    for _ in 0..w_cnt {
        let word = fields.get(cursor)?;
        words.push(clean_word(word));
        cursor += 2; // skip the lex_id that follows each word
    }

    let p_cnt: usize = fields.get(cursor)?.parse().ok()?;
    cursor += 1;

    let mut pointers = Vec::with_capacity(p_cnt);
    for _ in 0..p_cnt {
        let symbol = fields.get(cursor)?;
        let offset: u64 = fields.get(cursor + 1)?.parse().ok()?;
        let pos = Pos::from_ss_type(fields.get(cursor + 2)?.chars().next()?)?;
        let source_target = fields.get(cursor + 3)?;
        // Four hex digits: two for the source word number, two for the target.
        let source_word = usize::from_str_radix(source_target.get(0..2)?, 16).ok()?;
        let target_word = usize::from_str_radix(source_target.get(2..4)?, 16).ok()?;
        pointers.push((symbol.to_string(), offset, pos, source_word, target_word));
        cursor += 4;
    }

    let (gloss, examples) = split_gloss(gloss_part);

    Some(Synset {
        words,
        pointers,
        gloss,
        examples,
    })
}

/// Strips WordNet's syntactic-position markers from an adjective, and turns
/// collocation underscores back into spaces: `well-chosen`, `happy(p)` → `happy`.
fn clean_word(word: &str) -> String {
    let base = match word.find('(') {
        Some(i) => &word[..i],
        None => word,
    };
    base.replace('_', " ")
}

/// A gloss is `definition; "example"; "example"` — quoted segments are usage
/// examples, everything else belongs to the definition.
fn split_gloss(gloss: &str) -> (String, Vec<String>) {
    let mut definition_parts: Vec<String> = Vec::new();
    let mut examples: Vec<String> = Vec::new();

    for segment in gloss.split(';') {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('"') {
            examples.push(trimmed.trim_matches('"').trim().to_string());
        } else if examples.is_empty() {
            // Once examples start, later unquoted fragments are continuations
            // of an example (an example can itself contain a semicolon).
            definition_parts.push(trimmed.to_string());
        } else if let Some(last) = examples.last_mut() {
            last.push_str("; ");
            last.push_str(trimmed.trim_matches('"'));
        }
    }

    (definition_parts.join("; "), examples)
}

/// Reads one `\n`-terminated line as raw bytes.
fn read_line_bytes(reader: &mut impl BufRead, out: &mut Vec<u8>) -> std::io::Result<usize> {
    let mut byte = [0u8; 1];
    let mut count = 0;
    while reader.read(&mut byte)? == 1 {
        count += 1;
        if byte[0] == b'\n' {
            break;
        }
        out.push(byte[0]);
    }
    Ok(count)
}

/// Case-insensitive dedupe that also suppresses the search term itself.
struct LowercaseSet {
    seen: std::collections::HashSet<String>,
}

impl LowercaseSet {
    fn new(term: &str) -> Self {
        let mut seen = std::collections::HashSet::new();
        seen.insert(term.replace('_', " ").to_lowercase());
        Self { seen }
    }

    fn push(&mut self, out: &mut Vec<String>, word: String, limit: usize) {
        if out.len() >= limit {
            return;
        }
        let key = word.to_lowercase();
        if self.seen.insert(key) {
            out.push(word);
        }
    }
}

/// Renders an `Entry`'s senses the way the macOS dictionary presents them, so
/// the popover can show one shape of text regardless of platform.
pub fn format_definition(entry: &Entry) -> Option<String> {
    if entry.senses.is_empty() {
        return None;
    }

    let mut out = String::new();
    let mut current_heading: Option<(String, Pos)> = None;
    let mut sense_number = 0usize;

    for sense in &entry.senses {
        let heading = (sense.lemma.clone(), sense.pos);
        if current_heading.as_ref() != Some(&heading) {
            if current_heading.is_some() {
                out.push_str("\n\n");
            }
            out.push_str(&sense.lemma);
            out.push(' ');
            out.push_str(sense.pos.label());
            current_heading = Some(heading);
            sense_number = 0;
        }
        sense_number += 1;
        out.push_str(&format!("\n{sense_number}. {}", sense.gloss));
        for example in &sense.examples {
            out.push_str(&format!("\n   \"{example}\""));
        }
    }

    Some(out)
}
