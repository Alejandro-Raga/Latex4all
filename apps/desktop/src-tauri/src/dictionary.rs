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
use std::path::PathBuf;
use tauri::Manager;

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

/// Location of the bundled WordNet database. Resolved through Tauri so it works
/// both from a packaged bundle and from `tauri dev`, where resources are read
/// straight out of the source tree.
fn wordnet_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("resources/wordnet", tauri::path::BaseDirectory::Resource)
        .ok()
}

/// Look up `term`, filling in whatever the platform can provide.
#[tauri::command]
pub fn lookup_dictionary_definition(app: tauri::AppHandle, term: String) -> DictionaryLookupResult {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return DictionaryLookupResult::default();
    }

    #[cfg(target_os = "macos")]
    let (definition, thesaurus_entry) = macos::lookup(trimmed);
    #[cfg(not(target_os = "macos"))]
    let (definition, thesaurus_entry): (Option<String>, Option<String>) = (None, None);

    // WordNet covers whatever the system dictionary didn't. On Windows and
    // Linux that's everything; on macOS it's typically just the thesaurus half.
    let needs_wordnet = definition.is_none() || thesaurus_entry.is_none();
    let wordnet_entry = if needs_wordnet {
        wordnet_dir(&app)
            .and_then(|dir| WordNet::shared(&dir).ok())
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
    }
}
