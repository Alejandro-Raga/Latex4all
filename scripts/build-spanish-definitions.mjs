#!/usr/bin/env node
/**
 * Builds the prepared data files the Spanish language pack downloads (see
 * `language_packs.rs`), all brotli-compressed to keep the download small:
 *
 * - `es-definitions.dat.br` — definitions, synonyms and antonyms.
 * - `es-forms.dat.br` — which headword each inflected form belongs to, so a
 *   right-click on "sugieren" finds "sugerir".
 * - `es-thesaurus.dat.br` — LibreOffice's MyThes thesaurus, converted to
 *   UTF-8. Upstream serves it uncompressed (2.9 MB); this is about 0.4 MB.
 *
 * Definitions come from the Spanish Wiktionary, via Tatu Ylonen's wiktextract
 * as published by kaikki.org. The published extract is ~1.4 GB because it
 * carries etymology, pronunciation, translations and inflection tables; the
 * popover needs none of that, and dropping it removes about 97%.
 *
 * Inflected forms ("Forma del plural de casa") say nothing a reader wants from
 * a dictionary, so they get no definition of their own. But running text is
 * mostly inflected forms, so what they point at is kept: from the form's own
 * `form_of` link and from the conjugation and plural tables on the headword.
 *
 * The definition file is a record file in the same shape as the MyThes
 * thesaurus: an encoding line, then `lemma|<sense count>` followed by that many
 * `pos|definition|synonyms|antonyms` lines, sorted by lemma. The related-word
 * lists are semicolon-separated and may be empty.
 *
 * The forms file is sorted by form and front-coded, because a quarter of a
 * million near-identical words compress far better that way (~4x): each line
 * is `<chars shared with the previous form><rest of the form>|<lemmas>`, and
 * each `;`-separated lemma is `<chars to drop from the form's end><chars to
 * append>` — "sugieren" -> "5erir" -> "sugerir". The app expands it on install.
 *
 * Wiktionary is licensed CC BY-SA and the thesaurus LGPL 2.1; the app
 * attributes both, and the generated files keep those licences.
 *
 * Usage:
 *   node scripts/build-spanish-definitions.mjs [--source <file|url>] [--out <dir>]
 */

import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_URL =
  "https://kaikki.org/eswiktionary/Espa%C3%B1ol/kaikki.org-dictionary-Espa%C3%B1ol.jsonl";

/** Same pinned commit as `DICTIONARIES_COMMIT` in language_packs.rs. */
const THESAURUS_URL =
  "https://raw.githubusercontent.com/LibreOffice/dictionaries/32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4/es/th_es_v2.dat";

/** Senses beyond this are long-tail; the popover cannot show them all anyway. */
const MAX_SENSES_PER_WORD = 6;
/** Guards against a runaway gloss blowing up the record file. */
const MAX_GLOSS_CHARS = 400;

/**
 * An inflected form, whose "definition" only restates the grammar
 * ("Primera persona del singular del presente de indicativo de amigar").
 * wiktextract usually tags these, but the Spanish edition often only says so
 * in the gloss, so both signals are used.
 */
const INFLECTION_GLOSS =
  /^\s*(forma|flexi[oó]n|plural|singular|femenino|masculino|participio|gerundio|primera|segunda|tercera|infinitivo|imperativo|subjuntivo|indicativo)\b/i;

