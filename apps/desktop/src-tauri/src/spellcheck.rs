//! Live spelling checks using whichever spell checker the OS already provides,
//! so the app respects the user's own language settings and learned words
//! rather than shipping a second, divergent dictionary.
//!
//! * macOS — `NSSpellChecker`, the engine behind Mail, Notes, Pages, TextEdit.
//! * Windows — the `ISpellChecker` COM API (Windows 8+), the engine behind Edge
//!   and the Windows text stack.
//!
//! Linux has no system-wide equivalent, so spell checking is inert there and
//! the grammar server's own typo detection carries that load instead.

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

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Globalization::{
        GetUserDefaultLocaleName, ISpellChecker, ISpellCheckerFactory, SpellCheckerFactory,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, IEnumString, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };

    /// Matches the macOS ceiling on how many corrections the popover shows.
    const MAX_SUGGESTIONS: usize = 8;
    /// `GetUserDefaultLocaleName` writes at most LOCALE_NAME_MAX_LENGTH wide chars.
    const LOCALE_NAME_MAX_LENGTH: usize = 85;

    thread_local! {
        /// COM is initialised per thread. Tauri's blocking pool reuses threads,
        /// so this runs a handful of times at most. We deliberately never call
        /// `CoUninitialize`: the cached spell checkers below outlive any single
        /// call and must stay valid for the life of the thread.
        static COM_INITIALIZED: Cell<bool> = const { Cell::new(false) };

        /// Creating a spell checker costs a COM activation, so keep one per
        /// requested language. `None` records a language this machine has no
        /// dictionary for, so we don't retry the lookup on every keystroke.
        static CHECKERS: RefCell<HashMap<String, Option<ISpellChecker>>> =
            RefCell::new(HashMap::new());
    }

    /// Null-terminated UTF-16, as every PCWSTR parameter here expects.
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Reads an owned COM string and releases it. Returns `None` for null.
    ///
    /// # Safety
    /// `ptr` must be a `PWSTR` returned by a COM call that transfers ownership
    /// to the caller (allocated with `CoTaskMemAlloc`).
    unsafe fn take_com_string(ptr: PWSTR) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let value = ptr.to_string().ok();
        CoTaskMemFree(Some(ptr.as_ptr() as *const _));
        value
    }

    fn ensure_com() {
        COM_INITIALIZED.with(|flag| {
            if flag.get() {
                return;
            }
            // MTA: these calls come off Tauri's blocking pool, which has no
            // message loop of its own to service an apartment-threaded object.
            // A failure here (including RPC_E_CHANGED_MODE, if something else
            // already put this thread in an STA) still leaves COM usable.
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            flag.set(true);
        });
    }

    fn factory() -> Option<ISpellCheckerFactory> {
        ensure_com();
        unsafe { CoCreateInstance(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER).ok() }
    }

    /// The BCP-47 tag the OS is configured for, used when the app's language is
    /// left on "auto".
    fn system_language() -> Option<String> {
        let mut buffer = [0u16; LOCALE_NAME_MAX_LENGTH];
        let len = unsafe { GetUserDefaultLocaleName(&mut buffer) };
        if len <= 1 {
            return None;
        }
        // The returned length counts the terminating null.
        String::from_utf16(&buffer[..(len as usize - 1)]).ok()
    }

    fn supported_languages(factory: &ISpellCheckerFactory) -> Vec<String> {
        let Ok(enumerator) = (unsafe { factory.SupportedLanguages() }) else {
            return Vec::new();
        };
        collect_strings(&enumerator, usize::MAX)
    }

    /// Drains an `IEnumString`, taking ownership of each returned string.
    fn collect_strings(enumerator: &IEnumString, limit: usize) -> Vec<String> {
        let mut out = Vec::new();
        while out.len() < limit {
            let mut item = [PWSTR::null(); 1];
            let mut fetched = 0u32;
            let hr = unsafe { enumerator.Next(&mut item, Some(&mut fetched)) };
            if hr.is_err() || fetched == 0 {
                break;
            }
            if let Some(value) = unsafe { take_com_string(item[0]) } {
                out.push(value);
            }
        }
        out
    }

    /// Pick the closest installed dictionary to `requested`.
    ///
    /// Windows dictionaries are region-qualified ("en-US", "pt-PT"), but the
    /// app offers bare tags like "es" and "de". So: take an exact match if the
    /// machine has one, otherwise any dictionary sharing the primary subtag —
    /// "de" lands on "de-DE", "en-CA" falls back to another English.
    fn resolve_language(factory: &ISpellCheckerFactory, requested: &str) -> Option<String> {
        let requested = if requested.is_empty() || requested.eq_ignore_ascii_case("auto") {
            system_language()?
        } else {
            requested.to_string()
        };

        let tag = wide(&requested);
        if let Ok(supported) = unsafe { factory.IsSupported(PCWSTR(tag.as_ptr())) } {
            if supported.as_bool() {
                return Some(requested);
            }
        }

        let primary = requested.split('-').next().unwrap_or(&requested);
        supported_languages(factory).into_iter().find(|lang| {
            lang.split('-')
                .next()
                .unwrap_or(lang)
                .eq_ignore_ascii_case(primary)
        })
    }

    /// Runs `f` with a spell checker for `language`, or returns `None` when the
    /// machine has no matching dictionary installed.
    fn with_checker<T>(language: &str, f: impl FnOnce(&ISpellChecker) -> T) -> Option<T> {
        ensure_com();
        CHECKERS.with(|cache| {
            let mut cache = cache.borrow_mut();
            let checker = cache.entry(language.to_string()).or_insert_with(|| {
                let factory = factory()?;
                let resolved = resolve_language(&factory, language)?;
                let tag = wide(&resolved);
                unsafe { factory.CreateSpellChecker(PCWSTR(tag.as_ptr())) }.ok()
            });
            checker.as_ref().map(f)
        })
    }

    /// True when the checker reports at least one error spanning `word`.
    fn is_misspelled(checker: &ISpellChecker, word: &str) -> bool {
        let text = wide(word);
        let Ok(errors) = (unsafe { checker.Check(PCWSTR(text.as_ptr())) }) else {
            return false;
        };
        let mut error = None;
        // `Next` yields S_FALSE with a null out-param once the list is drained.
        unsafe { errors.Next(&mut error) }.is_ok() && error.is_some()
    }

    pub fn misspelled_words(words: &[String], language: &str) -> Vec<String> {
        with_checker(language, |checker| {
            words
                .iter()
                .filter(|word| is_misspelled(checker, word))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
    }

    pub fn suggestions(word: &str, language: &str) -> Vec<String> {
        with_checker(language, |checker| {
            if !is_misspelled(checker, word) {
                return Vec::new(); // correctly spelled — nothing to suggest
            }
            let text = wide(word);
            let Ok(enumerator) = (unsafe { checker.Suggest(PCWSTR(text.as_ptr())) }) else {
                return Vec::new();
            };
            collect_strings(&enumerator, MAX_SUGGESTIONS)
        })
        .unwrap_or_default()
    }
}

/// The platform spell checker, or a no-op on systems without one.
mod backend {
    #[cfg(target_os = "macos")]
    pub use super::macos::{misspelled_words, suggestions};

    #[cfg(target_os = "windows")]
    pub use super::windows_impl::{misspelled_words, suggestions};

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn misspelled_words(_words: &[String], _language: &str) -> Vec<String> {
        Vec::new()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn suggestions(_word: &str, _language: &str) -> Vec<String> {
        Vec::new()
    }
}

/// Check a batch of (typically unique) words against `language` (e.g.
/// "en-US", "en-GB"; "auto" for the system default), returning just the
/// misspelled subset. Runs the OS calls on a blocking thread since both
/// platforms' dictionary lookups are synchronous native calls. Returns nothing
/// on platforms without a system spell checker.
#[tauri::command]
pub async fn check_spelling(words: Vec<String>, language: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || backend::misspelled_words(&words, &language))
        .await
        .map_err(|e| e.to_string())
}

/// Suggested corrections for a single word in `language` — empty if it's
/// actually spelled correctly (or there are no good guesses).
#[tauri::command]
pub async fn get_spelling_suggestions(
    word: String,
    language: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || backend::suggestions(&word, &language))
        .await
        .map_err(|e| e.to_string())
}
