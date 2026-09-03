/**
 * Applies `source`'s capitalization pattern to `target` — UPPERCASE,
 * Capitalized, or lowercase — so replacing a word with a synonym doesn't
 * silently change the sentence's casing (e.g. "Happy" -> "Content", not
 * "Happy" -> "content").
 */
export function matchCase(source: string, target: string): string {
  const letters = source.replace(/[^a-zA-Z]/g, "");
  if (!letters) return target;

  // Require 2+ letters for "all uppercase" — a single capital is far more
  // likely a capitalized word (or pronoun "I") than deliberate ALL-CAPS.
  const isAllUpper =
    letters.length > 1 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase();
  if (isAllUpper) return target.toUpperCase();

  const isAllLower =
    letters === letters.toLowerCase() && letters !== letters.toUpperCase();
  if (isAllLower) return target;

  const firstCharIsUpper = /[A-Z]/.test(source.charAt(0));
  if (firstCharIsUpper) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }

  return target;
}
