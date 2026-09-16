import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { fromBase64, toBase64 } from "lib0/buffer";

export function hostCollabSession(projectRoot: string) {
  return invoke<{ invite: string }>("collab_host", { projectRoot });
}

/** Downloads the shared project into `destParent` and connects to it. */
export function joinCollabSession(invite: string, destParent: string) {
  return invoke<{ projectPath: string }>("collab_join", {
    invite,
    destParent,
  });
}

export function stopCollabSession() {
  return invoke<void>("collab_stop");
}

export function defaultCollabName() {
  return invoke<string>("collab_default_name");
}

export function sendCollabMessage(message: Uint8Array) {
  invoke("collab_send", { data: toBase64(message) }).catch((err) =>
    console.warn("[collab] Failed to send:", err),
  );
}

export interface CollabChannelHandlers {
  onMessage: (message: Uint8Array) => void;
  /** The relay dropped messages meant for this window. */
  onResync: () => void;
  /** The host ended the session or can no longer be reached. */
  onClosed: () => void;
}

/** Listens for relay traffic addressed to this window. */
export async function openCollabChannel(
  handlers: CollabChannelHandlers,
): Promise<() => void> {
  const window = getCurrentWebviewWindow();
  const unlisteners = await Promise.all([
    window.listen<string>("collab://message", (event) =>
      handlers.onMessage(fromBase64(event.payload)),
    ),
    window.listen("collab://resync", () => handlers.onResync()),
    window.listen("collab://closed", () => handlers.onClosed()),
  ]);
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
