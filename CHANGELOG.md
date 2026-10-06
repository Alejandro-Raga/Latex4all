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

- Your own writing can go into ideas and topics too: select text in the
  editor or in the compiled PDF and choose "Add to idea…" or "Add to
  topic…". It's quoted under the project's name, with a link that opens the
  project at that file and line.
- The Library's Projects list shows every project, grouped by type
  (favourites first), with groups that fold away, a search by name or type,
  and a right-click menu to star a project or remove it from the list.
  Projects with no type chosen get one from their document class (article,
  presentation, thesis, CV, letter…).
- The projects page keeps every project opened, not only the last ten;
  ones that had dropped off come back.
- In a project, a paper picked in the Reference panel opens in a tab of
  the big PDF pane. A button in the tab's header moves it to the side
  panel; the side panel's "Open in PDF pane" moves it back.
- Right-click a highlight on a paper to change its color, write or edit its
  note, or delete it. A deleted highlight's passage also leaves the ideas
  and topics it was added to, and an edited note shows there too.
- "Connect to idea" in the Zotero library's right-click menu, next to
  "Connect to topic": the paper goes on the idea note's list of papers
  (the note is made if it's new).
- Sort the vault's notes by title, first author or year (newest or oldest),
  from the menu next to the search. Papers, ideas and topics keep their own
  sections. The same menu orders a note's links, and Zotero references can
  now be sorted by first author too.
- The Zotero library gets a filter too (the sliders button by its search):
  a range of years and an item type (journal article, book…). These can also
  be typed: `year:1990-2005`, `year:>2010`, `type:book`. The first time the
  library opens after updating, it is read from Zotero again in full.
- Vault search like Zotero's: a filter row (the sliders button by the search)
  for a range of years, a type and a topic. Conditions can also be typed:
  `author:nelson`, `year:1990-2005`, `year:>2010`, `topic:"open science"`,
  `type:paper`, `tag:name`, alongside ordinary words.
- A note's links (Both ways, Links to, Linked from) can be filtered the
  same way once there are more than a few, and each paper there
  shows its first author and year.
- File a passage under an idea or a topic while reading a paper: select text
  and choose "Add to idea…" or "Add to topic…", or right-click a highlight
  you already have. Pick one of your notes or type a new name. The passage
  goes into that note word for word, under its paper, with links back to the
  paper note and to the spot in the PDF. Works without any Zotero sync
  running elsewhere, and matches the notes such a sync writes.
- Right-click a file or folder in the project's file list, or its empty
  space, and choose "Show in Finder" ("Show in File Explorer" on Windows) to
  see it there.
- A refresh button on the Zotero section of the Reference panel fetches
  what changed in Zotero since the library was last read.

### Fixed

- Esc, or a click elsewhere, closes the idea and topic picker, a
  highlight's menu and the note box.
- "Connect to topic" in the Zotero library's menu sat off to the right.
- A highlight's link in a note ("p. 2") opens the paper at that highlight
  in a PDF tab when a project is open, and in the Library's preview
  otherwise, with highlighting, notes and ideas all available. Before, it
  opened in a window that sometimes wouldn't scroll, and a paper moved from
  there to a tab only offered Copy.
- Some PDFs in shared projects kept failing to sync with "The relay
  answered 502". These were files the relay already had.
- Shared projects stopped making duplicate "(2)" files and needless
  "(conflicted copy)" files after the last update. Copies that are
  identical to the file they copy are removed the next time the project
  opens; copies that differ are kept.
- Adding the same paper to a chat again reuses the file already in the
  project instead of saving another copy.
- Clicking in the editor selected a single letter and typing didn't write:
  Vim keys had been left on. They are now off until switched on again in
  Settings, and while they're on, the editor shows the Vim mode (NORMAL,
  INSERT…) below the text.
- Selecting text and highlighting on old scanned papers lines up with the
  printed words. Before, the selection drifted away from them partway
  through a line, and highlights saved from it came out shifted.
- A shared project whose folder is also synced to another computer
  (Seafile, Dropbox, iCloud…) no longer loses track of changes between
  the two. Each computer now keeps its own record of the sync with the app
  instead of in the project. The first time such a project opens after
  updating, it is compared afresh with the shared copy, and a file that
  differs is kept as a "(conflicted copy)".
