import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { fromBase64, toBase64 } from "lib0/buffer";
import type { SyncEvent } from "@/lib/collab/shared-session";

/** The commands in src-tauri/src/collab.rs. */

export interface LinkInfo {
  link: string;
  projectId: string;
}

/** Creates a shared project on the relay; returns its link. */
export function createSharedProject() {
  return invoke<string>("collab_create", { relayUrl: null });
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
export function connect(
  link: string,
  after: number,
  projectRoot: string | null,
) {
  return invoke<void>("collab_connect", { link, after, projectRoot });
}

export function disconnect() {
  return invoke<void>("collab_disconnect");
}

export function publish(update: Uint8Array) {
  return invoke<void>("collab_publish", { data: toBase64(update) });
}

export function sendAwareness(data: Uint8Array) {
  return invoke<void>("collab_awareness", { data: toBase64(data) });
}

export function compact(
  upTo: number,
  snapshot: Uint8Array,
  liveBlobs: string[],
) {
  return invoke<void>("collab_compact", {
    upTo,
    data: toBase64(snapshot),
    liveBlobs,
  });
}

export function uploadBlob(
  link: string,
  projectRoot: string,
  relativePath: string,
) {
  return invoke<{ blobId: string; size: number }>("collab_upload_blob", {
    link,
    projectRoot,
    relativePath,
  });
}

export function downloadBlob(
  link: string,
  projectRoot: string,
  relativePath: string,
  blobId: string,
) {
  return invoke<void>("collab_download_blob", {
    link,
    projectRoot,
    relativePath,
    blobId,
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
export function listenForSyncEvents(handler: (event: SyncEvent) => void) {
  return getCurrentWebviewWindow().listen<SyncEvent>("collab://event", (e) =>
    handler(e.payload),
  );
}
