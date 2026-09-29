import { invoke } from "@tauri-apps/api/core";

export interface WebdavStatus {
  url: string;
  username: string;
}

export interface WebdavEntry {
  /** Path inside the vault, without leading or trailing slash. */
  path: string;
  isFolder: boolean;
  etag: string | null;
}

interface RawResponse {
  status: number;
  etag: string | null;
  body: string;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>`;

export const webdavStatus = () =>
  invoke<WebdavStatus | null>("vault_webdav_status");

export const webdavConnect = (
  url: string,
  username: string,
  password: string,
) => invoke<WebdavStatus>("vault_webdav_connect", { url, username, password });

export const webdavDisconnect = () => invoke<void>("vault_webdav_disconnect");

function request(
  method: "PROPFIND" | "GET" | "PUT" | "MKCOL",
  path: string,
  options: { depth?: string; body?: string; ifMatch?: string | null } = {},
) {
  return invoke<RawResponse>("vault_webdav_request", {
    method,
    path,
    depth: options.depth ?? null,
    body: options.body ?? null,
    ifMatch: options.ifMatch ?? null,
  });
}

function decodeBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const decodeText = (base64: string) =>
  new TextDecoder().decode(decodeBytes(base64));

/**
 * The entries of a PROPFIND multistatus answer, as paths inside the vault.
 * `basePath` is the URL path of the vault root (e.g. `/seafdav/Commonplace`).
 */
export function parseMultistatus(xml: string, basePath: string): WebdavEntry[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = decodeURIComponent(basePath).replace(/\/+$/, "");
  const entries: WebdavEntry[] = [];
  for (const response of Array.from(
    doc.getElementsByTagNameNS("DAV:", "response"),
  )) {
    const href = response.getElementsByTagNameNS("DAV:", "href")[0]
      ?.textContent;
    if (!href) continue;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(href, "http://x").pathname);
    } catch {
      continue;
    }
    if (!pathname.startsWith(root)) continue;
    const path = pathname.slice(root.length).replace(/^\/+|\/+$/g, "");
    const etag =
      response
        .getElementsByTagNameNS("DAV:", "getetag")[0]
        ?.textContent?.trim() || null;
    entries.push({
      path,
      isFolder:
        response.getElementsByTagNameNS("DAV:", "collection").length > 0,
      etag,
    });
  }
  return entries;
}

export class WebdavConflictError extends Error {
  constructor() {
    super("This note was changed elsewhere since you opened it.");
  }
}

/** Reads and writes files of a vault kept on a WebDAV server. */
export class WebdavVault {
  private basePath: string;

  constructor(readonly status: WebdavStatus) {
    this.basePath = new URL(status.url).pathname;
  }

  /** The folder's direct children (not the folder itself). */
  async list(folder: string): Promise<WebdavEntry[]> {
    const res = await request("PROPFIND", folder ? `${folder}/` : "", {
      depth: "1",
      body: PROPFIND_BODY,
    });
    if (res.status !== 207) {
      throw new Error(
        `The server answered ${res.status} listing "${folder || "/"}"`,
      );
    }
    return parseMultistatus(decodeText(res.body), this.basePath).filter(
      (e) => e.path !== folder,
    );
  }

  async readText(path: string): Promise<{ text: string; etag: string | null }> {
    const res = await request("GET", path);
    if (res.status !== 200)
      throw new Error(`Couldn't read ${path} (${res.status})`);
    return { text: decodeText(res.body), etag: res.etag };
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const res = await request("GET", path);
    if (res.status !== 200)
      throw new Error(`Couldn't read ${path} (${res.status})`);
    return decodeBytes(res.body);
  }

  /**
   * Saves a note. With `etag`, refuses to overwrite a newer version saved
   * elsewhere since that version was read.
   */
  async writeText(
    path: string,
    text: string,
    etag?: string | null,
  ): Promise<string | null> {
    const res = await request("PUT", path, { body: text, ifMatch: etag });
    if (res.status === 412) throw new WebdavConflictError();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Couldn't save ${path} (${res.status})`);
    }
    return res.etag;
  }

  async makeFolder(path: string): Promise<void> {
    const res = await request("MKCOL", path);
    // 405: already there.
    if (res.status !== 201 && res.status !== 405) {
      throw new Error(`Couldn't create folder ${path} (${res.status})`);
    }
  }
}
