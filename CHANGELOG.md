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

### Writing together

- Shared projects. Click Share in the editor for an invite link; whoever
  opens it with Join gets their own copy, and from then on text, figures and
  files stay in sync, with everyone's cursors shown. Edits made offline merge
  in when you reconnect, and everything is encrypted on your computer before
  it's sent.
- Chat in shared projects, beside Notes, with images; messages are kept for
  30 days.
- Your own color in shared projects, for your cursor, notes and chat.
- The Share button shows how the connection is doing, warns when a project is
  nearly full or a file couldn't be sent, and has a "Copy diagnostics" report
  for when something's wrong. If the connection fails for a while, Latex4All
  tells you whether the service or your internet is down.
- Highlights and notes: select text to highlight it or add a note (⌘⇧H,
  ⌘⌥M), reply to notes and resolve them. The notes bar lists them all. They
  also show on the compiled PDF, where you can make them too, and exporting
  the PDF can include them as annotations.
- Suggested edits (⌘⌥E): propose what a passage should say; anyone can accept
  or reject it, and the notes bar keeps a record of what was decided.

### Writing LaTeX

- The editor's ribbon does the LaTeX for you: bold, italic, underline,
  headings, bulleted and numbered lists (select some lines to turn them
  into one), quotations, footnotes, equations, figures from the project's
  images, tables, links and page breaks. Cite in the sentence, "Nelson
  (1959)", or in parentheses, "(Nelson, 1959)", and pick the paper from
  the list that opens; the right command is used for your bibliography
  setup, and a package a button needs is added to the preamble.

### Your Obsidian vault

- Your vault beside your writing, from the icons on the right: search, read
  and edit notes, create them from your templates, and see what links where.
  It works with a vault on this computer (Obsidian Sync, iCloud, Dropbox,
  Git…) or on a WebDAV server (Remotely Save, Nextcloud, Seafile…).
- Literature notes from Zotero plugins are recognised as papers, however
  your template writes them: Cite adds a paper to the bibliography and cites
  it, and the citation under the cursor leads to its note.
- A living map of your notes: drag, zoom, hover to light up links, and see a
  note's neighbourhood as a tree or the whole vault. A legend names its
  groups, and the map saves as an image.
- Add papers to your vault from Latex4All: right-click a Zotero item, or use
  Check citations to add every cited paper at once. The note is always
  written the same way, in the folder where your paper notes live.
- Topics: right-click a paper and "Connect to topic" to file it under a
  topic, new or existing; the paper and the topic link to each other. It
  works on any note, wherever it shows up: the note list, a note's links and
  the connection map, along with changing its type and deleting it.
- The quote button in the vault and in the Zotero library shows only what
  the open project cites, with the lines that cite each one; click a line to
  go there in the editor. Sort it in text order or most cited first; in the
  vault each paper shows its topics (or "no topic"), and one click adds the
  cited papers the vault is missing.
- A paper's note shows the lines where the open project cites it.
- Hover a key in `\cite{…}` to see the paper's title, authors and year, with
  a button to open its note or add it to the vault.
