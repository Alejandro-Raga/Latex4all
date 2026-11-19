# Sync without a central server

Latex4All shares projects between people (co-authors) and between one
person's devices (a laptop and an iPad). Until now every change went through
one relay (`apps/relay`), run by the author of the app. That doesn't scale and
makes everyone depend on one person. This is the design that replaces it.

## Goals

- **No accounts, no servers of ours.** Copies of Latex4All talk to each other
  directly. Nothing is run by the app's author.
- **As easy as today.** Sharing is still "copy the link, send it, open it".
  Nobody sets up networks, ports or domains.
- **Nothing lost in the move.** Projects shared through the relay keep their
  whole history and keep working while groups move over.
- **Always a copy online, if a group wants one.** Any copy can be the group's
  *hub*: it stays connected, keeps everything, and passes changes between
  members who aren't online at the same time.

## How it works

### Members and keys

A shared project has an id and a secret key, as now. The key is in the share
link and never leaves the members' copies. Having the key is what makes you a
member: two copies only sync after each proves it has the key (a challenge
signed with a token derived from it), and everything they exchange is
encrypted with it.

Each copy of the app has its own identity, a key pair made on first launch
(`iroh`'s node id). It is not an account: it isn't registered anywhere.

### Connections

Copies connect with [iroh](https://iroh.computer): QUIC connections dialed by
public key, which get through home and most institutional routers by hole
punching. Where a network blocks that, traffic goes through a relay that only
forwards encrypted bytes it can't read. iroh's public relays are used by
default; a group can run its own. None of this is a Latex4All service.

### The log

A project is a log of encrypted changes, the same changes (Yjs updates,
encrypted by the app) the relay stores today. Every copy keeps the whole log.

Each entry is identified by its author (a copy's node id) and a number that
author counts up, and signed with the author's key. Every copy checks the
signature of everything it receives, so no member, hub or shared folder can
write as someone else or change an entry unseen. If a copy receives an entry
under its own id that it didn't write, its app data was copied to another
computer: it stops writing under that id and takes a new one. A copy's knowledge is a *version vector*: for each author,
the highest number it has. Two copies that meet exchange vectors and send each
other what the other lacks. Nothing needs a central order; changes merge as
Yjs merges them today.

### Snapshots

So the log doesn't grow forever, the app now and then writes a snapshot: the
whole document as of a version vector, encrypted and signed like an entry. A
copy far behind (a newcomer, or a member back after months) gets the latest
snapshot and the entries after it. Entries a snapshot covers are dropped
only once every member heard from recently is known to have them; one gone
longer gets the snapshot when it's back, as a newcomer would.

### Large files

PDFs, figures and data files stay out of the log. Each is stored once, named
by the SHA-256 of its encrypted bytes, and a change refers to it by that
name. A copy fetches a file when it needs it; a hub fetches every file, so
it can hand them on to members who aren't online at the same time. A file is
only kept if its bytes match its name.

### What each member has

Every copy keeps an account of what each member has: from meeting them,
from their acknowledgements as changes arrive, and from what other members
pass on. So a copy knows whose changes haven't reached whom (the status
line), and when old entries can go.

### Removing a member

Only the project's creator (who shared it first, or whoever they handed the
role to) can remove someone. The creator's copy writes a signed record that
starts a new epoch with a new key. The key and a new membership token are
sealed for each member who stays, with that member's own node key, so only
they can open it; a hub gets the token alone, never the key. The removed
member can no longer prove membership, is told it was removed, and its
entries written after the record are refused everywhere.

Members get the record from anyone who has it, as soon as they connect (a
hub has it at once). Until then, a member who hasn't got it still syncs with
others at the old epoch, the removed one included: removal takes effect for
each member when they next connect to someone who has it.

If the creator's copy didn't yet know of a member, that member is *left
out*, not removed: its app and the creator's are told, and the creator
writes a new record including it (the same key). A member left out keeps
the records that missed it and catches up when one includes it.

Nothing about a project (its members, what each has) is sent until both
copies have proven they're members.

### Links and codes

The share link is `latex4all://join/<key>`: the project's id is worked out
from its key, and the relay's address is left out when it's the default
(projects shared before keep their own id in the link, so theirs is a bit
longer). Clicking it opens the app's join dialog.

For typing or reading out, the app makes a code (`K7QM-3XRP-9TWD`, about 59
bits) that stands for the link for 24 hours. The code is turned into a
signing key and an encryption key; the link, encrypted, is published as a
signed record under that key on the pkarr directory iroh already uses
(`dns.iroh.link`). The joiner's app works out the same key from the code,
fetches the record and decrypts it. Without the code the record can't be
found or read (`crates/l4a-sync/src/invite.rs`).

### Finding each other

The share link carries the inviter's node id. A copy that joins connects to
it first. When two copies meet, each tells the other the members it knows of,
and keeps that list next to the project's log. A copy keeps trying the
members it knows but isn't connected to, so after one sync every copy can
reach every other, even once the inviter is offline. iroh resolves node ids
to addresses.

Still to come: a *member* entry in the log (device name, whether it's a hub),
so the app can show who's in a project.

### The hub

Turning on "Keep this computer as the group's hub" keeps a copy connected
and keeps every shared project's log. Members connect to it first. It can be
a desktop left on, or the headless `l4a-hub` (from this crate) on a NAS or a
Raspberry Pi. A hub doesn't need the files themselves, only the log: it never
decrypts anything.

### Linked devices

One person's computers get the same projects (Settings → Sync → Link another
device). The first device shows a code; the other types it. Both then hold
the *library*: a shared document of its own, synced like a shared project
on a connection kept beside the open project's, that lists every project by
its share link and the devices linked.

Each device shares its projects and adds them to the list, and fetches the
ones it lacks into its projects folder. Projects that aren't open sync in the
background (one at a time, each at most every ten minutes, on a connection
of their own; the open one syncs live): files go up from the device that has
them and come down on the others, so nothing needs opening first. Project
cards say "Shared" for projects shared with people and "Synced" (with how
the last sync went) for those in the library; a project can be both.
A project's owner is any of the linked devices, so the one you shared from
and your other computers count as you.

Linked devices are replicas. Every store the app keeps (settings,
favourites, home-screen folders and types, bookmarks, dock, vault and
Zotero settings, reading queue, per-project layouts) goes into the library
as JSON with paths made portable: a project's folder becomes
`@p:<project id>`, anything else under the home folder `@home/…`; on the
way in they become the device's own paths and separators, and entries about
projects it lacks are left out (`app-state-sync.ts`). Per device: identity,
window size and zoom, where new projects go, which folders hold shared
projects, sign-in tokens. The first time a device links it takes the
library's state (the original device's); after that a store changed on one
device goes to the others, the project list put together rather than
replaced.

