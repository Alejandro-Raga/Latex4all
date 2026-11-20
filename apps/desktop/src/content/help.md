## Getting started

Latex4All is a LaTeX editor with your Zotero library, your PDFs and your notes in the same window. You can cite, quote and check a source without leaving the document.

The app opens on **All projects**.

### Start a project

- Click **New** and choose a blank project or a template. You can give it a type, a priority and a deadline here, or later.
- To open a folder you already have, click **Add**, then **Import a folder…**
- To open a project someone shared with you, click **Add**, then **Join a shared project…**

### Find and arrange projects

- Type in **Search**, or press ⌘K to search projects, files, notes and commands.
- The chips above the projects show one type at a time.
- Click the arrows next to the chips to sort the projects by when you opened them, when they were added or created, their type, or their priority.
- Switch between cards and a list with the two buttons on the right. The slider changes the size of the cards.

### Put projects in folders

Folders group projects by what they are for, such as Thesis or Teaching. Nothing moves on your disk.

1. Click **Add**, then **New folder…** and give it a name.
2. Right-click a project and choose **Add to folder**.

Folders show at the top when projects are in the Recent order. Click one to open it, and click **All projects** in the title to go back. Right-click a folder to rename it, give it a color, mark it as a favourite or delete it. Deleting a folder keeps its projects.

In the other orders every project is listed, and its card shows the folder it's in.

### Project cards

Hover a card for **Open PDF**, **Show in Finder** and **Duplicate**. Right-click it to star it, set its type, move it or remove it. If a project's folder was moved outside Latex4All, the card says so; click it to find the folder again.

### Inside a project

Your files are on the left, the editor in the middle and the PDF on the right. The icons on the far right open the side panels: **Library**, **Vault**, **Notes** and **Plan**.

Under the project's name, a small strip shows when the project is due, its next task and the paper you're reading for it. Click it to open the Plan.

### Move around the app

The menu on the far left is there in every part of the app. Click the arrow at its top to show names next to the icons.

- **Home** shows your projects.
- **Writing** opens the project you're working on. If none is open, it opens the last one you used.
- **Planner** and **Library & Vault** open with your project still open. From a project, the Planner opens on its list and the Library on its folder.
- **Settings**, **Help** and **Report a bug** are at the bottom.

The app opens where you left off: in the part you were in, or in your last project if you were writing. The Library and the vault reopen on the paper, project and note you had open.

The app opens where you left off: in the part you were in, or in your last project if you were writing. The Library and the vault reopen on the paper, project and note you had open.

You can also press ⌘1 for Home, ⌘2 for Library & Vault, ⌘3 for the Planner and ⌘4 for Writing. They're in ⌘K too.

Other ways to move around:

- **Open in Planner** (the arrow on the strip under the project's name, in the Plan panel, or on a project's card) shows the project's full plan: calendar, matrix, timeline.
- In a project, the full-window button above a PDF (or ⌘⇧F) gives it the whole window to read. Press Esc to bring everything back.
- After opening a project or a paper from the Planner, **Back to Planner** at the bottom of the window takes you back.
- To close the project, right-click its name and choose **Close project**.

### Appearance

**Settings → Appearance** sets the theme. **Menus** makes menus and popups **Clear**, **Frosted** or **Solid**. **Background** can be **Flat** or a **Gradient** of the theme's colors. **Interface size** makes everything bigger or smaller, from **Small** to **Largest**. The app opens at that size. ⌘+ and ⌘− change it until you quit, and ⌘0 goes back to it.

[Open the projects page](app:projects)

## Writing and compiling

Files save as you type.

- Press ⌘↵, or click the button above the PDF, to compile. The first compile downloads the packages the project needs.
- The ribbon above the editor inserts formatting, lists, figures, tables, equations, footnotes and citations.
- Double-click a spot in the PDF to jump to that line in the source.
- Choose the spelling language at the end of the ribbon. The grammar check runs on your computer.
- Right-click a word for its definition and synonyms.
- **Export PDF** saves the PDF. The button next to it saves every compile to a name and folder you choose.

