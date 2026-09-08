import { create } from "zustand";
import { persist } from "zustand/middleware";

type CompilerBackend = "tectonic" | "texlive";

/** Which release feed the updater follows.
 *  - "release": tagged, non-prerelease builds only (GitHub's `releases/latest`)
 *  - "test":    every build published from the `testing` branch
 *  `null` means the user has not been asked yet — the first-run picker keys
 *  off this, so it must stay distinct from a real choice. */
export type UpdateChannel = "release" | "test";

/** Codes match LanguageTool's format; converted to NSSpellChecker's
 * underscored form on the Rust side.
 *
 * English and Spanish only, deliberately. Offering a language means the
 * spelling, grammar and lookup paths all have to hold up in it, and French,
 * German and Portuguese were listed without that being true — the popover had
 * no definitions for them and, until language packs, Windows silently checked
 * no spelling either. They come back when they can be supported properly.
 * Keep in step with `catalogue()` in src-tauri/src/language_packs.rs. */
export const CHECK_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-CA", label: "English (Canada)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "es", label: "Spanish" },
] as const;

const DEFAULT_CHECK_LANGUAGE = "en-US";

/** A language that has since been withdrawn would otherwise stay selected,
 * leaving the picker blank and the checkers pointed at something the app no
 * longer supports. */
function supportedCheckLanguage(code: unknown): string {
  return CHECK_LANGUAGES.some((language) => language.code === code)
    ? (code as string)
    : DEFAULT_CHECK_LANGUAGE;
}

interface SettingsState {
  compilerBackend: CompilerBackend;
  setCompilerBackend: (backend: CompilerBackend) => void;
  vimMode: boolean;
  setVimMode: (enabled: boolean) => void;
  grammarCheckEnabled: boolean;
  setGrammarCheckEnabled: (enabled: boolean) => void;
  grammarCheckServerUrl: string;
  setGrammarCheckServerUrl: (url: string) => void;
  /** Shared by the spellchecker and the grammar checker so a word that's
   * correct in one dialect isn't flagged just because the other engine
   * defaulted to a different one. */
  checkLanguage: string;
  setCheckLanguage: (language: string) => void;
  /** Words the user has explicitly marked "not a typo" (proper nouns,
   * technical terms, ...) — lowercased, deduped, shared by both checkers. */
  ignoredWords: string[];
  addIgnoredWord: (word: string) => void;
  removeIgnoredWord: (word: string) => void;
  /** Kept independent per viewer — toggling dark mode in one shouldn't affect the others. */
  pdfDarkModeMain: boolean;
  setPdfDarkModeMain: (enabled: boolean) => void;
  pdfDarkModeReference: boolean;
  setPdfDarkModeReference: (enabled: boolean) => void;
  pdfDarkModeInline: boolean;
  setPdfDarkModeInline: (enabled: boolean) => void;
  /** null until the first-run picker has been answered. */
  updateChannel: UpdateChannel | null;
  setUpdateChannel: (channel: UpdateChannel) => void;
  /** Whether to check on launch at all. Both channels still prompt before
   *  downloading — this only governs the automatic check. */
  autoCheckForUpdates: boolean;
  setAutoCheckForUpdates: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      compilerBackend: "tectonic",
      setCompilerBackend: (backend) => set({ compilerBackend: backend }),
      vimMode: false,
      setVimMode: (enabled) => set({ vimMode: enabled }),
      // Off by default — only ever talks to a server the user runs
      // themselves (e.g. `brew install languagetool`), never a cloud
      // service, but shouldn't make even a localhost call without opt-in.
      grammarCheckEnabled: false,
      setGrammarCheckEnabled: (enabled) =>
        set({ grammarCheckEnabled: enabled }),
      grammarCheckServerUrl: "http://localhost:8081",
      setGrammarCheckServerUrl: (url) => set({ grammarCheckServerUrl: url }),
      checkLanguage: DEFAULT_CHECK_LANGUAGE,
      setCheckLanguage: (language) =>
        set({ checkLanguage: supportedCheckLanguage(language) }),
      ignoredWords: [],
      addIgnoredWord: (word) =>
        set((state) => {
          const key = word.toLowerCase();
          if (state.ignoredWords.includes(key)) return state;
          return { ignoredWords: [...state.ignoredWords, key] };
        }),
      removeIgnoredWord: (word) =>
        set((state) => ({
          ignoredWords: state.ignoredWords.filter(
            (w) => w !== word.toLowerCase(),
          ),
        })),
      pdfDarkModeMain: false,
      setPdfDarkModeMain: (enabled) => set({ pdfDarkModeMain: enabled }),
      pdfDarkModeReference: false,
      setPdfDarkModeReference: (enabled) =>
        set({ pdfDarkModeReference: enabled }),
      pdfDarkModeInline: false,
      setPdfDarkModeInline: (enabled) => set({ pdfDarkModeInline: enabled }),
      updateChannel: null,
      setUpdateChannel: (channel) => set({ updateChannel: channel }),
      autoCheckForUpdates: true,
      setAutoCheckForUpdates: (enabled) =>
        set({ autoCheckForUpdates: enabled }),
    }),
    {
      name: "latex4all-settings",
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as object) };
        return {
          ...merged,
          checkLanguage: supportedCheckLanguage(merged.checkLanguage),
        };
      },
    },
  ),
);
