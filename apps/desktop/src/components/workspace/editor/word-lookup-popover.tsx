import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  BookOpenIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useDictionaryStore } from "@/stores/dictionary-store";
import { useLanguagePacksStore } from "@/stores/language-packs-store";
import { parseAntonyms } from "./parse-antonyms";
import { parseSynonyms } from "./parse-synonyms";
import { useViewportAnchoredPosition } from "./use-viewport-anchored-position";

interface WordLookupPopoverProps {
  term: string;
  language: string;
  /** True if the user has already marked `term` as not-a-typo. */
  isIgnored: boolean;
  /** Viewport-relative point (e.g. the right-click location) to anchor near. */
  anchor: { x: number; y: number };
  /** Called with the clicked synonym; the caller replaces `term` with it. */
  onReplace: (replacement: string) => void;
  /** Called to mark `term` as not-a-typo, going forward. */
  onIgnore: (word: string) => void;
  onDismiss: () => void;
}

interface DictionaryLookupResult {
  definition: string | null;
  /** Raw macOS Thesaurus prose, parsed client-side. Null when the structured
   * lists below are populated instead (Windows/Linux, or a Mac with no
   * Thesaurus enabled — both are served by the bundled WordNet database). */
  synonyms: string | null;
  synonymList: string[] | null;
  antonymList: string[] | null;
  /** False when no offline database could be opened, so "nothing found" is a
   * setup problem rather than a word without an entry. */
  databaseAvailable: boolean;
  /** Language code whose pack is missing — set instead of `databaseAvailable`
   * for a non-English document, where the fix is a language pack rather than
   * the English dictionary. */
  missingLanguagePack: string | null;
}

/** `dict://` is a macOS URL scheme; there is no Dictionary.app elsewhere. */
const HAS_SYSTEM_DICTIONARY_APP = navigator.userAgent.includes("Macintosh");

/** The Real Academia Española's dictionary is the authority for Spanish, but
 * it is copyrighted and has no licence that would let the app carry it. Link
 * out to it instead: the definitions shown here come from Wiktionary, and this
 * is one click to the official entry. */
const RAE_LOOKUP_URL = "https://dle.rae.es/";

/** Definitions from Dictionary Services can run long; keep the popover readable. */
const MAX_HEIGHT = 360;
const POPOVER_WIDTH = 320;

