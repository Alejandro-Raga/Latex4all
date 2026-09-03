import { buildExclusionMask } from "./latex-prose-mask";

/**
 * Produces a same-length projection of LaTeX source where non-prose regions
 * (math, commands, technical arguments, verbatim blocks) are blanked out
 * with spaces, and everything else is left untouched. Grammar checking needs
 * whole sentences for context (unlike spellcheck's per-word checks), so
 * instead of extracting only the prose words — which would shift every
 * position and require mapping offsets back — this keeps every character's
 * index identical to the original document. The grammar checker's reported
 * offsets can then be used directly against the editor's positions.
 */
export function sanitizeForGrammarCheck(text: string): string {
  const mask = buildExclusionMask(text);
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Preserve newlines/existing whitespace even inside excluded regions so
    // sentence and paragraph boundaries stay intact.
    result += mask[i] && ch !== "\n" && ch !== "\r" ? " " : ch;
  }
  return result;
}
