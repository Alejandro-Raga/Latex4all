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
`## [x.y.z]` when you tag. Versions before 1.3.0 predate this file; see the
[GitHub releases](https://github.com/Alejandro-Raga/Latex4all/releases) for
their history.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Per-version release notes for both update channels, shown in the update
  dialog rather than the previous placeholder text.
- Project previews on the home screen now match the shape of the document, so
  a presentation is a wide card and an article stays portrait.

### Fixed

- Preview images no longer overlap the project name beneath them, and a
  presentation's name no longer sits stranded below a gap.
