# Changelog

Notes for released versions of Latex4All.

**This file is load-bearing.** When CI builds a release tag it pulls out the
section matching that version and uses it for both the GitHub release body and
the notes shown in the app's update dialog. If the section is missing or empty
the build fails on purpose, so a release cannot ship with placeholder notes.

Test-channel builds are deliberately *not* listed here — their versions are CI
run numbers, so there is nothing to write in advance. Their notes are generated
from the commit subjects since the last stable release.

Write entries under `## [Unreleased]` as you go, then rename that heading to
`## [x.y.z]` when you tag. The one release predating this file is
[v1.0.0](https://github.com/Alejandro-Raga/Latex4all/releases); anything older
belongs to the upstream project this was forked from.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
  install the current release over a newer test build, which an ordinary
  update check cannot do — it only ever looks for something newer. A rollback
  is always explicit; the launch check will never start one on its own.
- Project previews on the home screen now show the real shape of the document:
  a presentation appears as a wide slide, an article as a portrait page. The
  cards themselves stay a uniform size, so the grid still reads as a grid.

### Fixed

- Preview images no longer overlap the project name beneath them.
