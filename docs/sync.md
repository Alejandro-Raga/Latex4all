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

Each device shares its projects (without opening them: a link now, the files
go in the first time it's opened) and adds them to the list, and fetches the
ones it lacks into its projects folder (their files are written the first
time they're opened). From then on each project syncs as a shared project.
A project's owner is any of the linked devices, so the one you shared from
and your other computers count as you.

Still to come: app data (Planner, Inbox, reading lists, PDF highlights) in
the library; removing a project from every device.

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

## Moving over from the relay

1. While the relay exists, the app keeps syncing with it as well. Changes go
   both ways, so members who haven't updated keep working.
2. The relay server itself becomes a hub, and imports its own log as its
   entries, in the relay's order and signed with its key. Members get them
   from it like any other entries, so the history is the same for everyone
   and nothing is lost.
3. New changes are written by each copy under its own id and sent to peers
   and to the relay.
4. When every member of a project is on peer-to-peer sync and a hub (or the
   members themselves) holds the log, the relay copy can be retired. The app
   says when that's safe; nothing is deleted before.

Before any of this runs on a project, the app takes a history snapshot of it,
as it does before every sync today.

## Pieces

- `crates/l4a-sync`: the log, version vectors, the protocol and connections.
  No dependency on the rest of the app, so it builds and tests anywhere.
- The desktop app (`apps/desktop`): uses the crate for shared projects; the
  share link and popover stay as they are.
- `l4a-hub`: the same crate as a small program without a window.
- Later, the iPad app: reader, vault and Planner, syncing the same way.
