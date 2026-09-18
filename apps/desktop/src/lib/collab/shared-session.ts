import { fromBase64 } from "lib0/buffer";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { LOADED, REMOTE, liveBlobs } from "./project-doc";

/** Events from the sync client (collab.rs `SyncEvent`). */
export type SyncEvent =
  | { type: "status"; state: "connecting" | "online" | "offline" }
  | {
      type: "caughtUp";
      seq: number;
      logEntries: number;
      logBytes: number;
      pending: number;
    }
  | { type: "update"; seq: number; data: string }
  | { type: "snapshot"; upTo: number; data: string }
  | { type: "awareness"; data: string }
  | { type: "ack"; seq: number; pending: number }
  | { type: "snapshotAck"; upTo: number; ok: boolean }
  | { type: "error"; code: string };

/** How a session reaches the sync client and the disk. */
export interface SessionTransport {
  publish(update: Uint8Array): void;
  awareness(data: Uint8Array): void;
  compact(upTo: number, snapshot: Uint8Array, liveBlobs: string[]): void;
  save(seq: number, local: string, state: Uint8Array): Promise<void>;
}

/**
 * - `syncing`: catching up; editing waits, so nobody works on stale text.
 * - `synced`: up to date and connected.
 * - `offline`: the relay can't be reached; editing is allowed and changes go
 *   out when it's back.
 * - `gone`: the project no longer exists on the relay.
 */
export type SessionStatus = "syncing" | "synced" | "offline" | "gone";

/** Past this, the relay's log is folded into one snapshot. */
const COMPACT_AFTER_BYTES = 512 * 1024;
const COMPACT_AFTER_ENTRIES = 1000;
const SAVE_DELAY_MS = 1000;
/** A connection attempt that hasn't failed nor succeeded by now counts as offline. */
export const OFFLINE_AFTER_MS = 5000;

interface Hooks {
  /** This device's local state, saved with the document. */
  local: () => unknown;
  onStatus?: (status: SessionStatus) => void;
  /** Caught up with the relay; `changed` if others' changes came in. */
  onCaughtUp?: (changed: boolean) => void;
  onError?: (code: string) => void;
  /**
   * Caught up after changes were made both here and elsewhere without the
   * other knowing: the document as of the last time they agreed, plus each
   * side's changes since. Called after they've been merged into `doc`.
   */
  onConcurrentEdits?: (base: Y.Doc, mine: Y.Doc, theirs: Y.Doc) => void;
}

/** Keeping track while this device can't see others' changes. */
interface Apart {
  /** The document as of the last time this device was up to date. */
  base: Uint8Array;
  editedHere: boolean;
  /** This device's document, just before others' changes came in. */
  mine: Uint8Array | null;
  /** `base` plus others' changes. */
  theirs: Y.Doc | null;
}

/**
 * One open shared project: its document, the people on it, and where it has
 * got to with the relay.
 */
export class SharedSession {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  status: SessionStatus = "syncing";
  /** The last relay seq the document includes. */
  seq = 0;
  private changedSinceCaughtUp = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private apart: Apart | null = null;

