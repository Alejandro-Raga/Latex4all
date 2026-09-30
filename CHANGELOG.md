# Changelog

Notes for released versions of Latex4All.

**This file is load-bearing.** When CI builds a release tag it pulls out the
section matching that version and uses it for both the GitHub release body and
the notes shown in the app's update dialog. If the section is missing or empty
the build fails on purpose, so a release cannot ship with placeholder notes.

Test-channel builds use the `## [Unreleased]` section below as their notes,
so keep it current as features land; only if it is empty do they fall back to
the commit subjects since the last stable release.

**Entries are for users.** A change earns a line here if someone could notice
it: a new feature, or a fix to something that was broken for them. Describe the
symptom, not the plumbing — "updates stopped being offered" rather than which
URL changed. Branch layout, CI, refactors and tests belong in commit messages.

Write entries under `## [Unreleased]` and rename it to `## [x.y.z]` when you
tag.

## [Unreleased]

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
  Highlights and notes also show on the compiled PDF, and you can make them
  there too: select text in the PDF and pick a color or "Add note", and it
  lands on the LaTeX it came from. Exporting the PDF can include them as
  annotations any PDF reader shows.
- Suggested edits. Select text and choose "Suggest edit" (⌘⌥E) to propose
  what it should say. Anyone can accept or reject it, from the text or the
  notes bar, and reply to it like a note; settled suggestions stay in the
  notes bar as a record of who decided what.
- Your Obsidian vault beside your writing. Open Vault from the icons on the
  right to search, read and edit your notes, create new ones from your own
  templates, and see what each note links to and what links back. It works
  however you keep your vault: a folder on
  this computer (Obsidian Sync, iCloud, Dropbox, Syncthing, Git…), found on
  its own when Obsidian knows it, or a WebDAV server (Remotely Save,
  Nextcloud, Seafile…), read and saved there directly so it's up to date
  without opening Obsidian. Literature notes from Zotero plugins are
  recognised as papers: Cite adds the paper to the bibliography and inserts
  the citation, and a citation under the cursor leads to its note. On an idea
  note, "Cite its papers" cites every paper it links to at once.
- A living map of your notes, like Obsidian's graph: notes push apart and
  links pull, so the network settles into shape and wiggles when you drag a
  note. Scroll or pinch to zoom, drag to pan, hover a note to light up its
  links, click to open it, and type to highlight matching notes. Show a
  note's direct links, two steps out, or the whole vault; names fade in as
  you zoom so a busy network stays readable, and never on top of each
  other. A note's own map is laid out as a tree: the note in the middle,
  what it links to around it, and the next step out beyond those; the whole
  vault spreads its clusters apart. A legend under the map names its groups by color; click one to hide
  or show it.
- Find your way around the vault like a browser: Back and Forward, a Home
  button that takes you straight to all your notes, a list of the notes you
  came through, and your mouse's back and forward buttons.
