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
author counts up. A copy's knowledge is a *version vector*: for each author,
the highest number it has. Two copies that meet exchange vectors and send each
other what the other lacks. Nothing needs a central order; changes merge as
Yjs merges them today.

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

A folder only delivers between members who can all open it, so it's chosen
per project, and the share link says which service it's on. Members without
access keep syncing through the Latex4All server; a member with both passes
changes between them.

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

## Moving over from the relay

1. While the relay exists, the app keeps syncing with it as well. Changes go
   both ways, so members who haven't updated keep working.
2. The relay's log is imported as the entries of one author, `relay`,
   numbered by the relay's own sequence. Every member imports the same
   numbers, so the same entry is never counted twice, and nothing is lost.
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