- When ChatGPT's connection drops and it tries again, the reply says so
  and waits, instead of stopping with an error.
- A PDF opened from the Library & Vault page can be highlighted and noted,
  and its passages added to ideas and topics, as in the PDF pane.
- ChatGPT's usage meter shows your plan (Plus, Pro…) and how much of it is
  used right now, as ChatGPT counts it, including use on other devices and
  apps. Before, it could show stale figures, or the limits of a single model
  instead of the plan's.
- Highlights from Zotero, and new ones made here, show as one band per line,
  as in Zotero, not a patchwork of words (most visible in scanned PDFs).
- In a shared project, a file that couldn't be sent because the server was
  briefly unreachable is tried again a minute later, then less often, instead
  of only once it changed.
- A project's history that a sync service had copied badly (an empty folder,
  or one made on another computer) stopped history from working. It's now
  set aside and history starts again.
- An app left open only looked for updates when it started, so a version
  released meanwhile went unnoticed. It now looks again every few hours,
  and when you come back to it after an hour away.

## [1.2.3] - 2026-10-04

### Fixed

- A reply from ChatGPT, Gemini or Copilot could keep showing "Thinking…"
  long after it had finished, or never end, when something it started (a
  compile, say) went on running in the background. The chat now finishes
  as soon as the AI does.

## [1.2.2] - 2026-10-04

### Fixed

- A highlight link in a paper note opened its PDF at the top. It now goes to
  the highlight itself, with the text around it in view, and rings it for a
  moment so it's easy to spot.

## [1.2.1] - 2026-10-04

### Fixed

- A paper note's highlight links ("p. 2") did nothing in Latex4All. They
  now open the PDF here, at that page, with its highlights; inside a
  project it can go on to a tab.
- Paper notes showed codes like "^ivkzhggg" under each highlight. They're
  link targets for Obsidian and are no longer shown.
- Notes written by "Add to vault" put each highlight's link target where
  Obsidian couldn't find it, and kept the PDF's broken words ("pub-
  lishing"). Both are fixed.

## [1.2.0] - 2026-10-04

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
- Library & Vault on the Projects page: your Zotero library and your vault
  side by side, without opening a project. Read papers, add them to the
  vault, file them under topics and write notes; actions that need a
  project (citing, adding to a .bib, "cited in this project") show once one
  is open.
- There, the vault opens on a map of the whole vault, filterable by type;
  inside a project it stays as it was.
- Literature notes from Zotero plugins are recognised as papers, however
  your template writes them: Cite adds a paper to the bibliography and cites
  it, and the citation under the cursor leads to its note.
- A living map of your notes: drag, zoom (wheel, pinch or the + and −
  buttons), hover to light up links, and see a note's neighbourhood as a
  tree or the whole vault. A legend names its
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

- Add papers a collaborator cited to your Zotero library, using the
  details and citation key from the project's .bib. Pick a collection
  (remembered per project); they're tagged "from: <project>". Use "Not in
  Zotero" in Check citations, or "add" next to the count in the Reference
  panel. Adding such a paper to the vault now adds it to Zotero first.
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

- Chat with ChatGPT or Gemini using your own account, no API key needed.
  Settings → Provider → "Sign in with an account" installs OpenAI's Codex
  (any ChatGPT account, including free) or Google's Gemini CLI and signs
  you in through the browser. Gemini this way needs a paid Gemini account:
  a free one is told so when signing in, or in the chat. For free Gemini,
  use an API key. Pick one in
  the chat's model menu and choose a model from its list. It can edit the
  project like Claude, and its use shows in AI usage.
- GitHub Copilot, with your Copilot plan (the free one included): Settings
  → Provider → "Sign in with an account". It uses your GitHub CLI sign-in if
  you have one. Its model menu shows your plan and the premium requests
  left this month, the models you can use (Auto first) marked Light,
  Versatile or Powerful, and the ones your plan doesn't include, with a
  link to turn them on or upgrade. Next to the send button, how
  much of the month's premium requests is used; under each reply, its
  tokens and share of the month. When the month runs out, the chat moves to
  your next AI.
- "Add an AI" in the chat's model menu: sign in with an account (Claude,
  ChatGPT, Gemini, Copilot) or add an API key. Free options are marked.
