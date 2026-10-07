## Getting started

Latex4All is a LaTeX editor with your references, your notes and an AI assistant in the same window.

On the **All projects** page:

- **New** starts a project, from a template or as a blank document.
- **Import** opens a folder that's already on your computer.
- **Join** opens a project someone shared with you, from the link they sent.

Click a project to open it. Right-click it to star it, give it a type (article, thesis, presentation…) or remove it from the list. Search with ⌘K.

The window has three parts: your files on the left, the editor in the middle and the PDF on the right. The icons on the far right open the side panels: Reference, Vault and Notes.

[Open the projects page](app:projects)

## Writing and compiling

Type in the editor; files save on their own, or with ⌘S.

- **Compile** with ⌘↵, or the button above the PDF. The first compile of a project downloads the packages it needs.
- **Keep the PDF where you want it:** the button beside Export PDF saves every compile under a name and in a folder you choose, such as "Raga - Proposal.pdf" in a Deliverables folder.
- **Jump between text and PDF:** double-click a spot in the PDF to go to its line in the source.
- **The ribbon** above the editor writes the LaTeX for you: bold, lists, figures, tables, equations, footnotes and citations. A package a button needs is added to the preamble.
- **Spelling and grammar:** pick the language at the end of the ribbon, and turn on GRAMMAR for a grammar check that runs on your computer.
- **Look up a word:** right-click it for its definition and synonyms.
- **Find and replace:** ⌘F.

## Notes, highlights and suggestions

Select text in the editor or the PDF and a small toolbar appears.

- **Highlight** it in a color (⌘⇧H).
- **Add note** to leave a comment on it (⌘⌥M). Notes can be replied to and resolved.
- **Suggest edit** proposes new wording (⌘⌥E) that anyone can accept or reject.

The Notes panel lists them all. They also show on the compiled PDF, and **Export PDF** can include them as PDF annotations.

## History

Latex4All keeps snapshots of your project: when you save, before each compile and before and after every AI edit. Open **History** (the clock above the PDF) to see what changed and restore an earlier version. Restoring is itself kept in the history, so it can be undone.

## References and Zotero

Connect Zotero in **Settings → Zotero** with an API key from zotero.org. Your library then appears in the **Reference** panel, and stays on your computer between sessions.

- **Cite** from the ribbon: "Nelson (1959)" in the sentence, or "(Nelson, 1959)" in parentheses. Pick the paper from the list.
- **Add to a .bib:** right-click a paper, or a whole collection.
- **Search** by title or author, or type `author:`, `year:1990-2005`, `year:>2010` or `type:book`. The sliders button filters by year and item type; the menu beside it sorts.
- **Check citations** (in ⌘K) finds what you cite that isn't in your bibliography, and entries you never cite.
- The quote button shows only what this project cites, with the lines where it's cited.

[Open Settings → Zotero](app:settings/zotero)

## Reading papers

Click a paper with a PDF to read it. Inside a project it opens in a tab of the PDF pane; the button in the tab's header moves it to the side panel. On the Library & Vault page it opens under the list.

- **Highlight** by selecting text and picking a color. Highlights are saved in Zotero, like the ones you make there.
- **Right-click a highlight** to change its color, write a note on it, delete it, or add it to an idea or topic.
- **Follow a link** in the PDF, such as a citation, and press ⌘[ to go back.
- **Offline:** turn on "Keep PDFs for offline reading" in Settings → Zotero.

## Your vault

The vault is your Obsidian vault, opened from the Vault panel. Connect it in **Settings → Vault**: a folder on this computer, or a WebDAV server (Nextcloud, Seafile…).

- Read, write and search notes. The search takes the same `author:` and `year:` conditions as the library; the sliders button filters by type and topic, and the menu beside the search sorts.
- **Add a paper to the vault** by right-clicking it in the Zotero library. Its note lists its details and your highlights.
- **Note types** (paper, project, topic, idea, note) are recognised on their own; right-click a note to change its type.
- **The map** shows how notes link. On the Library & Vault page it shows the whole vault.
- **A project's note**: "Keep this project's note here" gives a project a note with what it cites and its outline, kept up to date as you write.

[Open Settings → Vault](app:settings/vault)

## Ideas and topics

Topics and ideas are vault notes that collect passages, word for word, with a link back to where each came from.

- **From a paper:** select text and choose **Add to idea…** or **Add to topic…**, or right-click a highlight you already have.
- **From your own writing:** do the same in the editor or the compiled PDF. The link opens the project at that file and line.
- **A whole paper:** right-click it in the Zotero library and choose **Connect to topic** or **Connect to idea**.

Pick a note from the list or type a new name. A highlight added this way is also tagged in Zotero (`idea: …` or `topic: …`).

## AI assistants

The chat opens from the round button at the bottom of the editor. It can read and edit your project; every change shows in the editor for you to keep or undo (⌘Y keeps all, ⌘N undoes all).

- **Choose an AI** in the model menu, next to the send button. Claude, ChatGPT, Gemini and GitHub Copilot work with your own account; others work with an API key. Add them in **Settings → Provider**.
- **Usage:** the bar next to send shows how much of your plan's limit is used. Settings → AI usage has the details, and the order to switch AIs in when one runs out.
- **On selected text:** the toolbar has quick actions (improve, shorten, translate, explain) and a box to ask anything about it.
- **Capture and ask:** ⌘⇧X, then drag over part of the PDF to send it as an image.
- **Undo** after a reply puts back every file it changed.
- **Memory:** AGENTS.md holds notes every AI in the project reads. Edit it from Chats → Memory.

[Open Settings → Provider](app:settings/provider)

## Shared projects

Click **Share** above the editor to get an invite link. Whoever opens it with **Join** gets their own copy, and from then on files stay in sync, with everyone's cursor shown. Edits made offline merge when you reconnect. Everything is encrypted on your computer before it's sent.

- **Chat** with the others from the panel beside Notes.
- **Your color** for your cursor, notes and messages is set from the Share menu.
- To work on one project from two computers, share it and join it from the other one.

## Updates and bug reports

Updates install themselves after you agree. In **Settings → Updates** choose the channel: **Release** for finished versions, **Test** for the newest work, which may have rough edges.

**Report a bug** is in the sidebar of the projects page and in ⌘K. Describe what happened and add screenshots; the app's version and recent errors go with it.

[Open Settings → Updates](app:settings/updates)

## Keyboard shortcuts

On Windows and Linux, use Ctrl where it says ⌘.

| Keys | Does |
| --- | --- |
| ⌘K | Command palette: files, notes, papers, commands |
| ⌘, | Settings |
| ⌘S | Save |
| ⌘↵ | Compile |
| ⌘F | Find and replace |
| ⌘B / ⌘I | Bold / italic |
| ⌘/ | Comment out the lines |
| ⌘⇧H | Highlight the selection |
| ⌘⌥M | Note on the selection |
| ⌘⌥E | Suggest an edit |
| ⌘Y / ⌘N | Keep / undo all of an AI's changes |
| ⌘⇧X | Capture part of the PDF and ask about it |
| ⌘⌥1, 2, 3 | Reference, Vault, Notes panels |
| ⌘⇧[ / ⌘⇧] | Previous / next PDF tab |
| ⌘[ | Back after following a link in a PDF |
| ⌘T / ⌘W | New / close chat |
| ⌘⇧N | New window |
| ⌘+ / ⌘− | Zoom the app |
