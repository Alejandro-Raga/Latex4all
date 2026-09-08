#!/usr/bin/env node
/**
 * Builds the Spanish definition database that the Spanish language pack
 * downloads (see `language_packs.rs`).
 *
 * Source is the Spanish Wiktionary, via Tatu Ylonen's wiktextract as published
 * by kaikki.org. The published extract is ~1.4 GB because it carries
 * etymology, pronunciation, translations and inflection tables; the popover
 * needs none of that, and dropping it removes about 97%. Of what survives,
 * roughly five entries in six are inflected forms ("Forma del plural de
 * casa"), which say nothing a reader wants from a dictionary, so those go too.
 *
 * The result is a record file in the same shape as the MyThes thesaurus the
 * pack already reads: an encoding line, then `lemma|<sense count>` followed by
 * that many `pos|definition|synonyms|antonyms` lines, sorted by lemma. The
 * related-word lists are semicolon-separated and may be empty. They matter
 * because MyThes records no antonyms at all, so without them Spanish has none
 * while English gets them from WordNet.
 *
 * Wiktionary is licensed CC BY-SA; the app attributes it in Settings →
 * Languages, and the generated file must keep that licence.
 *
 * Usage:
 *   node scripts/build-spanish-definitions.mjs [--source <file|url>] [--out <dir>]
 */

import { createReadStream, createWriteStream, mkdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_URL =
  "https://kaikki.org/eswiktionary/Espa%C3%B1ol/kaikki.org-dictionary-Espa%C3%B1ol.jsonl";

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
      const word = (item?.word ?? "").replace(/[|;]/g, " ").replace(/\s+/g, " ").trim();
      if (word && !seen.includes(word) && seen.length < MAX_RELATED) seen.push(word);
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
    console.log(`==> Reading ${source} (${(statSync(source).size / 1048576).toFixed(0)} MB)`);
    return createReadStream(source);
  }
  console.log(`==> Streaming ${source}`);
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  if (total) console.log(`    ${(total / 1073741824).toFixed(2)} GB to read`);
  return Readable.fromWeb(response.body);
}

const { source, out } = parseArgs();
const stream = await openSource(source);

/** lemma -> [{ pos, gloss }] */
const entries = new Map();
let lines = 0;
let kept = 0;
let inflections = 0;
let withAntonyms = 0;
let bytesIn = 0;
let lastReport = Date.now();

stream.on("data", (chunk) => {
  bytesIn += chunk.length;
});

for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
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

  const senses = [];
  for (const sense of entry.senses ?? []) {
    if (isInflection(sense)) {
      inflections += 1;
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
    senses[0].synonyms.split(";").filter(Boolean).map((word) => ({ word })),
    entry.synonyms,
  );
  senses[0].antonyms = relatedWords(
    senses[0].antonyms.split(";").filter(Boolean).map((word) => ({ word })),
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
  console.error("No definitions were extracted — refusing to write an empty database.");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const target = join(out, "es-definitions.dat.gz");

// Sorted so the file is reproducible: the same input always yields the same
// bytes, which is what makes the published checksum meaningful.
const lemmas = [...entries.keys()].sort();
async function* records() {
  yield "UTF-8\n";
  for (const lemma of lemmas) {
    const senses = entries.get(lemma);
    yield `${lemma}|${senses.length}\n`;
    for (const { pos, gloss, synonyms, antonyms } of senses) {
      yield `${pos || "-"}|${gloss}|${synonyms}|${antonyms}\n`;
    }
  }
}

await pipeline(Readable.from(records()), createGzip({ level: 9 }), createWriteStream(target));

const size = statSync(target).size;
console.log(`==> Wrote ${target} (${(size / 1048576).toFixed(2)} MB gzipped)`);
console.log("    Source: Spanish Wiktionary via kaikki.org (wiktextract), CC BY-SA");