/** A single word: no spaces ("haber ladrado"), digits or delimiters. */
const FORM_WORD = /^[\p{L}\p{M}'’-]+$/u;
/** A lemma may contain spaces, but a digit would be misread as a length. */
const LEMMA_WORD = /^[\p{L}\p{M}'’ -]+$/u;

function isInflection(sense) {
  const tags = sense.tags ?? [];
  if (tags.includes("form-of") || tags.includes("inflection-of")) return true;
  const gloss = (sense.glosses ?? [])[0] ?? "";
  return INFLECTION_GLOSS.test(gloss);
}

/** `|` and newlines are the record format's own delimiters. */
function clean(gloss) {
  return gloss
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .trim()
    .slice(0, MAX_GLOSS_CHARS);
}

/** Most related words per sense; enough for the popover, and it keeps one
 * over-linked entry from dominating the file. */
const MAX_RELATED = 12;

/** `;` separates the list, `|` separates the fields — neither may survive
 * inside a word. */
function relatedWords(...lists) {
  const seen = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      const word = (item?.word ?? "")
        .replace(/[|;]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (word && !seen.includes(word) && seen.length < MAX_RELATED)
        seen.push(word);
    }
  }
  return seen.join(";");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  return {
    source: value("--source", SOURCE_URL),
    out: value("--out", join(ROOT, "build", "dictionaries")),
  };
}

async function openSource(source) {
  if (!/^https?:\/\//.test(source)) {
    console.log(
      `==> Reading ${source} (${(statSync(source).size / 1048576).toFixed(0)} MB)`,
    );
    return createReadStream(source);
  }
  console.log(`==> Streaming ${source}`);
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  if (total) console.log(`    ${(total / 1073741824).toFixed(2)} GB to read`);
  return Readable.fromWeb(response.body);
}

const { source, out } = parseArgs();
const stream = await openSource(source);

/** lemma -> [{ pos, gloss }] */
const entries = new Map();
/** lowercased form -> Set of lemmas it inflects */
const forms = new Map();
let lines = 0;
let kept = 0;
let inflections = 0;
let withAntonyms = 0;
let bytesIn = 0;
let lastReport = Date.now();

function addForm(form, lemma) {
  const key = form.trim().toLowerCase();
  if (!key || !lemma || key === lemma.toLowerCase()) return;
  if (!FORM_WORD.test(key) || !LEMMA_WORD.test(lemma)) return;
  if (!forms.has(key)) forms.set(key, new Set());
  forms.get(key).add(lemma);
}

stream.on("data", (chunk) => {
  bytesIn += chunk.length;
});

for await (const line of createInterface({
  input: stream,
  crlfDelay: Infinity,
})) {
  if (!line.trim()) continue;
  lines += 1;

  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue; // a truncated final line is not worth failing the build over
  }

  const word = entry.word;
  const pos = entry.pos ?? "";
  if (!word || word.includes("|")) continue;

  // Conjugation and plural tables on the headword itself.
  for (const { form } of entry.forms ?? []) {
    if (form) addForm(form, word);
  }

  const senses = [];
  for (const sense of entry.senses ?? []) {
    if (isInflection(sense)) {
      inflections += 1;
      for (const target of sense.form_of ?? []) {
        if (target?.word) addForm(word, target.word);
      }
      continue;
    }
    const gloss = clean((sense.glosses ?? []).join(" "));
    if (!gloss) continue;
    senses.push({
      gloss,
      synonyms: relatedWords(sense.synonyms),
      antonyms: relatedWords(sense.antonyms),
    });
  }
  if (senses.length === 0) continue;

  // Wiktionary often hangs synonyms and antonyms off the entry rather than a
  // particular sense; attach those to the first one so they are not lost.
  senses[0].synonyms = relatedWords(
    senses[0].synonyms
      .split(";")
      .filter(Boolean)
      .map((word) => ({ word })),
    entry.synonyms,
  );
  senses[0].antonyms = relatedWords(
    senses[0].antonyms
      .split(";")
      .filter(Boolean)
      .map((word) => ({ word })),
    entry.antonyms,
  );

  const existing = entries.get(word) ?? [];
  for (const sense of senses) {
    if (existing.length >= MAX_SENSES_PER_WORD) break;
    if (existing.some((e) => e.gloss === sense.gloss)) continue;
    existing.push({ pos, ...sense });
    kept += 1;
    if (sense.antonyms) withAntonyms += 1;
  }
  entries.set(word, existing);

  if (Date.now() - lastReport > 5000) {
    lastReport = Date.now();
    console.log(
      `    ${(bytesIn / 1073741824).toFixed(2)} GB · ${lines} entries read · ${entries.size} words kept`,
    );
  }
}

