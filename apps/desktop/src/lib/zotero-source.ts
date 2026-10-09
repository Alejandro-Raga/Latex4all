/**
 * Where Zotero requests go. zotero.org, or the Zotero app on this computer
 * (its local API answers the same requests) — always when it's open, or only
 * when zotero.org fails, as Settings → Zotero says. Past both, if allowed,
 * Zotero's own database (zotero-db.ts). What answered last is kept in
 * useZoteroConnection, for the toolbar's Zotero button, and a notice says
 * when a fallback takes over and when zotero.org is back.
 *
 * The app's version numbers are its own, unrelated to zotero.org's, so
 * anything kept as "up to date with version N" keeps one number per source.
 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import { useSettingsStore } from "@/stores/settings-store";

export type ZoteroSource = "local" | "web";

/** When the Zotero app is used: never, when zotero.org fails, or always. */
export type ZoteroAppMode = "off" | "fallback" | "always";

/** The Zotero app: in use, open but not letting other apps in, or not open. */
export type ZoteroAppStatus = "on" | "off" | "closed";

/** What answered: zotero.org, the Zotero app, or Zotero's database. */
export type ZoteroServedBy = "web" | "local" | "database";

interface LocalResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// ─── What's answering ───

interface ZoteroConnection {
  /** What answered the last request; null before any. */
  servedBy: ZoteroServedBy | null;
  /** Nothing could answer the last request. */
  failed: boolean;
  /** When zotero.org last failed, while it hasn't answered since. */
  webDownSince: number | null;
  /** The Zotero app, as last checked. */
  app: ZoteroAppStatus | null;
}

export const useZoteroConnection = create<ZoteroConnection>(() => ({
  servedBy: null,
  failed: false,
  webDownSince: null,
  app: null,
}));

/** Whether what answered is a fallback (zotero.org isn't the choice made). */
export function isFallback(by: ZoteroServedBy | null): boolean {
  if (by === "database") return true;
  return (
    by === "local" && useSettingsStore.getState().zoteroAppMode !== "always"
  );
}

const FALLBACK_LABEL: Record<ZoteroServedBy, string> = {
  web: "zotero.org",
  local: "the Zotero app",
  database: "Zotero's database on this computer",
};

/** Notes what answered, saying so when a fallback takes over or ends. */
export function noteServed(by: ZoteroServedBy) {
  const before = useZoteroConnection.getState();
  useZoteroConnection.setState({
    servedBy: by,
    failed: false,
    ...(by === "web" ? { webDownSince: null } : {}),
  });
  const was = isFallback(before.servedBy) || before.failed;
  if (
    isFallback(by) &&
    (!isFallback(before.servedBy) || before.servedBy !== by)
  ) {
    toast.warning("zotero.org can't be reached", {
      id: "zotero-source",
      description:
        by === "database"
          ? "Using Zotero's database on this computer. You can read, but saving to Zotero is paused."
          : `Using ${FALLBACK_LABEL[by]} instead.`,
    });
  } else if (by === "web" && was) {
    toast.success("zotero.org is back", { id: "zotero-source" });
  }
}

/** Notes that zotero.org didn't answer. */
export function noteWebDown() {
  const { webDownSince } = useZoteroConnection.getState();
  if (!webDownSince) useZoteroConnection.setState({ webDownSince: Date.now() });
}

/** Notes that nothing could answer. */
export function noteFailed() {
  useZoteroConnection.setState({ failed: true });
}

// ─── The Zotero app ───

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
  useZoteroConnection.setState({ app: status });
  return status;
}

/** How long a failure of zotero.org sends work to the app, as a fallback. */
const WEB_DOWN_MS = 60_000;

/** The source to use now. */
export async function zoteroSource(): Promise<ZoteroSource> {
  const mode = useSettingsStore.getState().zoteroAppMode;
  if (mode === "off") return "web";
  if (mode === "fallback") {
    const { webDownSince } = useZoteroConnection.getState();
    if (!webDownSince || Date.now() - webDownSince > WEB_DOWN_MS) return "web";
  }
  return (await zoteroAppStatus()) === "on" ? "local" : "web";
}

/** After the app stopped answering, or a setting changed: check again. */
export function forgetZoteroApp() {
  checked = null;
}

/**
 * Runs work that must use one source throughout (it keeps that source's
 * version numbers); if it fails and the source to use has changed since —
 * zotero.org just went down, say — it runs once more with the new one.
 */
export async function withZoteroSource<T>(
  work: (source: ZoteroSource) => Promise<T>,
): Promise<T> {
  const source = await zoteroSource();
  try {
    return await work(source);
  } catch (err) {
    const now = await zoteroSource();
    if (now === source) throw err;
    return work(now);
  }
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
      "Zotero didn't let Latex4All save. Choose Allow when Zotero asks, or set “Zotero on this computer” to Off (Zotero button in the toolbar).",
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
  const settings = useSettingsStore.getState();
  return (
    attachment.downloadable ||
    settings.zoteroDatabaseFallback ||
    settings.zoteroAppMode !== "off"
  );
}
