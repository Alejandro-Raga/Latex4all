// On-disk storage for shared projects.
//
// Everything stored is ciphertext the relay can't read: the Yjs updates and
// snapshots of a project's documents, and its binary files ("blobs"). Each
// project is a folder named by its id:
//
//   meta.json      { accessHash, created, lastAccess, chatHead }
//   log.bin        updates after the snapshot: [u64 seq][u32 length][bytes]…
//   snapshot.bin   [u64 upTo][bytes] — the whole project as of update `upTo`
//   blobs/<id>     one file each
//   chat.bin       chat messages: [u64 seq][u64 at][u32 length][bytes]…, each
//                  kept for `chatDays` and the oldest dropped past `maxChatBytes`
//
// A project's log and snapshot are held in memory while anyone has it open.

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PROJECT_ID = /^[0-9a-f]{32}$/;
export const BLOB_ID = /^[0-9a-f]{64}$/;
export const ACCESS_HASH = /^[0-9a-f]{64}$/;

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readLog(file) {
  const entries = [];
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return entries;
  }
  let offset = 0;
  while (offset + 12 <= buf.length) {
    const seq = Number(buf.readBigUInt64BE(offset));
    const length = buf.readUInt32BE(offset + 8);
    if (offset + 12 + length > buf.length) break;
    entries.push({
      seq,
      data: buf.subarray(offset + 12, offset + 12 + length),
    });
    offset += 12 + length;
  }
  // A crash mid-append leaves a partial record at the end. Cut it off, or
  // every update appended after it would be unreadable too.
  if (offset < buf.length) fs.truncateSync(file, offset);
  return entries;
}

const DAY = 24 * 60 * 60 * 1000;

function readChat(file) {
  const messages = [];
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return messages;
  }
  let offset = 0;
  while (offset + 20 <= buf.length) {
    const seq = Number(buf.readBigUInt64BE(offset));
    const at = Number(buf.readBigUInt64BE(offset + 8));
    const length = buf.readUInt32BE(offset + 16);
    if (offset + 20 + length > buf.length) break;
    messages.push({
      seq,
      at,
      data: buf.subarray(offset + 20, offset + 20 + length),
    });
    offset += 20 + length;
  }
  if (offset < buf.length) fs.truncateSync(file, offset);
  return messages;
}

function encodeChat({ seq, at, data }) {
  const header = Buffer.alloc(20);
  header.writeBigUInt64BE(BigInt(seq));
  header.writeBigUInt64BE(BigInt(at), 8);
  header.writeUInt32BE(data.length, 16);
  return Buffer.concat([header, data]);
}

function chatBytes(messages) {
  return messages.reduce((sum, m) => sum + m.data.length + 20, 0);
}

/**
 * Drops chat messages older than `cutoff` from a project's folder, without
 * loading the rest of it. Returns the bytes freed.
 */
function expireChatFile(dir, meta, cutoff) {
  const file = path.join(dir, "chat.bin");
  const messages = readChat(file);
  const kept = messages.filter((m) => m.at >= cutoff);
  if (kept.length === messages.length) return 0;
  // The seq only ever goes up, even once every message has expired.
  const head = messages.at(-1)?.seq ?? 0;
  if (head > (meta.chatHead ?? 0)) {
    meta.chatHead = head;
    writeAtomic(path.join(dir, "meta.json"), JSON.stringify(meta));
  }
  writeAtomic(file, Buffer.concat(kept.map(encodeChat)));
  return chatBytes(messages) - chatBytes(kept);
}

function encodeEntry({ seq, data }) {
  const header = Buffer.alloc(12);
  header.writeBigUInt64BE(BigInt(seq));
  header.writeUInt32BE(data.length, 8);
  return Buffer.concat([header, data]);
}

/** The storage of one project, loaded into memory. */
class Project {
  constructor(storage, id, dir, meta) {
    this.storage = storage;
    this.id = id;
    this.dir = dir;
    this.meta = meta;
    this.log = readLog(path.join(dir, "log.bin"));
    this.snapshot = null;
    try {
      const buf = fs.readFileSync(path.join(dir, "snapshot.bin"));
      this.snapshot = {
        upTo: Number(buf.readBigUInt64BE(0)),
        data: buf.subarray(8),
      };
    } catch {}
    const lastLogged = this.log.at(-1)?.seq ?? 0;
    this.head = Math.max(lastLogged, this.snapshot?.upTo ?? 0);
    this.bytes = storage.bytesOnDisk(dir);
    this.chat = readChat(path.join(dir, "chat.bin"));
    this.chatHead = Math.max(meta.chatHead ?? 0, this.chat.at(-1)?.seq ?? 0);
  }