App data goes in the library too: the app's own Planner lists (when there's
no vault, which syncs by itself) and highlights on PDFs outside Zotero, each
file a text in the library's document. A change goes in as the words that
changed, so edits on two devices both stay; a JSON file that wouldn't parse
once merged takes the device's own version. The first time two devices meet,
files both had are put together (every line of a list, every highlight). A
file deleted on one device is deleted on the others unless changed there.

## Always-on storage

Peer-to-peer alone only delivers changes between copies that are online at
the same time. So every shared project also has an always-on store, which
holds its encrypted changes and passes them on, as the relay does today:

- **A cloud folder (recommended).** A folder on a service the members
  already use (Dropbox, OneDrive, iCloud, Google Drive, Seafile…), shared
  with the project's members. Each copy writes its own encrypted change files
  there and reads everyone else's. It does what the relay does, in the
  users' own accounts. The app offers the folders it finds on the computer.
- **The Latex4All server.** Free, with storage limits per project. The
  default until a folder is chosen, and the fallback for members who can't
  reach the folder (for example, a co-author on another cloud service).
- **This computer**, if it's always on (the hub switch).
- **Your own server**, running `l4a-hub` (Docker).

The folder is chosen once, for the whole app. Inside it, the app makes a
subfolder per shared project by itself (named after the project, with a
small marker file holding the project id). To let co-authors sync through
it, the user shares that project's subfolder with them in their cloud
service; the share popover has a button that shows it in Finder/Explorer.
On a co-author's computer, the app finds the shared subfolder wherever their
service put it (by the marker file) and uses it; if it can't, it asks once.
Members without access keep syncing through the Latex4All server; a member
with both passes changes between them.

Asked on install, once again on the update that brings this, and in
Settings → Sync (the full text lives there):

> **Sync storage**
>
> Latex4All uses a peer-to-peer service to sync, but to guarantee
> asynchronous functionality it needs a secure, always-on storage service. By
> default, this service is offered free of charge, with storage limits per
> project, but you can choose a cloud folder on any service you already use.
> Share that folder with your collaborators so their copies can sync through
> it too. Alternatively, you can set up Latex4All as its own server on your
> personal computer (*Use this computer as a server*), as long as it's always
> on, or install this service on your own dedicated server (*Download the
> Latex4All server*). Everything is encrypted before it leaves your computer.

If the Latex4All server ever goes away, groups keep syncing directly and
through their folders; nothing they have is lost.

### Setting up a hub

`l4a-hub` (in `crates/l4a-sync`) runs without a window. With Docker:

    docker build -t l4a-hub crates/l4a-sync
    docker run -d --restart unless-stopped -v l4a-hub:/data l4a-hub
    docker logs <container>

