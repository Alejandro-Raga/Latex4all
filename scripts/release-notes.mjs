#!/usr/bin/env node
// Release notes for both update channels.
//
// Release builds take their notes from CHANGELOG.md, which is written by hand:
// if the tag being built has no section, this exits non-zero and the build
// fails, so a release cannot ship with placeholder notes the way every build
// did before this existed.
//
// Test builds can't work that way — their versions are CI run numbers, so
// there is nothing to write an entry for ahead of time. Their notes are the
// commit subjects since the last stable release, which is also the window a
// tester actually cares about: everything in this build that isn't in the
// release they came from.
//
// Two output formats, because the two consumers are different: markdown for
// the GitHub release body, and plain text for the updater manifest, whose
// dialog renders notes in a pre-wrap box with no markdown support at all.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Commits listed in one set of notes before the rest are summarised away. */
export const MAX_COMMITS = 50;

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pull one version's section out of CHANGELOG.md.
 *
 * Headings are matched loosely — `## [1.4.0] - 2026-09-14`, `## 1.4.0` and the
 * `## \[1.4.0]` form the old upstream file used all count — because the cost of
 * being strict is a release that fails to build over a punctuation mismatch.
 * Returns null when the version has no section, which callers treat as fatal.
 */
export function extractChangelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const heading = new RegExp(
    `^##\\s+\\\\?\\[?v?${escapeForRegExp(version)}\\]?\\s*(?:[-–—]\\s*.*)?$`,
  );

  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

  return body.length > 0 ? body : null;
}

/** The most recent stable release tag, or null in a repo that has none yet. */
export function lastStableTag(runGit = git) {
  const tags = runGit(["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags[0] ?? null;
}

export function commitSubjects(range, runGit = git) {
  return runGit(["log", range, "--no-merges", "--pretty=format:%s"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Notes for a build that has no hand-written entry. Subjects are de-duplicated
 * because a cherry-pick or a rebase can land the same subject twice, and a
 * reader seeing the same line repeated assumes the notes are broken.
 */
export function commitNotes(subjects, sinceLabel) {
  const unique = [...new Set(subjects)];
  const header = sinceLabel
    ? `Changes since ${sinceLabel}:`
    : "Changes in this build:";

  if (unique.length === 0) {
    return `${header}\n\n- No code changes; rebuilt from the same commit.`;
  }

  const shown = unique.slice(0, MAX_COMMITS);
  const lines = shown.map((subject) => `- ${subject}`);
  const hidden = unique.length - shown.length;
  if (hidden > 0) lines.push(`- …and ${hidden} more.`);

  return `${header}\n\n${lines.join("\n")}`;
}

/**
 * Flatten markdown for the update dialog, which renders notes as pre-wrapped
 * plain text — leaving the markup in would show a reader literal `###` and
 * `**bold**` in the one place the notes are most likely to be read.
 */
export function toPlainText(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/`([^`]*)`/g, "$1")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function buildNotes({ channel, version, changelog, runGit = git }) {
  if (channel === "release") {
    const section = extractChangelogSection(changelog, version);
    if (!section) {
      throw new Error(
        `CHANGELOG.md has no section for ${version}. Add one before tagging — ` +
          `a release must not ship with placeholder notes.`,
      );
    }
    return section;
  }

  const since = lastStableTag(runGit);
  const range = since ? `${since}..HEAD` : "HEAD";
  return commitNotes(commitSubjects(range, runGit), since);
}

function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    args.set(argv[i].replace(/^--/, ""), argv[i + 1]);
  }

  const channel = args.get("channel");
  const version = args.get("version");
  const format = args.get("format") ?? "markdown";

  if (channel !== "release" && channel !== "test") {
    throw new Error(`--channel must be "release" or "test", got ${channel}`);
  }
  if (channel === "release" && !version) {
    throw new Error("--version is required for the release channel");
  }

  const changelog =
    channel === "release"
      ? readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")
      : "";

  const notes = buildNotes({ channel, version, changelog });
  process.stdout.write(`${format === "plain" ? toPlainText(notes) : notes}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
