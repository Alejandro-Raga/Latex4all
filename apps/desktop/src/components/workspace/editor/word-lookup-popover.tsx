import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { BookOpenIcon, ExternalLinkIcon, XIcon } from "lucide-react";
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
}

/** `dict://` is a macOS URL scheme; there is no Dictionary.app elsewhere. */
const HAS_SYSTEM_DICTIONARY_APP = navigator.userAgent.includes("Macintosh");

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    invoke<DictionaryLookupResult>("lookup_dictionary_definition", { term })
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
  }, [term]);

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

        {nothingFound && (
          <p className="text-muted-foreground">
            No definition found for "{term}".
          </p>
        )}
      </div>

      {HAS_SYSTEM_DICTIONARY_APP && (
        <div className="border-border border-t px-3 py-1.5">
          <button
            onClick={handleOpenInDictionary}
            className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3" />
            Open in Dictionary
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