It prints a hub code: its id and a secret. Pasted in the app (Settings →
Sync → Your own server), the app proves it knows the secret once and becomes
an owner of the hub; it then gives the hub each shared project's id, token
and creator. The hub syncs them like a member, keeps every file, and gets
new tokens when members are removed. No ports, domain or certificates.

### How the folder works

Each copy writes only in its own subfolder (`<folder>/<its id>/`): batches
of entries the folder lacks, its snapshot, and what it has. Files go in
`blobs/`, named by hash. So the cloud service never sees two computers edit
one file. Every file is written beside its place and moved in; nothing is
taken as read until it reads whole (cloud services deliver late, out of
order, or as placeholders), and everything is checked like anything from a
member. A copy whose files were deleted writes them again. The app finds a
co-author's copy of the folder by its marker file, `latex4all-project.json`.

### Rules for the app (when it's wired in)

- While any member of a group uses the Latex4All server, every copy also
  syncs with it, so a group split between a folder and the server never
  drifts apart.
- The relay server, as a hub, skips old-protocol uploads that new copies
  also sent as signed entries (same content), so nothing is stored twice
  during the move.
- The storage prompt shows at the first share or first shared project (and
  once on the update for people who already share), not on install; until
  it's answered, the Latex4All server is used.
- Bug reports include the sync state: routes working, what each member has,
  last errors.

## Error codes

Every sync problem the app shows carries a code, also sent with bug reports.

| Code | What happened | What to do |
|---|---|---|
| R01 | The sync server can't be reached (shown as Offline) | Wait or check the connection; changes are kept and go out later |
| R02 | The project is full on the sync server | Remove large files |
| R03 | The project is no longer shared on the server | Files stay; share again if wanted |
| R04 | The server needs a newer app | Update |
| R05 | A change or file is too large to send (25 MB per file) | Split it, or keep the file out |
| R06 | A file couldn't be uploaded (network, server, file locked) | Retried by itself |
| R07 | A file couldn't be downloaded | Retried by itself |
| R08 | The sync server is nearly full overall | Its owner adds room |
| R09 | The project is nearly full | Remove large files soon |
| P01 | Peer-to-peer can't start (network blocks UDP, or iroh's servers are down) | Nothing: the sync server still carries changes |
| P02 | This computer's sync identity was damaged; a new one was made | Nothing |
| P03 | Two computers sync as one (app data copied) | Restart Latex4All; a new identity was made |
| P04 | Changes refused: not signed by a member | Nothing; reported in case of trouble |
| F01 | The sync folder isn't there | Start the cloud app, or choose the folder again |
| F02 | The sync folder (or this computer's sync data) can't be written | Free space; check permissions |
| H01 | Your server can't be reached | Changes wait; check the server |
| H02 | Your server refused its code | Paste the code again |
| L01 | The device code wasn't found or has expired | Show a new code on the other device |
| L02 | A project from another device couldn't be fetched | Retried every 30 s |
| L03 | A project couldn't be added for the other devices (offline, or too big for the server) | Retried; check its size |
| X01 | A shared copy holds another project's changes, so it isn't synced into this folder | Report it; the folder is untouched |
| X00 | Anything else (its message is shown) | Report it |

Linked devices show theirs (L01–L03) in Settings → Sync.

## Moving over from the relay

Built:

1. The app syncs with the relay and peer to peer at once; members who
   haven't updated keep working.
2. The Latex4All server runs a public hub beside the relay
   (`L4A_HUB_PUBLIC=1`, `L4A_RELAY_DATA`). Every copy adds each shared
   project to it once, proving membership with the project's relay access
   token, which the hub checks against the relay's own record. The hub
   imports the relay's snapshot, updates and files as its own signed
   entries (still sealed: it reads nothing), and every minute imports what
   reached the relay since from copies not yet updated. Entries sent both
   ways are stored twice during the move; Yjs applies each once.
3. Files go peer to peer as well: kept under the hash of their sealed bytes
   (the bytes the relay holds, so the hub's imported files match), noted in
   the document by relay id (`p2pBlobs`), and fetched from members or the
   hub when the relay can't give them.

Still to do, once the beta has run on real groups:

4. The app says when a project no longer needs the relay (every member on
   peer-to-peer, the hub caught up), and new projects stop being created on
   it. Removing a member then changes the project's link too, so removal
   really excludes them.
5. The relay is switched off; nothing it held is lost, since the hub has it.

Before any of this runs on a project, the app takes a history snapshot of it,
as it does before every sync today.

## Pieces

- `crates/l4a-sync`: the log, version vectors, the protocol and connections.
  No dependency on the rest of the app, so it builds and tests anywhere.
- The desktop app (`apps/desktop`): uses the crate for shared projects; the
  share link and popover stay as they are.
- `l4a-hub`: the same crate as a small program without a window.
- Later, the iPad app: reader, vault and Planner, syncing the same way.
