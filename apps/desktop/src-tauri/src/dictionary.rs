//! Look up a word or phrase in the macOS system dictionary (Dictionary Services).
//!
//! Uses the public `DCSCopyTextDefinition` API (CoreServices framework), the same
//! mechanism behind the system-wide "Look Up" feature in Safari, Notes, TextEdit, etc.,
//! for the definition. `DCSCopyTextDefinition(NULL, ...)` only returns the *first*
//! matching dictionary though, not a merge of everything active — so if the user's
//! Thesaurus is enabled it's never actually consulted that way. To get synonyms we
//! separately enumerate the installed dictionaries (via the undocumented but stable
//! `DCSCopyAvailableDictionaries`, still shipped in CoreServices) to find the active
//! Thesaurus and query it directly.

use serde::Serialize;

#[derive(Serialize, Default)]
pub struct DictionaryLookupResult {
    /// Definition text from the user's primary active dictionary, if any.
    definition: Option<String>,
    /// Raw entry text from the user's active Thesaurus dictionary, if one is
    /// installed and has an entry for the term. The frontend parses this into
    /// a synonym list.
    synonyms: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::DictionaryLookupResult;
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

    pub fn lookup(term: &str) -> DictionaryLookupResult {
        let cf_term = CFString::new(term);
        let definition = define_with(std::ptr::null(), &cf_term);
        let synonyms = find_thesaurus().and_then(|dict| define_with(dict, &cf_term));
        DictionaryLookupResult {
            definition,
            synonyms,
        }
    }
}

/// Look up `term` in the system dictionary. macOS only; returns empty fields elsewhere.
#[tauri::command]
pub fn lookup_dictionary_definition(term: String) -> DictionaryLookupResult {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return DictionaryLookupResult::default();
    }

    #[cfg(target_os = "macos")]
    {
        macos::lookup(trimmed)
    }
    #[cfg(not(target_os = "macos"))]
    {
        DictionaryLookupResult::default()
    }
}
