## Getting started

Latex4All is for writing research in LaTeX with your sources close at hand. Your Zotero library, the PDFs you read and your notes in Obsidian sit in the same window as the document you're writing, so you can cite, quote and check your reading without switching apps.

Everything starts on the **All projects** page:

- **New** starts a project, blank or from a template.
- **Import** opens a folder already on your computer.
- **Join** opens a project someone shared with you.

Right-click a project to star it, set its type, duplicate it, move it or remove it from the list. ⌘K searches projects, files, notes and commands.

Inside a project, your files are on the left, the editor in the middle and the PDF on the right. The icons on the far right open three side panels: **Reference** (your Zotero library), **Vault** (your notes) and **Notes** (comments on your text).

[Open the projects page](app:projects)

## Writing and compiling

Files save as you type. **Compile** with ⌘↵ or the button above the PDF; the first compile downloads the packages the project needs.

- **The ribbon** above the editor inserts the LaTeX for common things: formatting, lists, figures, tables, equations, footnotes and citations.
- **Text and PDF:** double-click a spot in the PDF to jump to its line in the source.
- **Spelling and grammar:** choose the language at the end of the ribbon. The grammar check runs on your computer.
- **Words:** right-click a word for its definition and synonyms.
- **Export PDF** saves the PDF. The button beside it saves every compile to a name and folder you choose.

## Comments and suggestions

Select text in the editor or the PDF to comment on it, the way you would on a draft:

- **Highlight** it in a color.
- **Add note** to leave a comment others can reply to and resolve.
- **Suggest edit** to propose new wording that can be accepted or rejected.

The **Notes** panel lists them all. Right-click one to file the passage under an idea or topic in your vault.

## History

Latex4All keeps snapshots of your project as you work. Open **History** (the clock above the PDF) to see what changed and go back to an earlier version. Going back can itself be undone.

## References and Zotero

Connect your Zotero library in **Settings → Zotero**, by signing in or with an API key from zotero.org. A key with write access lets the highlights, notes and tags you make here reach Zotero. The library then appears in the **Reference** panel, and a copy is kept on your computer so it opens at once and works offline.

- **Cite** from the ribbon, in the text or in parentheses.
- **Add to a .bib file:** right-click a paper or a whole collection.
- **Search** by title or author, or narrow by `author:`, `year:` and `type:`.
- **Check citations** (in ⌘K) lists citations missing from your bibliography, entries you never cite, and papers with no note in your vault. Its **Duplicates** tab finds a paper entered twice under different keys and merges them, with undo.
- **Refresh** (the arrow on the Zotero section) brings in what changed in Zotero.

[Open Settings → Zotero](app:settings/zotero)

## Where Zotero data comes from

Latex4All reads your library from zotero.org, or from the Zotero app on your computer. The **Zotero** button in the editor's toolbar shows which is in use, with a colored dot, and holds the settings.

**Zotero on this computer** chooses when the Zotero app is used:

- **Off:** zotero.org only.
- **As fallback:** zotero.org, and the Zotero app when zotero.org can't be reached.
- **Always:** the Zotero app whenever it's open.

To let Latex4All use the Zotero app, turn on **Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"** in Zotero. The first time Latex4All saves something there, Zotero asks for permission; choose **Always Allow**.

**Zotero's database as a last resort** lets you browse and read papers when neither is available, such as offline with Zotero closed. Nothing is saved to Zotero in that mode.

[Open Settings → Zotero](app:settings/zotero)

## Reading papers

Click a paper with a PDF to read it, in a tab beside your document or in the side panel.

