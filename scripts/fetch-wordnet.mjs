#!/usr/bin/env node
/**
 * Downloads the Princeton WordNet 3.1 database into the desktop app's Tauri
 * resource directory, where `wordnet.rs` reads it at runtime.
 *
 * The database is ~27 MB of the ~16 MB tarball, which is too large to keep in
 * git, so every build (local and CI) fetches it first. Only the twelve files
 * lookups need are kept; the rest of the distribution (sentence frames, corpus
 * counts, source `dbfiles/`) is discarded.
 *
 * WordNet is distributed under Princeton's permissive BSD-style license, which
 * requires the copyright notice to be retained — it ships inside the 29-line
 * header of every database file, and is copied to LICENSE alongside them.
 *
 * Usage: node scripts/fetch-wordnet.mjs [--force]
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(ROOT, "apps/desktop/src-tauri/resources/wordnet");

const ARCHIVE_URL = "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz";
const ARCHIVE_SHA256 =
  "3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a";

const POS = ["noun", "verb", "adj", "adv"];
const FILES = [
  ...POS.map((p) => `index.${p}`),
  ...POS.map((p) => `data.${p}`),
  ...POS.map((p) => `${p}.exc`),
];

const force = process.argv.includes("--force");

if (!force && FILES.every((f) => existsSync(join(DEST, f)))) {
  console.log(
    `WordNet already present in ${DEST} — skipping (use --force to refetch)`,
  );
  process.exit(0);
}

console.log(`==> Downloading WordNet 3.1 from ${ARCHIVE_URL}`);
const response = await fetch(ARCHIVE_URL);
if (!response.ok) {
  console.error(
    `Download failed: HTTP ${response.status} ${response.statusText}`,
  );
  process.exit(1);
}
const archive = Buffer.from(await response.arrayBuffer());

const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== ARCHIVE_SHA256) {
  console.error(
    `Checksum mismatch for wn3.1.dict.tar.gz\n  expected ${ARCHIVE_SHA256}\n  got      ${digest}`,
  );
  process.exit(1);
}
console.log(`==> Verified sha256 ${digest}`);

const staging = mkdtempSync(join(tmpdir(), "wordnet-"));
try {
  const archivePath = join(staging, "wn31.tar.gz");
  writeFileSync(archivePath, archive);
  execFileSync("tar", ["xzf", archivePath, "-C", staging]);

  mkdirSync(DEST, { recursive: true });
  for (const file of FILES) {
    const source = join(staging, "dict", file);
    if (!existsSync(source)) {
      console.error(`Expected ${file} in the archive but it was missing`);
      process.exit(1);
    }
    // WordNet ships its files read-only (mode 444), which would make a
    // re-fetch fail on the overwrite — drop any previous copy first, then
    // restore writable permissions on ours.
    const target = join(DEST, file);
    rmSync(target, { force: true });
    copyFileSync(source, target);
    chmodSync(target, 0o644);
  }

  // Princeton ships the license as the header of each database file; lift it
  // out so the bundled resources carry a standalone copy.
  const header = readFileSync(join(DEST, "index.noun"), "utf8")
    .split("\n")
    .slice(0, 29)
    .map((line) => line.replace(/^\s{2}\d+\s?/, ""))
    .join("\n");
  writeFileSync(join(DEST, "LICENSE"), `${header.trim()}\n`);

  console.log(`==> WordNet installed to ${DEST} (${FILES.length} files)`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
