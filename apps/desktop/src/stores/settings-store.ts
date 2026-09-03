import { create } from "zustand";
import { persist } from "zustand/middleware";

type CompilerBackend = "tectonic" | "texlive";

/** Codes match LanguageTool's format; converted to NSSpellChecker's
 * underscored form on the Rust side. Kept to a curated, verified set rather
 * than exposing every language either engine technically supports. */
export const CHECK_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-CA", label: "English (Canada)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt-PT", label: "Portuguese" },
] as const;

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
      checkLanguage: "en-US",
      setCheckLanguage: (language) => set({ checkLanguage: language }),
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
    }),
    {
      name: "claude-prism-settings",
    },
  ),
);