export function WordLookupPopover({
  term,
  language,
  isIgnored,
  anchor,
  onReplace,
  onIgnore,
  onDismiss,
}: WordLookupPopoverProps) {
  const [result, setResult] = useState<DictionaryLookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [spellingSuggestions, setSpellingSuggestions] = useState<string[]>([]);
  const { ref: popoverRef, coords } = useViewportAnchoredPosition(anchor);
  const installDictionary = useDictionaryStore((s) => s.install);
  const dictionaryInstalling = useDictionaryStore((s) => s.isInstalling);
  const dictionaryProgress = useDictionaryStore((s) => s.progress);
  const checkDictionaryStatus = useDictionaryStore((s) => s.checkStatus);
  const installLanguagePack = useLanguagePacksStore((s) => s.install);
  const languagePackInstalling = useLanguagePacksStore((s) => s.installing);
  const languagePackProgress = useLanguagePacksStore((s) => s.progress);
  const refreshLanguagePacks = useLanguagePacksStore((s) => s.refresh);
  const languagePack = useLanguagePacksStore((s) =>
    s.packs.find((pack) => pack.code === language),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    invoke<DictionaryLookupResult>("lookup_dictionary_definition", {
      term,
      language,
    })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, language]);

  useEffect(() => {
    let cancelled = false;
    setSpellingSuggestions([]);
    // Only a single word can meaningfully be "misspelled" — a multi-word
    // selection isn't something NSSpellChecker's word-range API applies to.
    // Skip the call entirely for a word the user already ignored.
    if (/\s/.test(term) || isIgnored) return;
    invoke<string[]>("get_spelling_suggestions", { word: term, language })
      .then((suggestions) => {
        if (!cancelled) setSpellingSuggestions(suggestions);
      })
      .catch(() => {
        if (!cancelled) setSpellingSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [term, language, isIgnored]);

  // WordNet returns synonyms and antonyms already structured; the macOS
  // Thesaurus only returns prose, which has to be parsed out.
  const synonyms = useMemo(() => {
    if (result?.synonymList) return result.synonymList;
    if (!result?.synonyms) return [];
    return parseSynonyms(result.synonyms, term);
  }, [result, term]);

  const antonyms = useMemo(() => {
    if (result?.antonymList) return result.antonymList;
    if (!result?.synonyms) return [];
    return parseAntonyms(result.synonyms, term);
  }, [result, term]);

  const missingPackCode = result?.missingLanguagePack ?? null;
  const isSpanish = language.toLowerCase().startsWith("es");

  useEffect(() => {
    if (missingPackCode) void refreshLanguagePacks();
  }, [missingPackCode, refreshLanguagePacks]);

  const rerunLookup = useCallback(
    () =>
      invoke<DictionaryLookupResult>("lookup_dictionary_definition", {
        term,
        language,
      }).then(setResult),
    [term, language],
  );

  const handleInstallLanguagePack = useCallback(() => {
    if (!missingPackCode) return;
    installLanguagePack(missingPackCode)
      .then(() => {
        toast.success(`${languagePack?.label ?? missingPackCode} is ready.`);
        return rerunLookup();
      })
      .catch((err) => {
        toast.error(`Could not install the language: ${err}`);
      });
  }, [installLanguagePack, missingPackCode, languagePack, rerunLookup]);

  // A pack downloaded before definitions existed still spell checks, so the
  // only symptom is a word with synonyms and no definition. Offer the fix
  // where that is actually noticed.
  const packNeedsUpdate =
    !loading &&
    !result?.definition &&
    !missingPackCode &&
    languagePack?.needsUpdate === true;

  const handleUpdateLanguagePack = useCallback(() => {
    if (!languagePack) return;
    installLanguagePack(languagePack.code)
      .then(() => {
        toast.success(`${languagePack.label} updated.`);
        return rerunLookup();
      })
      .catch((err) => toast.error(`Could not update: ${err}`));
  }, [installLanguagePack, languagePack, rerunLookup]);

  const handleInstallDictionary = useCallback(() => {
    installDictionary()
      .then(() => {
        toast.success("Dictionary installed.");
        // Re-run the lookup that came back empty, now that there is a
        // database behind it.
        return invoke<DictionaryLookupResult>("lookup_dictionary_definition", {
          term,
        }).then(setResult);
      })
      .catch((err) => {
        toast.error(`Could not install the dictionary: ${err}`);
      });
  }, [installDictionary, term]);

  const handleOpenInRae = useCallback(() => {
    shellOpen(`${RAE_LOOKUP_URL}${encodeURIComponent(term)}`).catch((err) => {
      console.error("Failed to open dle.rae.es", err);
    });
  }, [term]);

  const handleOpenInDictionary = useCallback(() => {
    shellOpen(`dict://${encodeURIComponent(term)}`).catch((err) => {
      console.error("Failed to open Dictionary.app", err);
    });
  }, [term]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // Delay attaching so the right-click that opened this popover doesn't also close it.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss]);

  const nothingFound =
    !loading &&
    !result?.definition &&
    synonyms.length === 0 &&
    antonyms.length === 0 &&
    spellingSuggestions.length === 0;

  // A build whose bundled database didn't make it into the installer would
  // otherwise report every word as having no entry, with nothing to act on.
  const databaseMissing =
    !loading && result !== null && !result.databaseAvailable;

  useEffect(() => {
    if (databaseMissing) void checkDictionaryStatus();
  }, [databaseMissing, checkDictionaryStatus]);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg border border-border bg-background shadow-xl"
      style={{
        width: POPOVER_WIDTH,
        top: coords ? coords.top : anchor.y,
        left: coords ? coords.left : anchor.x,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {term}
        </span>
        <button
          aria-label="Close"
          onClick={onDismiss}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div
        className="overflow-y-auto px-3 py-2 text-sm leading-relaxed"
        style={{ maxHeight: MAX_HEIGHT }}
      >
        {loading && (
          <p className="text-muted-foreground">Looking up "{term}"...</p>
        )}

        {spellingSuggestions.length > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="font-medium text-destructive text-xs uppercase tracking-wide">
                Possibly misspelled — click to fix
              </p>
              <button
                onClick={() => onIgnore(term)}
                className="shrink-0 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
              >
                Ignore
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {spellingSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onReplace(suggestion)}
                  className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive text-xs transition-colors hover:bg-destructive hover:text-primary-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && synonyms.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Synonyms — click to replace "{term}"
            </p>
            <div className="flex flex-wrap gap-1.5">
              {synonyms.map((syn) => (
                <button
                  key={syn}
                  onClick={() => onReplace(syn)}
                  className="rounded-full bg-muted px-2 py-0.5 text-foreground text-xs transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  {syn}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && antonyms.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Antonyms
            </p>
            <div className="flex flex-wrap gap-1.5">
              {antonyms.map((ant) => (
                <button
                  key={ant}
                  onClick={() => onReplace(ant)}
                  title={`Replace "${term}" with "${ant}"`}
                  className="rounded-full border border-muted-foreground/40 border-dashed px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:border-foreground hover:text-foreground"
                >
                  {ant}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading &&
          !result?.definition &&
          !missingPackCode &&
          synonyms.length > 0 &&
          languagePack?.offersDefinitions === false && (
            <p className="text-muted-foreground text-xs">
              This language has synonyms but no definitions yet.
            </p>
          )}

        {!loading && result?.definition && (
          <div>
            {(synonyms.length > 0 || antonyms.length > 0) && (
              <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Definition
              </p>
            )}
            <p className="whitespace-pre-wrap text-foreground">
              {result.definition}
            </p>
          </div>
        )}

        {nothingFound &&
          !databaseMissing &&
          !missingPackCode &&
          !packNeedsUpdate && (
            <p className="text-muted-foreground">
              No definition found for "{term}".
            </p>
          )}

        {packNeedsUpdate && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Your {languagePack?.label} download predates definitions.
            </p>
            <button
              onClick={handleUpdateLanguagePack}
              disabled={languagePackInstalling !== null}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-70"
            >
              {languagePackInstalling === languagePack?.code ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {languagePackProgress?.message ?? "Updating…"}
                </>
              ) : (
                <>
                  <DownloadIcon className="size-3.5" />
                  Update {languagePack?.label} to add definitions
                </>
              )}
            </button>
          </div>
        )}

        {missingPackCode && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              {languagePack?.label ?? missingPackCode} isn't downloaded yet, so
              there's nothing to look "{term}" up in.
            </p>
            <button
              onClick={handleInstallLanguagePack}
              disabled={languagePackInstalling !== null}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-70"
            >
              {languagePackInstalling === missingPackCode ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {languagePackProgress?.message ?? "Installing…"}
                </>
              ) : (
                <>
                  <DownloadIcon className="size-3.5" />
                  Download {languagePack?.label ?? missingPackCode}
                </>
              )}
            </button>
          </div>
        )}

        {databaseMissing && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              The offline dictionary isn't installed, so there's nothing to look
              "{term}" up in.
            </p>
            <button
              onClick={handleInstallDictionary}
              disabled={dictionaryInstalling}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-70"
            >
              {dictionaryInstalling ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {dictionaryProgress?.message ?? "Installing…"}
                </>
              ) : (
                <>
                  <DownloadIcon className="size-3.5" />
                  Install dictionary (about 16 MB)
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {(HAS_SYSTEM_DICTIONARY_APP || isSpanish) && (
        <div className="flex items-center gap-3 border-border border-t px-3 py-1.5">
          {HAS_SYSTEM_DICTIONARY_APP && (
            <button
              onClick={handleOpenInDictionary}
              className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3" />
              Open in Dictionary
            </button>
          )}
          {isSpanish && (
            <button
              onClick={handleOpenInRae}
              className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
              title="Look this word up in the Real Academia Española's dictionary"
            >
              <ExternalLinkIcon className="size-3" />
              Open in RAE
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
