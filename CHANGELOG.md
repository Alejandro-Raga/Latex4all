# Changelog

Notes for released versions of Latex4All.

**This file is load-bearing.** When CI builds a release tag it pulls out the
section matching that version and uses it for both the GitHub release body and
the notes shown in the app's update dialog. If the section is missing or empty
the build fails on purpose, so a release cannot ship with placeholder notes.

Test-channel builds use the `## [Unreleased]

## [1.2.0] - 2026-09-29

### Added

- Shared projects. Click Share in the editor to get an invite link; whoever
  opens it with Join chooses where to keep their copy, and from then on text,
  figures and files stay in sync, with everyone's cursors shown. Changes wait
  until the others open the project, so nobody starts from an old copy, and
  edits made offline merge in when you reconnect. Everything is encrypted on
  your computer before it's sent.
- Chat in shared projects, next to Notes: messages and images for everyone on
  the project, deleted after 30 days.
- Your own color in shared projects, picked in the Share button. It marks
  your cursor, notes and chat, recolors what you wrote before, and follows
  your name onto your other computers.
- The Share button warns you when a shared project is nearly full, when a
  file is too large to share or couldn't be sent, and when Latex4All needs
  updating, and shows how much space the project uses.
- Highlights and notes. Select text to highlight it or add a note (⌘⇧H,
  ⌘⌥M); hover a highlight to read the note, reply, resolve it or change its
  color. The notes bar lists every note in the project and jumps to it.
  Highlights and notes also show on the compiled PDF, and exporting the PDF
  can include them as annotations any PDF reader shows.
- Suggested edits. Select text and choose "Suggest edit" (⌘⌥E) to propose
  what it should say. Anyone can accept or reject it, from the text or the
  notes bar, and reply to it like a note; settled suggestions stay in the
  notes bar as a record of who decided what.
- Your Obsidian vault beside your writing. Open Vault from the icons on the
  right to search, read and edit your notes, create new ones from your own
  templates, and see what each note links to and what links back, on a small
  map of connected notes. It works however you keep your vault: a folder on
  this computer (Obsidian Sync, iCloud, Dropbox, Syncthing, Git…), found on
  its own when Obsidian knows it, or a WebDAV server (Remotely Save,
  Nextcloud, Seafile…), read and saved there directly so it's up to date
  without opening Obsidian. Literature notes from Zotero plugins are
  recognised as papers: Cite adds the paper to the bibliography and inserts
  the citation, and a citation under the cursor leads to its note.
- Settings from anywhere: press ⌘, or click the gear at the bottom of the
  sidebar. New sections bring together what was scattered: Editor, PDF, Zotero
  and Vault.
- Copy text from PDFs with ⌘C or the Copy button, as readable text: lines of a
  paragraph joined, paragraphs kept apart, hyphenated words made whole.
- More ways to show a PDF: besides light and dark, a softer off-white, sepia,
  a dim grey with off-white text, and a warm dark. Each viewer remembers its
  own.
- Move a project to another folder or drive from inside the app: right-click
  it on the projects screen, or its name in the sidebar, and choose "Move
  to…". A shared project stays shared.
- Add a paper to the project from quick reference: right-click a Zotero item,
  or a PDF in another project, and choose "Add PDF to references" to keep a
  copy, or "Add PDF to chat" to give it to Claude.

### Changed

- Reference, Vault and Notes share one column on the right, stacked, instead
  of each opening a column of its own, so the editor and PDF keep their width.
  Fold any of them to its header, resize the split, or open and close them
  from the icons along the right edge.
- A project type you typed yourself is offered in the Type menu of every
  project, alongside the built-in ones.
- Exporting a PDF opens the save dialog in the project's own folder.

### Fixed

- Text in PDFs couldn't be selected, so nothing could be copied, proofread or
  double-clicked to its place in the source. All of it works again.
- The PDF's dark-mode button sat under the chat button; its replacement, the
  page colors button, is at the bottom left.
- Cut (⌘X / Ctrl+X) works in text again. Capture and ask moved to ⌘⇧X /
  Ctrl+Shift+X.
- Claude's edits, and undoing them, no longer erase what you or a
  collaborator wrote in the meantime.
- Right-clicking a Spanish word finds its definition for plurals, verb forms
  and other inflections, not only the dictionary form, and the Spanish
  language pack is half the size to download.
- The setup window can always be closed: it has a close button, and on small
  screens its list scrolls instead of pushing Done out of reach. The
  new-project and template windows have their close button back too.
- Grammar checking works on computers with an older Java installed, as is
  common on Windows, and its downloads retry instead of hanging on a stalled
  connection.

## [1.1.3] - 2026-09-11

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

### Changed

- Choosing an update channel now checks it, so coming back to Release from a
  test build offers the release straight away.

### Fixed

- Setting a project's type did nothing the first time and only worked on the
  second attempt.
- Ordering by recency or by date added showed the same unchanging list, because
  every project the app had found for itself was recorded at the same moment.
  They now take their dates from the project folder.
- Moving from the test channel to Release could refuse to install, saying you
  already had that build. The release is now always offered and always
  installable.
- A failed update said nothing at all — the dialog just closed and left you on
  the version you started from. It now says what went wrong.

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