  checkAccess(token) {
    if (typeof token !== "string") return false;
    const given = Buffer.from(hashToken(token));
    const stored = Buffer.from(this.meta.accessHash);
    return given.length === stored.length && timingSafeEqual(given, stored);
  }

  touch() {
    const now = this.storage.now();
    // Written at most hourly; it only needs to be right to within days.
    if (now - this.meta.lastAccess > 60 * 60 * 1000) {
      this.meta.lastAccess = now;
      writeAtomic(path.join(this.dir, "meta.json"), JSON.stringify(this.meta));
    }
  }

  /** Stores an update. Returns its seq, or null if over the project's limit. */
  append(data) {
    const { limits } = this.storage;
    const growth = data.length + 12;
    // Text keeps working past the limit for a while, so a big figure never
    // stops people writing; blobs are refused at the limit itself.
    if (
      this.bytes + growth > limits.maxProjectBytes * 1.1 ||
      this.storage.totalBytes + growth > limits.maxTotalBytes * 1.05
    ) {
      return null;
    }
    const entry = { seq: this.head + 1, data };
    fs.appendFileSync(path.join(this.dir, "log.bin"), encodeEntry(entry));
    this.log.push(entry);
    this.head = entry.seq;
    this.grow(growth);
    return entry.seq;
  }

  /** What a client that has seen up to `after` is missing. */
  since(after) {
    const snapshot =
      this.snapshot && after < this.snapshot.upTo ? this.snapshot : null;
    const from = Math.max(after, snapshot?.upTo ?? 0);
    return { snapshot, entries: this.log.filter((e) => e.seq > from) };
  }

  /**
   * Replaces everything up to `upTo` with one snapshot. Returns false if it
   * doesn't move things forward or would take the project over its limit.
   */
  compact(upTo, data) {
    if (upTo > this.head || upTo <= (this.snapshot?.upTo ?? 0)) return false;
    const kept = this.log.filter((e) => e.seq > upTo);
    const logBytes = kept.reduce((sum, e) => sum + e.data.length + 12, 0);
    const before =
      sizeOf(path.join(this.dir, "log.bin")) +
      sizeOf(path.join(this.dir, "snapshot.bin"));
    const after = logBytes + data.length + 8;
    if (
      this.bytes - before + after >
      this.storage.limits.maxProjectBytes * 1.1
    ) {
      return false;
    }
    const header = Buffer.alloc(8);
    header.writeBigUInt64BE(BigInt(upTo));
    writeAtomic(
      path.join(this.dir, "snapshot.bin"),
      Buffer.concat([header, data]),
    );
    writeAtomic(
      path.join(this.dir, "log.bin"),
      Buffer.concat(kept.map(encodeEntry)),
    );
    this.snapshot = { upTo, data };
    this.log = kept;
    this.grow(after - before);
    return true;
  }

  /** Chat messages after `after`, once expired ones are gone. */
  chatSince(after) {
    this.expireChat();
    return this.chat.filter((m) => m.seq > after);
  }

  /**
   * Stores a chat message. Returns its seq and time, or null if it can't be
   * kept. The oldest messages make way past the project's chat allowance.
   */
  appendChat(data) {
    const { limits } = this.storage;
    const growth = data.length + 20;
    if (
      growth > limits.maxChatBytes ||
      this.storage.totalBytes + growth > limits.maxTotalBytes * 1.05
    ) {
      return null;
    }
    this.expireChat();
    let dropped = 0;
    while (chatBytes(this.chat) + growth > limits.maxChatBytes) {
      this.chat.shift();
      dropped++;
    }
    const message = { seq: this.chatHead + 1, at: this.storage.now(), data };
    const file = path.join(this.dir, "chat.bin");
    if (dropped > 0) {
      const before = sizeOf(file);
      writeAtomic(file, Buffer.concat(this.chat.map(encodeChat)));
      this.grow(sizeOf(file) - before);
    }
    fs.appendFileSync(file, encodeChat(message));
    this.chat.push(message);
    this.chatHead = message.seq;
    this.grow(growth);
    return { seq: message.seq, at: message.at };
  }

