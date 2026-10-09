/**
 * Where Zotero requests go: the Zotero app on this computer when it's open
 * and lets other apps in (its local API, the same requests as zotero.org's),
 * else zotero.org. The app answers offline, without limits, and while
 * zotero.org is down; what's written there shows in Zotero at once.
 *
 * Its version numbers are its own, unrelated to zotero.org's, so anything
 * kept as "up to date with version N" keeps one number per source.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settings-store";

export type ZoteroSource = "local" | "web";

/** The Zotero app: in use, open but not letting other apps in, or not open. */
export type ZoteroAppStatus = "on" | "off" | "closed";

interface LocalResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const CHECK_EVERY_MS = 15_000;
let checked: { status: ZoteroAppStatus; at: number } | null = null;
let serverID: string | null = null;

/** Sends one request to the Zotero app; throws when it isn't there. */
async function local(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
  timeoutSecs?: number,
): Promise<LocalResponse> {
  const response = await invoke<LocalResponse>("zotero_local_request", {
    method,
    path,
    headers: { "Zotero-API-Version": "3", ...headers },
    body: body ?? null,
    timeoutSecs: timeoutSecs ?? null,
  });
  const id = response.headers["zotero-server-id"];
  if (id) serverID = id;
  return response;
}

/** Whether the Zotero app can be used now (checked every 15 s at most). */
export async function zoteroAppStatus(fresh = false): Promise<ZoteroAppStatus> {
  if (!fresh && checked && Date.now() - checked.at < CHECK_EVERY_MS) {
    return checked.status;
  }
  let status: ZoteroAppStatus;
  try {
    const response = await local("GET", "/users/0/collections?limit=1");
    status = response.status === 200 ? "on" : "off";
  } catch {
    status = "closed";
  }
  checked = { status, at: Date.now() };
  return status;
}

/** The source to use now. */
export async function zoteroSource(): Promise<ZoteroSource> {
  if (!useSettingsStore.getState().useZoteroApp) return "web";
  return (await zoteroAppStatus()) === "on" ? "local" : "web";
}

/** After the app stopped answering: check again before using it next. */
export function forgetZoteroApp() {
  checked = null;
}

// ─── Writing through the app ───

const KEY_STORAGE = "latex4all-zotero-app-key";

function savedKey(): { key: string; server: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STORAGE) ?? "null");
    return saved?.key && saved.server === serverID ? saved : null;
  } catch {
    return null;
  }
}

function saveKey(key: string | null) {
  try {
    if (key) {
      localStorage.setItem(
        KEY_STORAGE,
        JSON.stringify({ key, server: serverID }),
      );
    } else {
      localStorage.removeItem(KEY_STORAGE);
    }
  } catch {
    // Asked for again next time.
  }
}

/** Thrown when the Zotero app was asked to let Latex4All write, and didn't. */
export class ZoteroAppDeniedError extends Error {
  constructor() {
    super(
      "Zotero didn't let Latex4All save. Choose Allow when Zotero asks, or turn off “Use the Zotero app” in Settings → Zotero.",
    );
  }
}

/**
 * A key that lets Latex4All write through the app. The first time, Zotero
 * asks you (once, with "Always Allow"); a one-time permission isn't kept.
 */
async function writeKey(): Promise<string> {
  const saved = savedKey();
  if (saved) return saved.key;
  if (!serverID) await zoteroAppStatus(true);
  const response = await local(
    "POST",
    "/local/authorize",
    {
      "Content-Type": "application/json",
      ...(serverID ? { "Zotero-Server-ID": serverID } : {}),
    },
    JSON.stringify({ appName: "Latex4All" }),
    // Waits for you to answer Zotero's question.
    600,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new ZoteroAppDeniedError();
  }
  const { key, remember } = JSON.parse(response.body) as {
    key?: string;
    remember?: boolean;
  };
  if (!key) throw new ZoteroAppDeniedError();
  if (remember) saveKey(key);
  return key;
}

function toResponse(r: LocalResponse): Response {
  const empty = r.status === 204 || r.status === 304 || r.status < 200;
  return new Response(empty ? null : r.body, {
    status: r.status,
    headers: r.headers,
  });
}

/**
 * One request to the Zotero app, as a fetch() Response. Writes carry the
 * app's own key (asked for the first time) instead of the zotero.org one.
 * Throws when the app isn't there.
 */
export async function localZoteroRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  if (method === "GET") return toResponse(await local(method, path, headers));
  for (let attempt = 0; ; attempt++) {
    const key = await writeKey();
    const response = await local(
      method,
      path,
      {
        ...headers,
        "Zotero-API-Key": key,
        ...(serverID ? { "Zotero-Server-ID": serverID } : {}),
      },
      body,
    );
    // A key Zotero no longer knows (its write permissions were cleared).
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      saveKey(null);
      continue;
    }
    return toResponse(response);
  }
}

/**
 * Whether an attachment's PDF can be opened: one stored in Zotero always,
 * a linked file only through the app or Zotero's database, which know where
 * it is.
 */
export async function canOpenPdf(attachment: {
  downloadable: boolean;
}): Promise<boolean> {
  return (
    attachment.downloadable ||
    useSettingsStore.getState().zoteroDatabaseFallback ||
    (await zoteroSource()) === "local"
  );
}
