# Changelog

Notes for released versions of Latex4All.

**This file is load-bearing.** When CI builds a release tag it pulls out the
section matching that version and uses it for both the GitHub release body and
the notes shown in the app's update dialog. If the section is missing or empty
the build fails on purpose, so a release cannot ship with placeholder notes.

Test-channel builds are deliberately *not* listed here — their versions are CI
run numbers, so there is nothing to write in advance. Their notes are generated
from the commit subjects since the last stable release.

**Entries are for users.** A change earns a line here if someone could notice
it: a new feature, or a fix to something that was broken for them. Describe the
symptom, not the plumbing — "updates stopped being offered" rather than which
URL changed. Branch layout, CI, refactors and tests belong in commit messages.

Write entries under `## [Unreleased]` as you go, then rename that heading to
`## [x.y.z]` when you tag. The one release predating this file is
[v1.0.0](https://github.com/Alejandro-Raga/Latex4all/releases); anything older
belongs to the upstream project this was forked from.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Projects can be starred and given a type — article, thesis, presentation,
  poster, report, book, CV, letter, or anything you type yourself. Set it when
  creating from a template, which fills it in for you, or by right-clicking a
  project.
- The project grid can be ordered by how recently you opened something, by when
  you added it, by when the project was created, or grouped by type with a
  heading per group. Starred projects sit at the top either way, and are never
  forgotten when older projects drop off the list. The order you choose is
  remembered.

### Fixed

- A failed update said nothing at all — the dialog just closed and left you on
  the version you started from. It now says what went wrong, including when
  there is nothing to install because you already have that build.

### Changed

- Choosing an update channel now checks it, so coming back to Release from a
  test build offers the release straight away.

## [1.1.2] - 2026-09-11

### Changed

- Switching channels no longer downloads a build you already have. When the two
  channels are carrying the same code under different version numbers, there is
  nothing to install and nothing is offered.

### Fixed

- "Check for updates" told you that you were up to date while you were running
  a test build the release channel would never have offered to replace. It now
  notices and offers the release instead.

- Settings said definitions were English-only. Spanish has had them since the
  Wiktionary data was added; the note simply hadn't caught up.

## [1.1.1] - 2026-09-11

### Fixed

- The release channel had stopped offering updates altogether — every check
  failed silently. It works again, and can no longer be knocked out this way.

### Changed

- Plainer wording throughout the menus and dialogs: "From a template" rather
  than "Guided Setup", "Create and draft" rather than "Create & Generate with
  AI". Labels are sentence case now, so menus read like sentences instead of
  headlines.
- Replaced the decorative sparkle, rocket, lightning-bolt and brain icons with
  ones that describe what they sit next to. The flask stays where it actually
  means the test channel.
- The model picker lists Sonnet, Opus and Haiku without marketing descriptions.

## [1.1.0] - 2026-09-11

### Added

- Per-version release notes for both update channels, shown in the update
  dialog rather than the previous placeholder text.
- You can leave the test channel again. Switching back to Release offers to
  install the current release over a newer test build. It never happens on its
  own — only when you ask.
- Project previews on the home screen now show the real shape of the document:
  a presentation appears as a wide slide, an article as a portrait page. The
  cards themselves stay a uniform size, so the grid still reads as a grid.

### Fixed

- Preview images no longer overlap the project name beneath them.
