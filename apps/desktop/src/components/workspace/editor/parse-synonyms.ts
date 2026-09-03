/**
 * Extracts a flat list of synonyms out of raw Oxford Thesaurus entry text
 * (as returned by macOS Dictionary Services), e.g.:
 *
 *   "happy adjective 1 Melissa came in looking happy and excited. contented,
 *   content, cheerful, ...; informal chirpy, ...; dated gay. ANTONYMS sad.
 *   2 we will be happy to advise you. willing, glad, ... ANTONYMS unwilling."
 *
 * The format interleaves example sentences, register/regional labels (a
 * bounded, known vocabulary), and comma/semicolon-separated synonym runs,
 * with no structural markup to tell them apart. We only trust chunks that
 * look list-like (several commas or a semicolon) and strip known labels —
 * this favors precision (fewer, correct synonyms) over recall.
 */

const REGISTER_LABEL =
  /^(chiefly\s+)?(british english|north american english|australian english|northern england|scottish english|irish english|new zealand english|south african english)?\s*(informal|formal|dated|rare|literary|humorous|archaic|old[- ]fashioned|technical|derogatory|offensive|vulgar slang|slang|dialect|poetic\/literary|euphemistic|figurative|especially|chiefly)?\s*/i;

const MAX_SYNONYMS = 60;
const MAX_ITEM_LENGTH = 40;

export function parseSynonyms(raw: string, term: string): string[] {
  let text = raw;

  // Drop the "<term> <part of speech>" header, e.g. "happy adjective".
  const headerPattern = new RegExp(
    `^\\s*${escapeRegExp(term)}\\s+(noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection)\\b\\.?\\s*`,
    "i",
  );
  text = text.replace(headerPattern, "");

  // Drop ANTONYMS sections entirely.
  text = text.replace(/\bANTONYMS\b[^.]*\.?/g, " ");

  // Drop sense-number markers ("1 ", "2 ", ...) that follow a sentence boundary.
  text = text.replace(/(^|\.\s+)\d+\s+/g, "$1");

  const seen = new Set<string>();
  const results: string[] = [];

  for (const sentence of text.split(".")) {
    const commaCount = (sentence.match(/,/g) ?? []).length;
    const semicolonCount = (sentence.match(/;/g) ?? []).length;
    const looksLikeList = semicolonCount >= 1 || commaCount >= 2;
    if (!looksLikeList) continue;

    for (const group of sentence.split(";")) {
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
        if (results.length >= MAX_SYNONYMS) return results;
      }
    }
  }

  return results;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