- Type [[ while editing a note to link another, found by its title, author
  or citation key as well as its name.
- Note types: Paper, Project, Topic, Idea or Note, found automatically and
  changeable by hand, plus types of your own. Every type has a folder where
  its notes are kept (choosing the type moves a note there), and yours can
  have a tag too. Each type and folder can have its own color.
- Your projects as notes: "Keep this project's note here" gives a project a
  note listing what it cites, its outline and your highlights, kept up to
  date as you write. Renaming the project renames the note, links and all,
  and every computer sharing the project keeps to the one note.
- Find your way around the vault with Back, Forward, Home and a list of
  recent notes; delete notes from the Vault panel.
- Check citations: what you cite that's missing from the bibliography or the
  vault, and what's in the bibliography but never cited, each with a fix.

### Zotero and reading papers

- Papers a collaborator cited that aren't in your Zotero library go into it
  from the project's bibliography, with their details and the same citation
  key, in the collection you pick (remembered for the project) and tagged
  "from: <project>": "Not in Zotero" in Check citations, or "add" beside the count in the
  Reference panel's cited view. Adding such a paper to the vault now puts it
  in Zotero first instead of failing.
- Tabs in the PDF pane, to read several papers at full size beside your
  editor, each keeping its page and zoom.
- Highlight papers as you read them, and the highlights are saved in Zotero
  like ones made there. (If Zotero was already connected, reconnect it once.)
- Your Zotero library is remembered between sessions, so browsing and
  searching it is instant, and it catches up in the background.
- Read Zotero PDFs offline: turn on "Keep PDFs for offline reading" in
  Settings → Zotero.
- Add a whole collection, or your library, to any .bib file of the project
  by right-clicking it in the Reference panel.
- Follow a link in a PDF, such as a citation, to the exact spot it points to,
  and "Back to p. N" (or ⌘[) to return.
- Copy text from PDFs as readable text, with lines joined and hyphenated
  words made whole.
- More page colors for PDFs: soft, sepia, dim and warm dark, besides light
  and dark.
- Add a paper to the project from the Reference panel: keep a copy of its
  PDF, or give it to Claude.

### AI

- Chat with ChatGPT or Gemini using your own account, no API key: Settings →
  Provider → "Sign in with an account" installs OpenAI's Codex (for ChatGPT
  plans) or Google's Gemini CLI (free with a Google account) and signs you
  in through the browser. Pick it in the chat's provider menu; it edits the
  project like Claude does, and its use shows in AI usage. The scientific
  skills installed for Claude work for them too.
- Settings → AI usage: requests, tokens and what they'd cost at API prices,
  today, this week or this month, by service, model and project, with a
  daily amount to be warned at. With a Claude plan, the 5-hour and weekly
  limits as Claude counts them, and when each starts over.
- When a Claude limit is nearly reached the chat shows how full it is; once
  it's reached, a button switches the chat to another AI service you've set
  up (DeepSeek, say), conversation and all.
- Other AI services get a price per million tokens and a daily warning of
  their own, so their use shows as cost too; and Settings → AI usage can
  switch the chat to one by itself when Claude's limit is reached, and back
  once it resets.
- Under each reply, how many tokens it read and wrote (and for Claude, its
  cost), so heavy ones stand out.
- OpenAI, Gemini, GLM and Ollama now count the tokens they read, not only
  the ones they write.
- The chat remembers its model and thinking effort between launches, and
  starts on Sonnet, which uses far less than Opus.
- A long chat says so, with a button for a new one: each message re-reads
  the whole conversation.
- Claude plans with a to-do list only for bigger tasks, and reads just the
  part of a file it's changing, so small edits take fewer steps.

### Look and feel

- Color themes for the whole app, editor included: classic, colorful and
  retro ones, or your own from four colors. The window is set out in regions
  of their own color, as in Obsidian.

### Getting around

- A command palette (⌘K) to jump to a file, note or PDF, or run a command,
  and shortcuts for the side panels (⌘⌥1–3) and PDF tabs (⌘⇧[ and ⌘⇧]).
- Settings from anywhere (⌘,), with sections for the editor, PDFs, Zotero
  and the vault.
- Widen any side panel into the big pane beside the editor, and back.
- Move a project to another folder or drive from inside the app.

### Changed

- Reference, Vault and Notes share one column on the right, stacked and
  foldable, so the editor and PDF keep their width; a clear gutter sets the
  editor, the PDF and that column apart.
- Your Zotero library lives in the Reference panel; the old Zotero section
  of the sidebar is gone.
- The Reference panel's Projects and Zotero sections fold away, and the
  projects are listed starred first, then latest, with a search when there
  are many. The preview opens only when you pick something, with a button
  to close it.
- Each project remembers the papers and panels you had open.
- If a panel runs into a problem, only that panel stops, with a button to
  reload it.
- A project type you typed yourself is offered for every project.
- Exporting a PDF opens the save dialog in the project's folder.

### Fixed

- Syncing a Zotero collection with a .bib file deleted the entries that
  weren't in your library, such as a collaborator's, and could change a
  paper's citation key when its details changed in Zotero, breaking the
  citations. Both stay now.
- "Cited in this project" in the Zotero library missed papers whose titles
  have capitals kept in braces, as Zotero writes them; it now finds them,
  and by author and year when the title differs. Check citations finds
  them in Zotero too, and without going online.
- Link suggestions after "[[" follow the pointer, so the full name shows
  beside the one you point at, not just the first.
- Text in PDFs couldn't be selected, so nothing could be copied or
  double-clicked to its place in the source. Selection now works like in a
  PDF reader, from the nearest letter, and shows on every page color.
- The PDF's dark-mode button sat under the chat button.
- Cut (⌘X / Ctrl+X) works in text again; Capture and ask moved to ⌘⇧X.
- Claude's edits, and undoing them, no longer erase what you or a
  collaborator wrote in the meantime.
- Spanish definitions are found for plurals and verb forms too, and the
  Spanish language pack is half the size.
- The setup, new-project and template windows can always be closed.
- Grammar checking works with the older Java common on Windows, and its
  downloads retry instead of hanging.

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