## Comments and suggestions

Select text in the editor or in the PDF, then choose:

- **Highlight**, to mark it in a color.
- **Comment**, to leave a comment that others can answer and resolve.
- **Suggest edit**, to propose new wording that can be accepted or rejected.

The **Notes** panel lists all of them. Right-click one to add the passage to a note in your vault.

## History

Latex4All saves snapshots of the project as you work. Click the clock above the PDF to see what changed and go back to an earlier version. Going back can be undone.

## References and Zotero

### Connect Zotero

Open **Settings → Zotero** and sign in, or paste an API key from zotero.org. Give the key write access if you want your highlights, notes and tags to reach Zotero. Your library then appears in the **Library** panel. A copy is kept on your computer, so it opens straight away and works offline.

[Open Settings → Zotero](app:settings/zotero)

### Cite and manage references

- Click **Cite** in the ribbon to cite in the text or in parentheses.
- Right-click a paper, or a whole collection, to add it to a .bib file.
- Search by title or author. `author:`, `year:` and `type:` narrow the search.
- Click the refresh arrow on the Zotero section to bring in what changed in Zotero.
- **Check citations** (in ⌘K) lists citations missing from your bibliography, entries you never cite, and papers with no note in your vault. The **Duplicates** tab finds a paper entered twice and merges the two. You can undo it.

### Where the library comes from

Latex4All reads your library from zotero.org or from the Zotero app on your computer. The **Zotero** button in the editor's toolbar shows which one is in use.

**Zotero on this computer** decides when the Zotero app is used:

- **Off**: only zotero.org.
- **As fallback**: zotero.org, and the Zotero app when zotero.org can't be reached.
- **Always**: the Zotero app whenever it is open.

For Latex4All to use the Zotero app, open Zotero's **Settings → Advanced** and turn on "Allow other applications on this computer to communicate with Zotero". The first time Latex4All saves something there, Zotero asks for permission. Choose **Always Allow**.

**Zotero's database as a last resort** lets you browse and read when neither is available, for example offline with Zotero closed. Nothing is saved to Zotero in that mode.

### When Zotero misbehaves

- "Zotero is temporarily unavailable": zotero.org is busy or down. Set **Zotero on this computer** to **As fallback** and keep the Zotero app open.
- "Zotero didn't allow saving": your API key is read-only. Make one with write access and connect again.
- "Zotero didn't let Latex4All save": the Zotero app asked for permission and it was refused. Save again and choose **Always Allow**.
- A PDF won't open: it may be a linked file stored outside Zotero. Open the Zotero app on this computer.
- New items don't show: click the refresh arrow on the Zotero section.

## Reading papers

Click a paper that has a PDF to read it. Inside a project it opens in a tab next to your document; on the **Library & Vault** page it opens below or beside the list.

