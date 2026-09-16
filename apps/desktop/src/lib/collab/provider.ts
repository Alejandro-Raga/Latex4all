import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";

/**
 * How messages reach the other people in a session. The relay behind it
 * delivers each message to everyone else and never echoes it back, so the
 * sync protocol runs as a broadcast: whoever answers a sync request answers
 * all, and applying the same update twice is harmless in Yjs.
 */
export interface CollabTransport {
  send: (message: Uint8Array) => void;
}

// Same numbering as y-websocket.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

export class CollabProvider {
  readonly awareness: awarenessProtocol.Awareness;

  constructor(
    readonly doc: Y.Doc,
    private readonly transport: CollabTransport,
  ) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  /** Announces this participant and asks everyone for what it's missing. */
  connect() {
    this.requestSync();
    const query = encoding.createEncoder();
    encoding.writeVarUint(query, MESSAGE_QUERY_AWARENESS);
    this.transport.send(encoding.toUint8Array(query));
    if (this.awareness.getLocalState() !== null) {
      this.sendAwareness([this.doc.clientID]);
    }
  }

  /** Also used to recover after the relay dropped messages on the way here. */
  requestSync() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.transport.send(encoding.toUint8Array(encoder));
  }

  receive(message: Uint8Array) {
    try {
      const decoder = decoding.createDecoder(message);
      switch (decoding.readVarUint(decoder)) {
        case MESSAGE_SYNC: {
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
          if (encoding.length(reply) > 1) {
            this.transport.send(encoding.toUint8Array(reply));
          }
          break;
        }
        case MESSAGE_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this,
          );
          break;
        case MESSAGE_QUERY_AWARENESS:
          if (this.awareness.getLocalState() !== null) {
            this.sendAwareness([this.doc.clientID]);
          }
          break;
      }
    } catch (err) {
      console.warn("[collab] Ignoring a malformed message:", err);
    }
  }

  /** Tells the others this participant is gone, then stops listening. */
  destroy() {
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      "destroy",
    );
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.destroy();
  }

  private sendAwareness(clients: number[]) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
    );
    this.transport.send(encoding.toUint8Array(encoder));
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.transport.send(encoding.toUint8Array(encoder));
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    // Only pass on what changed here. Everyone already received the others'
    // changes from the relay; re-sending them would multiply the traffic.
    if (origin === this) return;
    this.sendAwareness([
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ]);
  };
}
