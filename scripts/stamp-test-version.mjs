#!/usr/bin/env node
/**
 * Stamp a test-channel build version into tauri.conf.json.
 *
 * The updater compares the manifest's version against the version compiled
 * into the running app. Every testing-branch build otherwise reports the same
 * `1.0.0` as the last release, so the updater would see nothing newer and the
 * test channel would never deliver anything.
 *
 * The stamp is `<major>.<minor>.<CI run number>` — plain numeric, because the
 * NSIS and macOS bundlers reject semver prerelease suffixes in the bundle
 * version. Run numbers only ever increase, so test builds climb monotonically.
 *
 * Consequence worth knowing: test versions quickly outrun real releases (a
 * test build is 1.1.27 while the newest release is 1.1.1), so a test build can
 * contain *less* than a release with a lower number. The release channel will
 * not offer what looks to it like a downgrade, so leaving the test channel
 * goes through the explicit rollback in Settings -> Updates; Check now offers
 * it when it finds the machine ahead of the release.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const confPath = path.resolve(
  __dirname,
  "..",
  "apps",
  "desktop",
  "src-tauri",
  "tauri.conf.json",
);

const runNumber = process.env.GITHUB_RUN_NUMBER;
if (!runNumber) {
  console.error("GITHUB_RUN_NUMBER is not set — refusing to guess a version.");
  process.exit(1);
}

const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
const current = conf.version;
const match = /^(\d+)\.(\d+)\.\d+/.exec(current ?? "");
if (!match) {
  console.error(`Unexpected version in tauri.conf.json: ${current}`);
  process.exit(1);
}

const stamped = `${match[1]}.${match[2]}.${runNumber}`;
conf.version = stamped;
fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

console.log(`Stamped test-channel version: ${current} -> ${stamped}`);

// Surface it to later steps so the manifest and the binary cannot drift apart.
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `TEST_VERSION=${stamped}\n`);
}