- Follow a link in a PDF, such as a citation, and it takes you to the exact
  spot it points to; a "Back to p. N" button (or ⌘[) returns you to where
  you were reading, as in Zotero's reader.
- Link notes without remembering what they're called: type [[ while
  editing a vault note and pick from your notes, narrowed as you type by
  name, a paper's title, its citation key or its authors.
- Topics: right-click a paper in the Vault panel, or in the Reference
  panel, and "Connect to topic" files it under one of your topics or a new
  one. The paper links to the topic and the topic note lists the paper, so
  they appear together in the graph and in each other's links; in Zotero the
  paper gets the topic's tag too.
- Save the map of your notes as a JPEG image, with the button beside "fit to
  view".
- Tell Latex4All what a note is when it guesses wrong: right-click a note in
  the Vault panel, or click the label above an open note, and choose Paper,
  Project, Topic, Idea or Note (or Automatic). It's grouped, colored and
  mapped accordingly, and nothing in the note changes. Out of the box,
  notes are sorted by what they say about themselves, whatever the vault's
  layout.
- Delete a note from the Vault panel (right-click it); Latex4All says first
  how many notes link to it.
- Widen any side panel: the Reference, Vault and Notes panels each have a
  button that moves them into the big pane beside the editor, and back.
- Your projects in your vault. Turn on "Keep this project's note here" in the
  Vault menu and the project gets a note in a folder of its own (My work, or
  one you choose): the papers it cites, linked to their notes so your work
  sits in the graph beside the literature, its outline, and your highlights
  and notes with the text they're on. It updates itself as you write; what
  you add to the note yourself is kept. Its links open Latex4All straight to
  the project, and each note's place (main.tex:42) to that line.
- Color themes for the whole app, editor included: the classics (Light,
  Paper, Sky, Dark, Dim, Nord), colorful ones (Solarized light and dark,
  Rosé, Mint, Dracula) and retro ones — Seventies, Park (national park
  posters), Beige (the rainbow of early home computers), Spectrum, Arcade,
  Gruvbox, Synthwave, green Phosphor and Amber CRT — or follow the system.
  Each colors LaTeX its own way, and some carry a thin band of stripes along
  the top. As in Obsidian, the window is set out in regions of its own
  color: the bars and tabs framing your documents, the sidebars, and the
  page itself, with files and folders colored by kind. Or make your own: pick a background, sidebar, text and accent
  color, starting from any theme, and the rest of the interface and the
  editor's colors follow. Choose from the palette at the bottom of the
  sidebar, or in Settings under Appearance.
- Check citations (in the Vault menu): what you cite that isn't in your
  bibliography, with a button to add it from Zotero (and to update your
  \cite{}s if Zotero knows it by another key); what's in the bibliography
  but never cited; and cited papers that aren't in your vault yet, with a
  button to add each one, or all of them at once.
- Add papers to your vault from Latex4All: right-click a Zotero item in the
  Reference panel, or use Check citations. Latex4All writes the literature
  note itself, always in the same shape (details, abstract, your highlights
  with links back to the PDF, and a "My notes" section it never touches),
  in the folder your vault keeps its paper notes in. Adding a paper again
  refreshes its note and keeps what you wrote.
- Add a whole Zotero collection, or your whole library, to any .bib file
  of the project: right-click it in the Reference panel. Entries already in
  the file are skipped.
- A command palette: press ⌘K and type to jump to a file, a vault note or
  an open PDF, or to run a command — show or hide a panel, check citations,
  switch theme, open a settings section. Shortcuts too: ⌘⌥1, ⌘⌥2 and ⌘⌥3
  show or hide Reference, Vault and Notes, and ⌘⇧] and ⌘⇧[ step through
  the PDF pane's tabs.
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
- Tabs in the PDF pane, to read several papers at full size beside your
  editor. "Open in PDF pane" in the Reference panel, or on a PDF in the file
  list, opens it in a tab next to your compiled document; a widened side
  panel gets a tab too. Each tab keeps its page and zoom.
- Highlight papers as you read them in the PDF pane, and they're saved in
  Zotero: pick a color, or add a note, and it appears in your Zotero library
  like a highlight made there — on your other devices, and in anything
  that syncs from Zotero. You can also copy a passage or ask Claude about
  it. (If Zotero was already connected, reconnect it once so Latex4All may
  save to your library.)
- Your Zotero library is remembered between sessions: browsing and
  searching it in the Reference panel is instant from the moment the app
  opens, and it catches up with Zotero in the background, fetching only what
  changed.
- Read Zotero PDFs offline: turn on "Keep PDFs for offline reading" in
  Settings → Zotero, and papers you've opened open again instantly, with or
  without a connection. Settings shows the space they take, with a button to
  clear them.
- Add a paper to the project from quick reference: right-click a Zotero item,
  or a PDF in another project, and choose "Add PDF to references" to keep a
  copy, or "Add PDF to chat" to give it to Claude.

### Changed

- The Zotero section of the sidebar is gone: your library lives in the
  Reference panel, where you can browse, search, read, cite and add papers
  to the vault.

- The editor, the PDF pane and the side column are set apart by a clear
  gutter, so documents side by side no longer run together.
- Reference, Vault and Notes share one column on the right, stacked, instead
  of each opening a column of its own, so the editor and PDF keep their width.
  Fold any of them to its header, resize the split, or open and close them
  from the icons along the right edge.
- Each project remembers its workspace: the papers open in the PDF pane and
  the side panels you had open come back when you reopen it, and one
  project's tabs no longer follow you into another.
- If a panel runs into a problem, only that panel stops, with a button to
  reload it and one to copy the details for a bug report; the rest of the
  window keeps working.
- A project type you typed yourself is offered in the Type menu of every
  project, alongside the built-in ones.
- Exporting a PDF opens the save dialog in the project's own folder.

### Fixed

- Shared projects could open showing an old version and stay stuck: others'
  latest changes waited until every image and PDF had downloaded, the text
  couldn't be edited at first, and what you typed meanwhile collided with
  theirs, leaving highlighted conflicts that opened whenever you clicked.
  The latest text now arrives first, with files following, so conflicts
  don't appear out of nowhere.
- Changes to a shared project could silently stop reaching the others
  after the computer slept or changed network, until the project was
  reopened. A dead connection is now noticed and replaced within a minute,
  and what was waiting is sent.

- A project's own note in the vault was listed among the papers.
- Renaming or moving a project no longer strands its vault note: the note
  takes the project's new name, and every link to it is updated. Turning off
  "Keep this project's note here" asks whether to delete the note too.

- Check citations was cramped and ran off the screen in bigger projects. It
  now shows one list at a time (not in the bibliography, not in your vault,
  never cited) with their counts, names each paper by its title, and has an
  "Add all" for each list with a progress bar.
- On a narrow editor, the formatting buttons ran into the highlights button;
  they now fade out where they're cut off, with a divider in between.

- The red of spelling suggestions and errors glared on dark and colorful
  themes; each theme now has a red that sits with it.

- Papers exported with Zotero Integration (and other Obsidian–Zotero
  plugins) showed as "not in the vault" in project notes and citation
  checks, even when a note was named after the citation key. Latex4All now
  reads the key wherever these notes keep it (a Citekey:: line, a Better
  BibTeX link, an alias, a key with an @), finds any note named after the
  key, and recognises a paper by its authors and year even when the template
  writes nothing else, with fields in any case (Title:, Authors:, Year:).
- Text in PDFs couldn't be selected, so nothing could be copied, proofread or
  double-clicked to its place in the source. All of it works again.
- Selecting text in a PDF often grabbed everything from the top of the page
  when the drag started beside the text or between lines; the selection now
  starts at the nearest letter, like in a PDF reader, and you can drag across
  links. It shows clearly on every page color (it was near invisible on dark
  and sepia pages), and the highlight menu appears right under what you
  selected.
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