  expireChat() {
    const cutoff = this.storage.now() - this.storage.limits.chatDays * DAY;
    if (!this.chat.length || this.chat[0].at >= cutoff) return;
    this.meta.chatHead = this.chatHead;
    writeAtomic(path.join(this.dir, "meta.json"), JSON.stringify(this.meta));
    const before = chatBytes(this.chat);
    this.chat = this.chat.filter((m) => m.at >= cutoff);
    writeAtomic(
      path.join(this.dir, "chat.bin"),
      Buffer.concat(this.chat.map(encodeChat)),
    );
    this.grow(chatBytes(this.chat) - before);
  }

  blobPath(blobId) {
    return path.join(this.dir, "blobs", blobId);
  }

  hasBlob(blobId) {
    return fs.existsSync(this.blobPath(blobId));
  }

  /** Whether `size` more bytes of blobs fit. */
  blobFits(size) {
    const { limits } = this.storage;
    return (
      size <= limits.maxFileBytes &&
      this.bytes + size <= limits.maxProjectBytes &&
      this.storage.totalBytes + size <= limits.maxTotalBytes
    );
  }

  saveBlob(blobId, data) {
    if (this.hasBlob(blobId)) return;
    fs.mkdirSync(path.join(this.dir, "blobs"), { recursive: true });
    writeAtomic(this.blobPath(blobId), data);
    this.grow(data.length);
  }

  /**
   * Deletes blobs nothing refers to any more. Only ones older than a day go,
   * because a blob is uploaded just before the update that refers to it.
   */
  collectBlobs(liveBlobs) {
    const live = new Set(liveBlobs);
    const cutoff = this.storage.now() - 24 * 60 * 60 * 1000;
    const dir = path.join(this.dir, "blobs");
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (live.has(name) || !BLOB_ID.test(name)) continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.mtimeMs > cutoff) continue;
      fs.rmSync(file);
      this.grow(-stat.size);
    }
  }

  grow(bytes) {
    this.bytes += bytes;
    this.storage.totalBytes += bytes;
  }
}

export class Storage {
  constructor({ dir, limits, now = Date.now }) {
    this.dir = dir;
    this.limits = limits;
    this.now = now;
    this.loaded = new Map();
    fs.mkdirSync(dir, { recursive: true });
    this.totalBytes = 0;
    for (const id of this.projectIds()) {
      this.totalBytes += this.bytesOnDisk(path.join(dir, id));
    }
  }

  projectIds() {
    return fs.readdirSync(this.dir).filter((name) => PROJECT_ID.test(name));
  }

  bytesOnDisk(dir) {
    let total = sizeOf(path.join(dir, "log.bin"));
    total += sizeOf(path.join(dir, "snapshot.bin"));
    total += sizeOf(path.join(dir, "chat.bin"));
    try {
      for (const name of fs.readdirSync(path.join(dir, "blobs"))) {
        total += sizeOf(path.join(dir, "blobs", name));
      }
    } catch {}
    return total;
  }

  /** "created", "exists" or "full". */
  create(id, accessHash) {
    const dir = path.join(this.dir, id);
    if (fs.existsSync(dir)) return "exists";
    // The last tenth is kept for projects that already exist to grow into.
    if (this.totalBytes >= this.limits.maxTotalBytes * 0.9) return "full";
    fs.mkdirSync(dir);
    const now = this.now();
    writeAtomic(
      path.join(dir, "meta.json"),
      JSON.stringify({ accessHash, created: now, lastAccess: now }),
    );
    return "created";
  }

  /** The project, if it exists. */
  open(id) {
    if (!PROJECT_ID.test(id)) return null;
    const loaded = this.loaded.get(id);
    if (loaded) return loaded;
    const dir = path.join(this.dir, id);
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
    } catch {
      return null;
    }
    const project = new Project(this, id, dir, meta);
    this.loaded.set(id, project);
    return project;
  }

  /** Frees the memory of a project nobody has open. */
  release(id) {
    this.loaded.delete(id);
  }

  /**
   * Deletes projects nobody has opened for `inactiveDays`, and chat messages
   * past `chatDays` in the rest.
   */
  sweep(isInUse) {
    const cutoff = this.now() - this.limits.inactiveDays * DAY;
    const chatCutoff = this.now() - this.limits.chatDays * DAY;
    let removed = 0;
    for (const id of this.projectIds()) {
      if (isInUse(id)) continue;
      const dir = path.join(this.dir, id);
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
      } catch {}
      const lastAccess = meta.lastAccess ?? 0;
      if (lastAccess > cutoff) {
        this.totalBytes -= expireChatFile(dir, meta, chatCutoff);
        continue;
      }
      this.totalBytes -= this.bytesOnDisk(dir);
      this.loaded.delete(id);
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    }
    return removed;
  }
}