- Settings → Provider lists Claude and your API keys separately, each with
  its model and a Remove button, plus a clearer "Add an API key" button.
- When you add an API key, the newest model is picked for you (you can
  change it in the chat).
- Shared project memory: AGENTS.md holds notes that every AI in the project
  reads. Edit it from Chats → Memory, or ask an AI to remember something.
  Each AI also sees what the others changed since its last turn. If two
  chats try to edit the same project at once, the second one waits (or use
  "Send now").
- When an AI hits its usage limit, the chat switches to the next one in
  your list (Settings → AI usage), automatically or after asking. The new AI
  finishes the interrupted request, knowing what was already changed, and
  the chat switches back once the limit resets. At 95% the chat offers to
  switch early.
- Quick AI actions on selected text: Improve, Shorten, Formal, Translate,
  Explain, Check argument.
- "Auto" model for Claude: Haiku for quick actions and small edits, Sonnet
  for everything else.
- "Undo" after a reply reverts every file it changed. The chat also warns
  when a reply cites keys missing from your bibliography.
- Each project remembers its AI, model and effort.
- Rename a chat: double-click its tab, or the pencil in the Chats panel
  (for earlier chats too). The name is kept with the chat.
- Hover a model in the model menu for a few words on what it's for (OpusPlan:
  Opus plans the work, Sonnet does it).
- "Ask two AIs…" in the model menu: send one question to two AIs, compare
  the answers side by side, and continue with either.
- A Chats panel (clock button) lists open chats and past ones by day, with
  search, new chat and delete.
- Settings → Skills: turn each skill on or off for Claude, ChatGPT and
  Gemini, one at a time or by group, and make your own groups. Each column
  shows how many tokens the enabled skills add to every request.
- Settings → AI usage: requests and tokens by day, week or month, by
  service, model and project. Only API-key use and Claude's extra usage are
  billed; requests covered by a plan are not. Set a daily amount to be
  warned at. With a Claude or ChatGPT plan, see the 5-hour and weekly limits
  and when they reset.
- Claude's 5-hour limit is always in view next to the send button, even
  while a reply runs: a small bar, the share used and the time left until
  it resets (the week joins it from 70%). It refreshes by itself when it's
  old, and on a click; Settings → AI usage has a refresh button too. The
  refresh asks Claude Code, without using any of your limit.
- Under each reply: the model, how many steps it took (each one re-reads the
  chat, so steps decide most of the cost), tokens read and written, the
  share of your limit it used, and the cost when billed.
- API services can have a price per million tokens and a daily warning.
- Gemini API keys start on Flash-Lite, which allows far more free requests
  a day than Flash (about 500 against 20). Next to the send button, "Today
  12/20" shows how many of a free model's daily requests are used. The
  limit is learned from Google once it's reached.
- OpenAI, Gemini, GLM and Ollama count the tokens they read, not only those they write.
- The chat remembers its model and thinking effort, and starts on Sonnet,
  which uses much less than Opus.
- Long chats show a notice with a button to start a new one.
- Every chat can be closed, the last one included (it stays in the
  history), and the Chats panel has "Close all".
- A Stop button next to "Thinking…", so a request that hangs can always be
  stopped, even with text in the message box.
- Claude only makes a to-do list for bigger tasks and reads just the part
  of a file it's changing, so small edits take fewer steps.

### Look and feel

- Color themes for the whole app, editor included: classic, colorful and
  retro ones, or your own from four colors. The window is set out in regions
  of their own color, as in Obsidian.

### Getting around

- Report a bug, from the Projects page, the command palette (⌘K) or
  Settings → Updates: describe what happened, add screenshots (paste, drop
  or pick them) and, if you like, an email for a reply. The app's version,
  system and recent errors go with it, and you can see them, or leave them
  out, before sending.
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
- Selecting a single letter (a click that moved a little) no longer opens
  the selection toolbar.
- A trackpad pinch no longer resizes the whole window; ⌘+ and ⌘− (Ctrl on
  Windows) still zoom the app, and the PDF and the map still zoom with a
  pinch.
- Strips that scroll sideways (the editor's ribbon, the chat and PDF tabs)
  move with a plain mouse wheel too, not only a trackpad.
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