- **Highlight** by selecting text and choosing a color. Highlights are saved in Zotero, like the ones you make there.
- **Right-click a highlight** to change its color, add a note, delete it, or add it to an idea or topic. The menu also lists the vault notes it's already in.
- **Follow a link** in the PDF, such as a citation, and press ⌘[ to come back.
- **Offline reading:** turn on "Keep PDFs for offline reading" in Settings → Zotero.

## Your vault

The vault is your Obsidian vault: a folder on your computer, or one on a WebDAV server. Connect it in **Settings → Vault**. Latex4All writes plain Markdown, so the vault stays an ordinary Obsidian vault.

- **Notes are grouped by type:** papers, ideas, topics, and types of your own. Papers are also sorted into their Zotero collections.
- **Add a paper** by right-clicking it in the library. Its note holds the paper's details and your highlights.
- **Highlights in a note** show the passage, its color and page, with your comment beneath. Right-click one to add it to an idea or topic, or open it in the PDF. The other notes that quote it are listed below it.
- **Right-click a note** to change its type, connect it to an idea or topic, or delete it.
- **The map** shows how your notes link to each other.

[Open Settings → Vault](app:settings/vault)

## The vault inside a project

With a project open, the Vault panel has two tabs.

**Project** looks at the vault from your document's point of view: the papers it cites and where, the ideas and topics they belong to, papers from those ideas and topics you haven't cited yet, and a project note that keeps a summary of all this in your vault.

**All notes** is the whole vault.

## Ideas and topics

Ideas and topics are notes that collect passages, word for word, each with a link back to where it came from. A **topic** is a subject, such as "Renewable energy". An **idea** is a claim you could argue, such as "Remote work raises productivity". Gathering passages this way builds the material for an argument as you read.

- **From a paper or your own text:** select a passage, or right-click a highlight, and choose **Add to idea…** or **Add to topic…**.
- **A whole paper:** right-click it and choose **Connect to idea** or **Connect to topic**.

Pick an existing note from the list or type a new name.

In Zotero, an idea or topic is a tag, such as `topic: Renewable energy`. Latex4All adds the tag when you file something here. **Ideas and topics as Zotero tags** (Settings → Zotero) lets Zotero suggest these names while you tag there.

## Your vault from Zotero

The Zotero sync lets you build your vault from any Zotero app, including on a tablet, using tags:

- **The vault tag** (`obsidian` unless you choose another) gives a paper a note in the vault, with its highlights and comments, kept up to date.
- **Tags written `type: name`**, such as `topic: Renewable energy`, file a paper or highlight in that note, and make the note if it's new.
- **A highlight tagged `idea`** becomes an idea note named after your comment on it.

To set it up, open **Settings → Zotero sync** and turn it on. The page shows how to tag in Zotero, the vault tag and folders, and your own kinds of note. **Choose which tags make notes** lists your Zotero tags: pair a tag you already use with a note, or stop one you no longer want notes from (its notes stay).

The sync runs while Latex4All is open and only reads from Zotero. What you write in a note outside its Zotero section is kept. A note you rename is followed; one you delete isn't made again. With the vault on several computers, one of them syncs at a time.

[Open Settings → Zotero sync](app:settings/zotero-sync)

## Note types

**Settings → Vault → Note types** decides what kinds of notes your vault has and where each lives. Besides the built-in types (paper, project, topic, idea and plain notes), you can add your own, such as "Method", with a color and a folder. Its Zotero tag word, set in **Settings → Zotero sync**, makes tags written `word: name` in Zotero create notes of that type.

Note types are saved in the vault, so every computer using it has the same ones.

[Open Settings → Vault](app:settings/vault)

## When Zotero misbehaves

- **"Zotero is temporarily unavailable":** zotero.org is busy or down. Set **Zotero on this computer** to *As fallback* and keep the Zotero app open to carry on.
- **"Zotero didn't allow saving":** your API key is read-only. Create one with write access and connect again.
- **"Zotero didn't let Latex4All save":** the Zotero app asked for permission and was refused. Save again and choose **Always Allow**.
- **A PDF won't open:** it may be a linked file, stored outside Zotero. Open the Zotero app on this computer.
- **New items don't show:** press the refresh arrow on the Zotero section.

[Open Settings → Zotero](app:settings/zotero)

## Chat assistant

The chat opens from the round button at the bottom of the editor. The assistant can read your project and edit it; every change appears in the editor for you to keep or undo.

- **Choose the assistant** next to the send button. Claude, ChatGPT, Gemini and GitHub Copilot work with your own account. Add them in **Settings → Provider**.
- **On selected text,** quick actions improve, shorten, translate or explain it.
- **Ask about part of the PDF** with ⌘⇧X: drag over it and it's sent as an image.
- **Memory:** AGENTS.md holds notes every assistant in the project reads.

[Open Settings → Provider](app:settings/provider)

## Shared projects

Click **Share** above the editor for an invite link. Whoever opens it with **Join** works on the same project with you, and you see each other's cursors. Changes made offline are merged when you reconnect, and everything is encrypted before it leaves your computer. To work on a project from two computers, share it and join it from the other one.

## Updates and bug reports

Updates install after you agree. **Settings → Updates** chooses between **Release**, finished versions, and **Test**, the newest work.

**Report a bug** is on the projects page and in ⌘K. Describe what happened and add a screenshot if it helps.

[Open Settings → Updates](app:settings/updates)

## Keyboard shortcuts

On Windows and Linux, use Ctrl where it says ⌘.

| Keys | Does |
| --- | --- |
| ⌘K | Search projects, files, notes and commands |
| ⌘, | Settings |
| ⌘S | Save |
| ⌘↵ | Compile |
| ⌘F | Find and replace |
| ⌘B / ⌘I | Bold / italic |
| ⌘/ | Comment out lines |
| ⌘⇧H | Highlight the selection |
| ⌘⌥M | Comment on the selection |
| ⌘⌥E | Suggest an edit |
| ⌘Y / ⌘N | Keep / undo all of the assistant's changes |
| ⌘⇧X | Ask about part of the PDF |
| ⌘⌥1, 2, 3 | Reference, Vault, Notes panels |
| ⌘⇧[ / ⌘⇧] | Previous / next PDF tab |
| ⌘[ | Back after following a link in a PDF |
| ⌘T / ⌘W | New / close chat |
| ⌘⇧N | New window |
| ⌘+ / ⌘− | Zoom |
