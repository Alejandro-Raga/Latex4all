/**
 * Extracts a flat list of antonyms out of raw Oxford Thesaurus entry text
 * (as returned by macOS Dictionary Services), e.g.:
 *
 *   "happy adjective 1 Melissa came in looking happy and excited. contented,
 *   content, cheerful, ...; informal chirpy, ...; dated gay. ANTONYMS sad.
 *   2 we will be happy to advise you. willing, glad, ... ANTONYMS unwilling."
 *
 * Unlike parseSynonyms (which strips ANTONYMS sections out), this pulls just
 * those sections and parses their comma/semicolon-separated word lists the
 * same way — trusting only list-like chunks and stripping known register
 * labels (informal, dated, etc.).
 */

const REGISTER_LABEL =
  /^(chiefly\s+)?(british english|north american english|australian english|northern england|scottish english|irish english|new zealand english|south african english)?\s*(informal|formal|dated|rare|literary|humorous|archaic|old[- ]fashioned|technical|derogatory|offensive|vulgar slang|slang|dialect|poetic\/literary|euphemistic|figurative|especially|chiefly)?\s*/i;

const MAX_ANTONYMS = 30;
const MAX_ITEM_LENGTH = 40;

export function parseAntonyms(raw: string, term: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  // Each ANTONYMS section runs from the word ANTONYMS up to the next
  // sentence boundary, e.g. "ANTONYMS sad, unhappy." or "ANTONYMS unwilling."
  const sectionPattern = /\bANTONYMS\b([^.]*)\.?/g;
  for (const match of raw.matchAll(sectionPattern)) {
    const section = match[1];
    for (const group of section.split(";")) {
      const cleaned = group.replace(REGISTER_LABEL, "").trim();
      for (const rawItem of cleaned.split(",")) {
        const item = rawItem.trim().replace(/\s+/g, " ");
        if (
          !item ||
          item.length > MAX_ITEM_LENGTH ||
          item.toLowerCase() === term.toLowerCase()
        ) {
          continue;
        }
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
        if (results.length >= MAX_ANTONYMS) return results;
      }
    }
  }

  return results;
}
