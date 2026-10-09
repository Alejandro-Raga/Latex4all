import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

/** The Zotero app: "on", "off" (not letting apps in) or "closed". */
let app: "on" | "off" | "closed" = "closed";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./zotero-db", () => ({
  databaseResponse: vi.fn(
    async () => new Response('[{"key":"FROMDB00"}]', { status: 200 }),
  ),
}));

const { zoteroFetch } = await import("./zotero-api");
const { useZoteroConnection, forgetZoteroApp } = await import(
  "./zotero-source"
);
const { useSettingsStore } = await import("@/stores/settings-store");

/** zotero.org answers with this status, or not at all (null). */
function web(status: number | null, body = '[{"key":"FROMWEB0"}]') {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (status === null) throw new TypeError("Load failed");
      return new Response(status === 200 ? body : "down", {
        status,
        headers: status === 503 ? { "Retry-After": "160" } : {},
      });
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetZoteroApp();
  useZoteroConnection.setState({
    servedBy: null,
    failed: false,
    webDownSince: null,
    app: null,
  });
  invoke.mockImplementation(async (command: string) => {
    if (command !== "zotero_local_request") throw new Error(command);
    if (app === "closed") throw new Error("not reachable");
    if (app === "off") return { status: 403, headers: {}, body: "" };
    return { status: 200, headers: {}, body: '[{"key":"FROMAPP0"}]' };
  });
});

function settings(
  zoteroAppMode: "off" | "fallback" | "always",
  zoteroDatabaseFallback: boolean,
) {
  useSettingsStore.setState({ zoteroAppMode, zoteroDatabaseFallback });
}

async function firstKey() {
  const response = await zoteroFetch("key", "/users/1/items?limit=1");
  return ((await response.json()) as { key: string }[])[0].key;
}

describe("where Zotero requests go", () => {
  it("off: zotero.org only, even with the app open and zotero.org down", async () => {
    settings("off", false);
    app = "on";
    web(503);
    await expect(firstKey()).rejects.toThrow(/temporarily unavailable/);
    expect(invoke).not.toHaveBeenCalled();
    expect(useZoteroConnection.getState().failed).toBe(true);
  });

  it("fallback: zotero.org while it answers", async () => {
    settings("fallback", true);
    app = "on";
    web(200);
    expect(await firstKey()).toBe("FROMWEB0");
    expect(useZoteroConnection.getState().servedBy).toBe("web");
  });

  it("fallback: the app when zotero.org is down, with a notice", async () => {
    settings("fallback", false);
    app = "on";
    web(503);
    expect(await firstKey()).toBe("FROMAPP0");
    expect(useZoteroConnection.getState().servedBy).toBe("local");
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("fallback: then the database, when the app is closed", async () => {
    settings("fallback", true);
    app = "closed";
    web(null);
    expect(await firstKey()).toBe("FROMDB00");
    expect(useZoteroConnection.getState().servedBy).toBe("database");
  });

  it("always: the app first, without asking zotero.org", async () => {
    settings("always", false);
    app = "on";
    web(200);
    expect(await firstKey()).toBe("FROMAPP0");
    expect(fetch).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("always: zotero.org when the app doesn't let apps in", async () => {
    settings("always", false);
    app = "off";
    web(200);
    expect(await firstKey()).toBe("FROMWEB0");
  });

  it("says when zotero.org is back after a fallback", async () => {
    settings("fallback", true);
    app = "closed";
    web(null);
    await firstKey();
    web(200);
    await firstKey();
    expect(toast.success).toHaveBeenCalledWith("zotero.org is back", {
      id: "zotero-source",
    });
  });

  it("nothing to fall back on: fails, and says so", async () => {
    settings("fallback", false);
    app = "closed";
    web(null);
    await expect(firstKey()).rejects.toThrow(/Can't reach zotero.org/);
    expect(useZoteroConnection.getState().failed).toBe(true);
  });

  it("follows a setting changed mid-session, without a restart", async () => {
    settings("fallback", false);
    app = "on";
    web(503);
    expect(await firstKey()).toBe("FROMAPP0");
    settings("off", true);
    expect(await firstKey()).toBe("FROMDB00");
  });
});
