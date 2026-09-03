//! Live spelling checks using the macOS system spell checker (`NSSpellChecker`) —
//! the same engine behind Mail, Notes, Pages, TextEdit, etc. Public AppKit API,
//! respects the user's language/dictionary settings (including their personal
//! learned-words list) exactly like any other Mac app would.

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::NSSpellChecker;
    use objc2_foundation::{NSInteger, NSRange, NSString};
    use std::sync::OnceLock;

    /// NSNotFound == NSIntegerMax; AppKit/Foundation's standard "no match" sentinel.
    const NS_NOT_FOUND: usize = i64::MAX as usize;

    fn doc_tag() -> NSInteger {
        static TAG: OnceLock<NSInteger> = OnceLock::new();
        *TAG.get_or_init(NSSpellChecker::uniqueSpellDocumentTag)
    }

    /// Converts the app's canonical hyphenated language code (matching
    /// LanguageTool's format, e.g. "en-US") to NSSpellChecker's underscored
    /// form ("en_US"). "auto" (or empty) means "use the system default",
    /// same as omitting the language entirely.
    fn ns_language(language: &str) -> Option<objc2::rc::Retained<NSString>> {
        if language.is_empty() || language.eq_ignore_ascii_case("auto") {
            return None;
        }
        Some(NSString::from_str(&language.replace('-', "_")))
    }

    pub fn misspelled_words(words: &[String], language: &str) -> Vec<String> {
        let checker = NSSpellChecker::sharedSpellChecker();
        let lang = ns_language(language);
        words
            .iter()
            .filter(|word| {
                let ns_word = NSString::from_str(word);
                let range = unsafe {
                    checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(
                        &ns_word,
                        0,
                        lang.as_deref(),
                        false,
                        doc_tag(),
                        std::ptr::null_mut(),
                    )
                };
                range.location != NS_NOT_FOUND
            })
            .cloned()
            .collect()
    }

    pub fn suggestions(word: &str, language: &str) -> Vec<String> {
        let checker = NSSpellChecker::sharedSpellChecker();
        let lang = ns_language(language);
        let ns_word = NSString::from_str(word);

        let range = unsafe {
            checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(
                &ns_word,
                0,
                lang.as_deref(),
                false,
                doc_tag(),
                std::ptr::null_mut(),
            )
        };
        if range.location == NS_NOT_FOUND {
            return Vec::new(); // correctly spelled — nothing to suggest
        }

        let guesses = checker.guessesForWordRange_inString_language_inSpellDocumentWithTag(
            NSRange::new(0, ns_word.len_utf16()),
            &ns_word,
            lang.as_deref(),
            doc_tag(),
        );

        guesses
            .map(|arr| arr.iter().map(|s| s.to_string()).take(8).collect())
            .unwrap_or_default()
    }
}

/// Check a batch of (typically unique) words against `language` (e.g.
/// "en-US", "en-GB"; "auto" for the system default), returning just the
/// misspelled subset. Runs the OS calls on a blocking thread since
/// NSSpellChecker's dictionary lookups are synchronous native calls. macOS
/// only; empty elsewhere.
#[tauri::command]
pub async fn check_spelling(words: Vec<String>, language: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            macos::misspelled_words(&words, &language)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (words, language);
            Vec::new()
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Suggested corrections for a single word in `language` — empty if it's
/// actually spelled correctly (or there are no good guesses). macOS only;
/// empty elsewhere.
#[tauri::command]
pub async fn get_spelling_suggestions(
    word: String,
    language: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            macos::suggestions(&word, &language)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (word, language);
            Vec::new()
        }
    })
    .await
    .map_err(|e| e.to_string())
}