  constructor(
    private readonly transport: SessionTransport,
    private readonly hooks: Hooks,
  ) {
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  /** Reads back the saved document, before connecting. */
  load(seq: number, state: Uint8Array) {
    if (state.length > 0) Y.applyUpdate(this.doc, state, LOADED);
    this.seq = seq;
    this.startApart();
  }

  /** Call once the connection has been asked for. */
  connecting() {
    this.setStatus("syncing");
    this.offlineTimer = setTimeout(() => {
      if (this.status === "syncing") this.setStatus("offline");
    }, OFFLINE_AFTER_MS);
  }

  handle(event: SyncEvent) {
    if (this.destroyed) return;
    switch (event.type) {
      case "update":
        this.receive(fromBase64(event.data));
        this.advance(event.seq);
        break;
      case "snapshot":
        this.receive(fromBase64(event.data));
        this.advance(event.upTo);
        break;
      case "ack":
        this.advance(event.seq);
        break;
      case "caughtUp": {
        this.advance(event.seq);
        this.setStatus("synced");
        this.endApart();
        const changed = this.changedSinceCaughtUp;
        this.changedSinceCaughtUp = false;
        this.hooks.onCaughtUp?.(changed);
        // Others only resend their presence every 15 s; announce ours now.
        if (this.awareness.getLocalState()) {
          this.transport.awareness(
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
              this.doc.clientID,
            ]),
          );
        }
        const longLog =
          event.logBytes > COMPACT_AFTER_BYTES ||
          event.logEntries > COMPACT_AFTER_ENTRIES;
        if (longLog && event.pending === 0) {
          this.transport.compact(
            this.seq,
            Y.encodeStateAsUpdate(this.doc),
            liveBlobs(this.doc),
          );
        }
        break;
      }
      case "status":
        if (event.state === "offline" && this.status !== "gone") {
          this.setStatus("offline");
        }
        break;
      case "awareness":
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          fromBase64(event.data),
          REMOTE,
        );
        break;
      case "error":
        if (event.code === "gone") this.setStatus("gone");
        this.hooks.onError?.(event.code);
        break;
    }
  }

  /** Writes the document now instead of waiting. */
  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.transport.save(
      this.seq,
      JSON.stringify(this.hooks.local()),
      Y.encodeStateAsUpdate(this.doc),
    );
  }

  scheduleSave() {
    if (this.destroyed || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush().catch((err) =>
        console.warn("[collab] Couldn't save the shared document:", err),
      );
    }, SAVE_DELAY_MS);
  }

  /** Saves, says goodbye to the others, and stops. */
  async destroy() {
    if (this.destroyed) return;
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      "destroy",
    );
    this.destroyed = true;
    if (this.offlineTimer) clearTimeout(this.offlineTimer);
    try {
      await this.flush();
    } finally {
      this.doc.off("update", this.handleDocUpdate);
      this.awareness.off("update", this.handleAwarenessUpdate);
      this.awareness.destroy();
      this.doc.destroy();
    }
  }

  private receive(update: Uint8Array) {
    const apart = this.apart;
    if (apart?.editedHere) {
      if (!apart.mine) {
        apart.mine = Y.encodeStateAsUpdate(this.doc);
        apart.theirs = docFrom(apart.base);
      }
      Y.applyUpdate(apart.theirs!, update, REMOTE);
    }
    Y.applyUpdate(this.doc, update, REMOTE);
    this.changedSinceCaughtUp = true;
  }

  private startApart() {
    if (this.apart) return;
    this.apart = {
      base: Y.encodeStateAsUpdate(this.doc),
      editedHere: false,
      mine: null,
      theirs: null,
    };
  }

  private endApart() {
    const apart = this.apart;
    this.apart = null;
    if (!apart?.mine || !apart.theirs) return;
    const base = docFrom(apart.base);
    const mine = docFrom(apart.mine);
    try {
      this.hooks.onConcurrentEdits?.(base, mine, apart.theirs);
    } finally {
      base.destroy();
      mine.destroy();
      apart.theirs.destroy();
    }
  }

  private advance(seq: number) {
    if (seq > this.seq) this.seq = seq;
    this.scheduleSave();
  }

  private setStatus(status: SessionStatus) {
    if (this.status === status) return;
    this.status = status;
    if (status === "offline") this.startApart();
    if (status !== "syncing" && this.offlineTimer) {
      clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
    }
    this.hooks.onStatus?.(status);
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || origin === LOADED) return;
    if (this.apart) this.apart.editedHere = true;
    this.transport.publish(update);
    this.scheduleSave();
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE) return;
    const mine = [...changes.added, ...changes.updated, ...changes.removed];
    if (!mine.includes(this.doc.clientID)) return;
    this.transport.awareness(
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID,
      ]),
    );
  };
}

function docFrom(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}
