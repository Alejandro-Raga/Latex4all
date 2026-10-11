## Getting started

Latex4All is a LaTeX editor with your references, your notes and an AI assistant in the same window.

On the **All projects** page:

- **New** starts a project, from a template or as a blank document.
- **Import** opens a folder that's already on your computer.
- **Join** opens a project someone shared with you, from the link they sent.

Click a project to open it. Right-click it to star it, give it a type (article, thesis, presentation…), **duplicate** it, move it, or remove it from the list. A duplicate is a project of its own: it isn't shared even if the original is, and starts its own history. Search with ⌘K.

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

Connect Zotero in **Settings → Zotero**, by signing in or with an API key from zotero.org (Settings → Security → Create new private key). Give the key **write access** if you want highlights, notes and tags you make here to reach Zotero; a read-only key can only read. Your library then appears in the **Reference** panel, and a copy stays on your computer, so it opens at once and can be searched offline.

- **Cite** from the ribbon: "Nelson (1959)" in the sentence, or "(Nelson, 1959)" in parentheses. Pick the paper from the list.
- **Add to a .bib:** right-click a paper, or a whole collection.
- **Search** by title or author, or type `author:`, `year:1990-2005`, `year:>2010` or `type:book`. The sliders button filters by year and item type; the menu beside it sorts.
- **Check citations** (in ⌘K, or the button in the vault's Project tab) finds what you cite that isn't in your bibliography, entries you never cite, and cited papers without a vault note. Only the .bib files your document uses (`\bibliography{…}` or `\addbibresource{…}`) count; others in the folder are listed apart, and so are copies a sync service made of a clash ("SFConflict", "conflicted copy").
- **Duplicates** (a tab in Check citations) tidies the bibliography: one paper under several keys (found by DOI, or by title and year), a key written twice, and citations whose key is in no .bib but plainly means an entry that is. Pick the key to keep for each paper; **Clean up** rewrites the citations in every .tex file and removes the extra entries. **Undo** puts it all back.
- The quote button shows only what this project cites, with the lines where it's cited.
- **Refresh** (the arrow on the Zotero section) fetches what changed in Zotero since the library was last read.

[Open Settings → Zotero](app:settings/zotero)

## Where Zotero data comes from

Latex4All can get your Zotero library from three places. The **Zotero** button in the editor's toolbar shows which one is in use, and holds the settings:

| Dot | Means |
|---|---|
| Green | zotero.org |
| Blue | the Zotero app on this computer |
| Amber | a fallback, because zotero.org can't be reached |
| Red | nothing could be reached |
| Grey | nothing has been asked yet |

**Zotero on this computer** decides when the Zotero app is used:

- **Off:** only zotero.org.
- **As fallback** (the default): zotero.org first; the Zotero app, or its files, when zotero.org is down or you're offline.
- **Always:** the Zotero app whenever it's open, which is faster and has no limits; zotero.org otherwise.

The Zotero app has to let other apps in once: in Zotero, open **Settings → Advanced** and turn on **"Allow other applications on this computer to communicate with Zotero"**. The first time Latex4All saves something there (a highlight, a tag), Zotero asks for permission: choose **Always Allow**. Through the app, PDFs that are *linked files* in Zotero open too, which zotero.org can't serve.

**Zotero's database as a last resort** (off unless you turn it on) is for when neither the app nor zotero.org answers, say offline with Zotero closed. Latex4All then reads a copy of Zotero's database: you can browse, search and open papers with their highlights, but nothing is saved to Zotero and .bib files aren't updated until Zotero or zotero.org is back. Your Zotero files are never changed.

A notice says when a fallback takes over and when zotero.org is back. Changes to these settings apply straight away; nothing needs a restart.

| | zotero.org up | zotero.org down, Zotero app open | Both unreachable, database on |
|---|---|---|---|
| Browse and search | ✓ | ✓ | ✓ |
| Open PDFs with highlights | ✓ | ✓ | ✓ |
| Save highlights, notes, tags | ✓ | ✓ | — |
| Update .bib files | ✓ | ✓ | — |

PDFs from Zotero open from the Zotero app's own copy on this computer whenever there is one, so they don't need downloading. With **Zotero on this computer** set to Off, they always come from zotero.org.

[Open Settings → Zotero](app:settings/zotero)

## Reading papers

Click a paper with a PDF to read it. Inside a project it opens in a tab of the PDF pane; the button in the tab's header moves it to the side panel. On the Library & Vault page it opens under the list.

- **Highlight** by selecting text and picking a color. Highlights are saved in Zotero, like the ones you make there.
- **Right-click a highlight** to change its color, write a note on it, delete it, or add it to an idea or topic.
- **Follow a link** in the PDF, such as a citation, and press ⌘[ to go back.
- **Offline:** turn on "Keep PDFs for offline reading" in Settings → Zotero.

## Your vault

The vault is your Obsidian vault, opened from the Vault panel. Connect it in **Settings → Vault**: a folder on this computer, or a WebDAV server (Nextcloud, Seafile…). It stays an ordinary Obsidian vault: everything Latex4All writes is plain Markdown that Obsidian reads too.

- **Sections:** notes are listed by type (Papers, Ideas, Topics, and any type of your own). Each section folds away, and stays as you left it.
- **Papers in your Zotero folders:** inside Papers, notes are sorted into the folders they have in Zotero. A folder shows up once one of your vault papers is in it; a paper in several folders is listed in each (it's still one note); papers in no folder are under **Unfiled**.
- **Search** takes the same `author:` and `year:` conditions as the library, plus `topic:` and `type:`; the sliders button filters by type and topic, and the menu beside the search sorts. While you search, results are listed flat.
- **Add a paper to the vault** by right-clicking it in the Zotero library, or with **Add to vault** in the vault's Project tab. Its note lists its details and your highlights, and the paper gets the **vault tag** in Zotero (`obsidian` unless you choose another in Settings → Vault, such as `vault`), so you can see in Zotero which papers have notes.
- **Right-click a note** to change its type, connect it to an idea or topic, or delete it.
- **The map** shows how notes link. On the Library & Vault page it shows the whole vault.

[Open Settings → Vault](app:settings/vault)

## The vault inside a project

With a project open, the Vault panel has two tabs.

**Project** shows the vault from where your text stands:

- **The project's note:** **Create project note** makes a note with what the project cites, its outline and its highlights, and keeps it up to date as you write. Once it exists, click its name to open it, or **Update**, which refreshes it without leaving the tab.
- **Citations at a glance:** how many papers you cite, and how many aren't in a .bib, are never cited, or have no note in the vault. **Add to the vault** makes notes for the missing ones; **Check citations** lists every problem.
- **Cited in this project:** each paper with the lines where it's cited. Papers without a note have their own **Add to vault** button.
- **Ideas & topics in play:** the ideas and topics your cited papers belong to, with how many of them each has.
- **Worth citing?** Papers from your vault in those same ideas and topics that this project doesn't cite yet, those sharing the most first.

**All notes** is the whole vault, as on the Library & Vault page. The panel remembers which tab you used last. Notes open the same way from either tab, and the back arrow returns you.

## Ideas and topics

Topics and ideas are vault notes that collect passages, word for word, with a link back to where each came from. A **topic** is a subject ("Corporate science"); an **idea** is a claim you could argue for or against ("Tight budgets favor cost over frontier R&D").

- **From a paper:** select text and choose **Add to idea…** or **Add to topic…**, or right-click a highlight you already have.
- **From your own writing:** do the same in the editor or the compiled PDF. The link opens the project at that file and line.
- **A whole paper:** right-click it in the Zotero library, or its note in the vault, and choose **Connect to topic** or **Connect to idea**.

Pick a note from the list, or type a new name. Picking from the list keeps one note per idea, instead of near-duplicates with slightly different names.

**In Zotero**, an idea or topic is a tag: `idea: <name>` or `topic: <name>`, with the note's exact name. Latex4All adds that tag when you connect a paper or file a highlight here; it doesn't change your Zotero library on its own.

If you'd like Zotero to suggest these names while you tag there, turn on **Ideas and topics as Zotero tags** in Settings → Zotero (or in the tag manager). Latex4All then keeps one note in your Zotero library, **"Ideas and topics in your vault"**, carrying a tag for every idea, topic and note of your own types that have a Zotero tag, and follows the vault as you add, rename or remove them. A note you rename in Obsidian keeps its tag, so no second one is made. Nothing else in Zotero is changed. If it can't (a read-only API key, say), a notice says why.

**Zotero's automatic tags** are the ones Zotero adds by itself from publishers' data and importers (shown in a different color in Zotero's tag list). They aren't yours, so Latex4All leaves them out: they don't become topics, and their spellings aren't followed.

Tags you add in Zotero yourself are read when a paper is added to the vault: a paper tagged `topic: <name>` is linked to that topic. Turning tags on highlights into passages as you tag them in Zotero needs a Zotero-to-Obsidian sync running alongside, such as an Obsidian plugin.

## Tag manager

The tag manager turns Zotero tags into vault notes, for when your library is organised with tags already. Open it from **Settings → Vault → Note types → Tag manager…**, or ⌘K.

1. **Pick the tags.** Every tag you made in Zotero is listed, with how many items carry it. Zotero's automatic tags (from publishers and importers) are hidden. Tags that look like a reading status (`read`, `to read`) are marked: they're better left as tags.
2. **Choose the type and the name** for each: a topic, an idea, one of your own types, or **New type…**, which adds the type to Note types with its folder and Zotero tag. A tag written `method: Diff-in-diff` is recognised as a Method note named "Diff-in-diff".
3. **Preview** says what will happen: a new note, or your note of that name paired; how many papers it lists and highlights it copies.
4. **Import** writes the notes.

Each note then lists the papers that carry the tag (linked to their notes; papers without one are listed with a Zotero link, not given notes of their own) and copies the highlights that carry it, word for word, with links back. It records its exact tag (`zotero_tag:`), so it stays paired even if you rename it.

- **Update paired notes as you tag in Zotero** (on by default): tag another paper or highlight in Zotero, and its note follows within minutes. Only the vault is written.
- **Notes of these types become tags in Zotero** (off by default): see Ideas and topics.
- Your Zotero tags are never renamed or removed. What you write in a note outside its Zotero section is never touched, and nothing is copied twice: a passage already in the note, put there with "Add to idea" or by a Zotero sync, isn't repeated.

## Note types

Settings → Vault → **Note types** decides what each kind of note is and where it lives.

- **Built in:** paper, project, topic, idea and plain notes. Each can have a color and a folder.
- **Your own types:** **Add a type**, name it (say "Method"), and give it a color, a folder and, if you like, an **Obsidian tag**. Choosing the type for a note moves it into that folder. Notes already in the folder, or carrying the Obsidian tag (`#method`), get the type on their own.
- **Zotero tag:** the word that pairs a type with Zotero. Ideas use `idea` and topics `topic`; give your own type one (say `method`) and its notes pair with Zotero tags written `method: <note name>`. Leave it empty to keep the type out of Zotero.
- A note's type can also be picked by hand: right-click the note.

Types are kept in the vault itself, in `Latex4All/Note types.md`, so every computer using the vault has the same ones. Change them here rather than in that file.

[Open Settings → Vault](app:settings/vault)

## When Zotero misbehaves

- **"Zotero is temporarily unavailable"**: zotero.org is busy or down. Latex4All tries again for short hiccups. Set **Zotero on this computer** to *As fallback* or *Always* and keep the Zotero app open to carry on meanwhile.
- **"Zotero didn't allow saving"**: your API key is read-only. Make a new key with write access at zotero.org and connect again in Settings → Zotero.
- **"Zotero didn't let Latex4All save"**: you said no when the Zotero app asked. Save again and choose **Always Allow**, or set **Zotero on this computer** to Off.
- **The Zotero button says the app doesn't let other apps in**: turn on Zotero → Settings → Advanced → "Allow other applications on this computer to communicate with Zotero".
- **A PDF won't open, "a linked file"**: the PDF isn't stored in Zotero but linked from a folder. Open the Zotero app on this computer.
- **New items don't show**: press the refresh arrow on the Zotero section, or **Update** in Settings → Zotero.

[Open Settings → Zotero](app:settings/zotero)

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