- To highlight, select text and pick a color. A box opens for a comment: type it and press Enter, or keep reading to skip it. Highlights are saved in Zotero.
- To comment first, select text and choose **Comment**, then pick the color in the box.
- Click or right-click a highlight to change its color, add a comment, delete it, or add it to a note. The menu also lists the notes it is already in.
- Click a link in the PDF, such as a citation, and press ⌘[ to come back.
- Click the bookmark button at the top of the reader to mark the page where you stopped. The paper opens there next time, and its progress on your reading list follows the bookmark. Without a bookmark, it opens on the last page you had open.
- On the **Library & Vault** page, click **Read in full window**, or press ⌘F, to hide the list, the vault and the sidebar. Press ⌘F or Esc to bring them back.
- **Recently opened**, at the top of the Library, lists the last papers you read. Click one to open it again.
- A PDF in one of your projects, such as a draft you're revising, opens in the same reader. In the Library, click a project under **Projects** to list its PDFs, then click one to read it. To see the project's other files, click **Show all files**. You can highlight it, comment on it and add highlights to notes, as on a Zotero paper. The highlights are kept on this computer. A highlight added to a note links back to its page in the PDF. When you rebuild the PDF, each highlight moves with its text. If you rewrote that text, the highlight leaves the page and is listed under **From earlier versions** at the top of the reader. It comes back if the text returns.
- To read offline, turn on **Keep PDFs for offline reading** in **Settings → Zotero**.

## Your vault

The vault is a folder of notes in Markdown, the same format Obsidian uses. It can be a folder on your computer or on a WebDAV server. Connect it in **Settings → Vault**. You don't need Obsidian installed; if you do use it, it opens the same vault.

- Notes are grouped by type, such as papers, ideas and topics. Papers are also sorted by their Zotero collections.
- To add a paper, right-click it in the Library and choose **Add to vault**. Its note holds the paper's details and your highlights.
- In a paper's note, each highlight shows the passage, its color and page, and your comment. Right-click one to add it to another note or open it in the PDF.
- Click **+** above the list for a new topic, idea or plain note.
- Right-click a note to change its type, connect it to another note, add a task about it, rename it or delete it. Links to a renamed note follow it.
- The pills under a note show what it is connected to, such as Papers 12 or Topics 3. Click a pill to list those notes.
- The map shows how your notes link to each other.

[Open Settings → Vault](app:settings/vault)

### Ideas and topics

A topic is a subject, such as "Renewable energy". An idea is a claim you could argue, such as "Remote work raises productivity". Both collect passages word for word, each with a link back to its source.

- To add a passage, select it in a paper or in your own text, or right-click a highlight, and choose **Add to note**.
- To add a whole paper, right-click it and choose **Connect to note**.

Pick a note by its type, or choose **New …** at the end of the list to make one.

In Zotero, an idea or topic is a tag, such as `topic: Renewable energy`. Latex4All adds the tag when you file something here.

### The vault inside a project

With a project open, the **Vault** panel has two tabs. **Project** shows the papers your document cites and where, the ideas and topics they belong to, and papers from those ideas and topics you haven't cited yet. **All notes** is the whole vault.

### Note types

**Settings → Vault → Note types** lists the kinds of notes in your vault and the folder for each. You can add your own, such as "Method", with a color and a folder. Note types are saved in the vault, so every computer that uses it has the same ones.

## Your vault from Zotero

You can build your vault from any Zotero app, including on a tablet, by tagging items:

- The vault tag (`obsidian` unless you change it) gives a paper a note in the vault with its highlights and comments, kept up to date.
- A tag written `type: name`, such as `topic: Renewable energy`, files the paper or highlight in that note, and makes the note if it doesn't exist.
- A highlight tagged `idea` becomes an idea note named after your comment.

To turn this on, open **Settings → Zotero notes**. **Choose which tags make notes** lists your Zotero tags so you can pair one with a note, or stop one from making notes.

The sync runs while Latex4All is open and only reads from Zotero. Anything you write in a note outside its Zotero section is kept. If the vault is on several computers, one of them syncs at a time.

[Open Settings → Zotero notes](app:settings/zotero-sync)

## Planner

Open **Planner** in the sidebar of the start screen. Each project has its own list of tasks and papers to read. The **Inbox** is for everything else, and you can make more lists of your own.

### Add a task

Type it in the box at the top of a list, the way you would say it: "Draft the intro friday !high". Latex4All reads the date and the priority for you.

- Dates: today, tomorrow, friday, next week, in 3 days, 20 nov. Spanish works too: mañana, el viernes.
- Priority: add **!high**, **!medium** or **!low**.
- Repeats: add "every week", "every 2 weeks", "every week on mon and thu" or "weekdays" ("cada semana" also works). For anything else, open the task, click **Repeat** and choose **Custom…**: how often, on which days, and when it ends. When you check off a repeating task, it comes back with its next date.
- Tags: words like **#writing** group tasks.

To add a task from anywhere in the app, press ⌘⇧A.

### Work with tasks

- Click a task to open it on the right. There you can change its date, repeat and priority, write a description, add subtasks, and pin notes to it.
- Subtasks are tasks too. Click one to open it, with its own date and its own subtasks. The link at the top takes you back to the task it belongs to.
- Click **Pin a note** to attach a paper, idea, topic or project note from your vault. Click a pinned note to open it. A pinned project has **Open**, which opens the project, and a pinned paper has **Read**.
- Right-click a task to set its date or priority, move it, make it a subtask of another, turn it into a project, or delete it.
- Drag a task to reorder it or to move it to another section. Drop it on the middle of another task to make it a subtask. Drop it on a list in the sidebar to move it there, or on **Today** or **Tomorrow** to give it that date.

### Lists of your own

Click **New list** under the Inbox for things that don't belong to a project, such as Teaching. Each list has its own tasks and its own reading list. Right-click a list to change its color or remove it.

Your lists, the Inbox and general reading are kept by Latex4All on this computer, not in your vault.

### Sections

New projects start without sections. Click **Add heading** at the end of a list to add one, such as "Literature review" or "Writing". To give a section a date, open its **…** menu and choose **Set a date**. **Pin a note** in the same menu attaches a paper, idea or topic to the section. The **…** next to a section renames or deletes it; its tasks stay.

Switch between **List** and **Board** at the top. On the board, each section is a column.

### Projects in the Planner

- **Deadline** and **Priority**, at the top of a project, set its submission date and how important it is. Both show next to the project in the sidebar and on its card on the projects page.
- **Timeline** shows the project's milestones, such as a first draft, on a line from today to the deadline. Add one like a task: "First draft dec 1". Click its diamond when you reach it.
  - Give a milestone a **Start** date to make it a period, such as "Write chapter 2" from January to March. It shows as a bar above the line, in a row of its own where periods overlap.
  - Click a milestone's icon in the list to choose another icon and color.
  - Zoom with **−**, **Fit** and **+** above the line, or hold ⌘ and scroll. Zoomed in, the line scrolls sideways.
  - Click the list button on a milestone to have it follow a section of the plan. It then shows how much is done, such as "8 of 12", and its bar fills as you finish tasks. It turns red when its date is a week away or less and less than four fifths is done.
  - Drag a milestone, a phase or the deadline along the line to change its date. Drag a phase's left end to move only its start.
  - Small marks under the line are the plan's dated tasks; small squares are dated sections. Point at one to see what it is.
- **Timeline** under **Views** shows every project's milestones and deadline on one line, a row each. Click a project's name to open its own timeline.
- Right-click a project in the sidebar and choose **Open project** to start writing, or **Priority** to set its priority or mark it completed.
- To turn a task into a project, right-click it and choose **Make it a project**. Its subtasks become the project's tasks, and its date and priority become the project's deadline and priority.
- The arrows next to **Projects** sort them by recent use, type, priority, due date, number of tasks or name.

### Views across all your lists

- **Today**, **Tomorrow** and **Next 7 days** show what is due in every list.
- **Calendar** shows dated tasks, milestones, sections and deadlines by month or week. Drag something to another day to change its date. Click a day to see everything on it and add a task. **Export to calendar** saves your dates as a file that Apple Calendar, Google Calendar or Outlook can open.
- **Eisenhower matrix** puts open tasks in four boxes: urgent and important, important but not urgent, urgent but not important, and neither. By default a task is important if its priority is high or highest, and urgent if it's due within four days or overdue. Change both in **Settings → Planner**. Drag a task to another box to change its priority or date. To keep a task and its subtasks out of the matrix, such as a far-off goal, right-click it and choose **Leave out of the matrix**, or click the grid button in its panel.
- **Overview** shows each list and project as a card with its sections and what comes next. Click a card's name to open that list.
- **All tasks** lists everything open, and **Completed** what you've finished.

The first time you open Latex4All each day, a short note tells you what is due or overdue. You can turn it off in **Settings → Planner**.

### Reading

Open **Reading** in the Planner's sidebar to keep up your reading.

- **Now reading** lists the papers you've started. Click **Resume** to open one at your bookmark.
- **Today** shows papers with a "Read by" date that has come.
- **Up next** is everything still to read, from every list. Drag papers to put them in the order you'll read them.
- Drag a paper to another group to change its status: **On hold** for one you've set aside, **To re-read** for one to go back to, **Finished lately** once read.
- **Finished lately** shows what you've read in the last two weeks.
- Add a paper by its title, DOI or a link, or with **Add from Zotero**. Papers added here are general reading; a project's papers go in its own **Reading** tab. You can also right-click a paper in the Library or the vault and choose **Add to reading list**.
- The circle next to a paper shows how far you are. Click it to change the status. Hover a paper and click **Read by** to give it a date.

To set yourself a weekly goal, open **Settings → Planner** and turn on **Weekly reading goal**. Reading then shows how many papers you've finished this week, the pages you've read, and how many days in a row you've read.

While writing, the **Plan** panel (⌘⌥4) shows the project's tasks and reading list next to your text.

A project's tasks are saved in a file called Plan.md in the project, so in a shared project everyone sees the same list.

## Chat assistant

Click the round button at the bottom of the editor to open the chat. The assistant can read your project and edit it. Every change it makes appears in the editor for you to keep or undo.

- Choose the assistant next to the send button. Claude, ChatGPT, Gemini and GitHub Copilot work with your own account; add them in **Settings → Accounts**.
- Select text to improve, shorten, translate or explain it.
- Press ⌘⇧X and drag over part of the PDF to ask about it.
- AGENTS.md holds notes that every assistant in the project reads.

[Open Settings → Accounts](app:settings/provider)

## Shared projects

Click **Share** above the editor to get an invite link. Whoever opens it with **Join** works on the project with you, and you see each other's cursors. Changes made offline are merged when you reconnect. Everything is encrypted before it leaves your computer.

To work on one project from two computers, share it and join it from the other one.

- **Share → Files to sync** chooses which files sync on this computer. Untick files you keep in step another way, such as figures in Dropbox.
- When joining, **Choose which files to download** does the same before anything is downloaded.
- If you already have the project's folder, tick **I already have its folder** and pick it. Its files are compared with the shared ones instead of being downloaded again.

If a text file on your computer differs from the shared one the first time they meet, the shared version is kept and your differences are added as suggestions to accept or reject.

### Conflicted copies

A file that changed in two places at once can end up with a copy next to it, named "(conflicted copy)". Latex4All removes copies that are the same as their original. For the rest, a notice appears above your files. Click **Review** to compare each copy with its original, then **Keep the copy** or **Keep the original**.

Shared projects can also live in a Seafile, Dropbox or OneDrive folder. Latex4All waits until everyone has stopped typing for a few seconds before saving, so those services see one version at a time.

## Updates and bug reports

Updates install when you agree. In **Settings → Updates**, choose **Release** for finished versions or **Test** for the newest work.

**Report a bug** is on the projects page and in ⌘K. Say what happened and add a screenshot if it helps.

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
| ⌘⇧A | Add a task |
| ⌘1, 2, 3, 4 | Projects, Library & Vault, Planner, back to the project |
| ⌘F | Read in full window (Library & Vault) |
| ⌘⌥1, 2, 3, 4 | Library, Vault, Notes, Plan panels |
| ⌘⇧[ / ⌘⇧] | Previous / next PDF tab |
| ⌘[ | Back after following a link in a PDF |
| ⌘T / ⌘W | New / close chat |
| ⌘⇧N | New window |
| ⌘+ / ⌘− | Zoom |