console.log(`==> Read ${lines} entries`);
console.log(`    ${entries.size} words with a real definition, ${kept} senses`);
console.log(`    ${inflections} inflected-form senses discarded`);
console.log(`    ${withAntonyms} senses carry antonyms`);

if (entries.size === 0) {
  console.error(
    "No definitions were extracted — refusing to write an empty database.",
  );
  process.exit(1);
}

mkdirSync(out, { recursive: true });

/** Sorted by UTF-8 bytes, the order the app's binary search assumes. */
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * Deterministic, so the same input always yields the same bytes — which is
 * what makes the published checksum meaningful.
 */
function writeBrotli(name, text) {
  const input = Buffer.from(text, "utf8");
  const compressed = brotliCompressSync(input, {
    params: {
      [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_TEXT,
      [zlib.BROTLI_PARAM_QUALITY]: zlib.BROTLI_MAX_QUALITY,
      [zlib.BROTLI_PARAM_LGWIN]: zlib.BROTLI_MAX_WINDOW_BITS,
      [zlib.BROTLI_PARAM_SIZE_HINT]: input.length,
    },
  });
  const target = join(out, name);
  writeFileSync(target, compressed);
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  console.log(
    `==> Wrote ${target}: ${(input.length / 1048576).toFixed(2)} MB -> ${(compressed.length / 1048576).toFixed(2)} MB`,
  );
  console.log(`    sha256 ${sha256}`);
}

// ── Definitions ──

const definitionLines = ["UTF-8\n"];
for (const lemma of [...entries.keys()].sort()) {
  const senses = entries.get(lemma);
  definitionLines.push(`${lemma}|${senses.length}\n`);
  for (const { pos, gloss, synonyms, antonyms } of senses) {
    definitionLines.push(`${pos || "-"}|${gloss}|${synonyms}|${antonyms}\n`);
  }
}
writeBrotli("es-definitions.dat.br", definitionLines.join(""));

// ── Forms ──

/** Only forms that lead somewhere: a lemma with no definition is no help. */
const headwords = new Set([...entries.keys()].map((w) => w.toLowerCase()));

/** "sugieren", "sugerir" -> "5erir": drop five characters, append "erir". */
function editScript(form, lemma) {
  const a = Array.from(form);
  const b = Array.from(lemma);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) {
    shared += 1;
  }
  return `${a.length - shared}${b.slice(shared).join("")}`;
}

const formLines = [];
let previous = [];
let formCount = 0;
for (const form of [...forms.keys()].sort(byBytes)) {
  const lemmas = [...forms.get(form)]
    .filter((lemma) => headwords.has(lemma.toLowerCase()))
    .sort();
  if (lemmas.length === 0) continue;

  const chars = Array.from(form);
  let shared = 0;
  while (
    shared < chars.length &&
    shared < previous.length &&
    chars[shared] === previous[shared]
  ) {
    shared += 1;
  }
  formLines.push(
    `${shared}${chars.slice(shared).join("")}|${lemmas.map((lemma) => editScript(form, lemma)).join(";")}\n`,
  );
  previous = chars;
  formCount += 1;
}
console.log(`    ${formCount} inflected forms lead to a headword`);
writeBrotli("es-forms.dat.br", formLines.join(""));

// ── Thesaurus ──

console.log(`==> Fetching ${THESAURUS_URL}`);
const thesaurusResponse = await fetch(THESAURUS_URL);
if (!thesaurusResponse.ok) {
  throw new Error(
    `Thesaurus download failed: HTTP ${thesaurusResponse.status}`,
  );
}
// The only one of LibreOffice's files still shipped as Latin-1. Buffer's
// "latin1" is true ISO-8859-1, as in the app; TextDecoder's is Windows-1252.
const thesaurus = Buffer.from(await thesaurusResponse.arrayBuffer())
  .toString("latin1")
  .replace(/^[^\n]*\n/, "UTF-8\n");
writeBrotli("es-thesaurus.dat.br", thesaurus);

console.log(
  "    Sources: Spanish Wiktionary via kaikki.org (wiktextract), CC BY-SA; " +
    "OpenThesaurus-es via LibreOffice, LGPL 2.1",
);
