import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { fromBase64, toBase64 } from "lib0/buffer";
import type { SyncEvent } from "@/lib/collab/shared-session";

/** The commands in src-tauri/src/collab.rs. */

export interface LinkInfo {
  link: string;
  /** The same link, short (latex4all://join/…), to give out. */
  short: string;
  projectId: string;
}

/** Creates a shared project on the relay; returns its link. */
export function createSharedProject() {
  return invoke<string>("collab_create", { relayUrl: null });
}

/** A code that stands for the link for a day, to type or read out. */
export function inviteCode(link: string) {
  return invoke<string>("collab_invite_code", { link });
}

/** The link an invite code stands for. */
export function resolveCode(code: string) {
  return invoke<string>("collab_resolve_code", { code });
}

/** Validates a pasted link. */
export function parseLink(link: string) {
  return invoke<LinkInfo>("collab_parse_link", { link });
}

export function readLink(projectRoot: string) {
  return invoke<LinkInfo | null>("collab_read_link", { projectRoot });
}

export function writeLink(projectRoot: string, link: string) {
  return invoke<void>("collab_write_link", { projectRoot, link });
}

export function removeLink(projectRoot: string) {
  return invoke<void>("collab_remove_link", { projectRoot });
}

export async function loadDoc(projectRoot: string) {
  const saved = await invoke<{
    seq: number;
    local: string;
    data: string;
  } | null>("collab_load_doc", { projectRoot });
  return saved && { ...saved, data: fromBase64(saved.data) };
}

/** When this computer last saved its synced copy of a project, if ever. */
export async function savedAt(projectRoot: string): Promise<number | null> {
  return invoke<number | null>("collab_saved_at", { projectRoot }).catch(
    () => null,
  );
}

export function saveDoc(
  projectRoot: string,
  seq: number,
  local: string,
  data: Uint8Array,
) {
  return invoke<void>("collab_save_doc", {
    projectRoot,
    seq,
    local,
    data: toBase64(data),
  });
}

/** Connects this window; `projectRoot` is null while joining. */
// `channel`: a connection kept beside the open project's (`library`, what
// linked devices share); none for the open project.
export function connect(
  link: string,
  after: number,
  projectRoot: string | null,
  channel?: string,
) {
  return invoke<void>("collab_connect", {
    link,
    after,
    projectRoot,
    channel: channel ?? null,
  });
}

export function disconnect(channel?: string) {
  return invoke<void>("collab_disconnect", { channel: channel ?? null });
}

export function publish(update: Uint8Array, channel?: string) {
  return invoke<void>("collab_publish", {
    data: toBase64(update),
    channel: channel ?? null,
  });
}

export function p2pPeers(ids: string[], channel?: string) {
  return invoke<void>("collab_p2p_peers", { ids, channel: channel ?? null });
}

export function sendAwareness(data: Uint8Array, channel?: string) {
  return invoke<void>("collab_awareness", {
    data: toBase64(data),
    channel: channel ?? null,
  });
}

export function compact(
  upTo: number,
  snapshot: Uint8Array,
  liveBlobs: string[],
  channel?: string,
) {
  return invoke<void>("collab_compact", {
    upTo,
    data: toBase64(snapshot),
    liveBlobs,
    channel: channel ?? null,
  });
}

export function uploadBlob(
  link: string,
  projectRoot: string,
  relativePath: string,
) {
  return invoke<{ blobId: string; size: number; p2p?: string | null }>(
    "collab_upload_blob",
    {
      link,
      projectRoot,
      relativePath,
    },
  );
}

/** A file from the relay, or peer to peer by `p2p` (its name there) when
 * the relay can't give it; returns its peer-to-peer name, if any. */
export function downloadBlob(
  link: string,
  projectRoot: string,
  relativePath: string,
  blobId: string,
  p2p?: string,
) {
  return invoke<string | null>("collab_download_blob", {
    link,
    projectRoot,
    relativePath,
    blobId,
    p2p: p2p ?? null,
  });
}

/** Makes a folder for a joined project, numbered if the name is taken. */
export function createProjectFolder(destParent: string, name: string) {
  return invoke<string>("collab_create_folder", { destParent, name });
}

export function defaultCollabName() {
  return invoke<string>("collab_default_name");
}

/** Sync events addressed to this window. */
export function listenForSyncEvents(
  handler: (event: SyncEvent) => void,
  channel?: string,
) {
  return getCurrentWebviewWindow().listen<SyncEvent>(
    channel ? `collab://event/${channel}` : "collab://event",
    (e) => handler(e.payload),
  );
}

/** Sends a chat message (the sender's JSON) to everyone on the project. */
export function sendChat(message: Uint8Array) {
  return invoke<void>("collab_send_chat", { data: toBase64(message) });
}

/** The chat this device already has for a project, oldest first. */
export function loadChat(projectRoot: string) {
  return invoke<Array<{ seq: number; at: number; data: string }>>(
    "collab_load_chat",
    { projectRoot },
  );
}
