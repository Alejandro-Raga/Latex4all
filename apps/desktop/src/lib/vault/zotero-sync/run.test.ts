import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, string>());
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => false,
  mkdir: async () => {},
  readTextFile: async () => "",
  writeTextFile: async () => {},
}));
vi.mock("@/lib/zotero-api", () => ({
  zoteroFetch: vi.fn(async (_k: string, path: string) => ({
    headers: new Headers({ "Last-Modified-Version": "7" }),
    json: async () => (path.includes("/deleted") ? { items: [] } : []),
  })),
}));
vi.mock("@/lib/zotero-source", () => ({
  withZoteroSource: (work: (s: string) => unknown) => work("web"),
}));
vi.mock("@/stores/zotero-store", () => ({
  useZoteroStore: { getState: () => ({ apiKey: "k", userID: "1" }) },
}));
vi.mock("../kind-folders", () => ({ kindFolder: () => null }));
vi.mock("@/stores/vault-store", () => ({
  vaultStyle: () => ({ types: [] }),
  useVaultStore: {
    getState: () => ({
      paperTag: "obsidian",
      papersFolder: "",
      index: { list: [] },
      ensureVault: async () => {},
      noteWritten: () => {},
      source: {
        readNote: async (path: string) => {
          if (!files.has(path)) throw new Error("missing");
          return { text: files.get(path), version: "1" };
        },
        writeNote: async (path: string, text: string) => {
          files.set(path, text);
          return "2";
        },
        createNote: async (path: string, text: string) => {
          files.set(path, text);
        },
      },
    }),
  },
}));

const {
  SYNC_STATE_PATH,
  readSyncStateFile,
  releaseVault,
  syncVaultWithZotero,
} = await import("./run");

/** Another computer: its own id. */
const asComputer = (id: string) =>
  localStorage.setItem("latex4all-computer-id", id);
const holder = () =>
  readSyncStateFile(files.get(SYNC_STATE_PATH) ?? "")?.holder;

describe("one computer syncing the vault at a time", () => {
  beforeEach(() => {
    files.clear();
    vi.useRealTimers();
  });

  it("holds the vault while it syncs, and the other computer leaves it alone", async () => {
    asComputer("A");
    expect((await syncVaultWithZotero()).elsewhere).toBeUndefined();
    expect(holder()?.id).toBe("A");
    asComputer("B");
    const r = await syncVaultWithZotero();
    expect(r.elsewhere).toMatch(/^a /);
    expect(holder()?.id).toBe("A");
  });

  it("is taken over once the hold lapses, or when asked", async () => {
    asComputer("A");
    await syncVaultWithZotero();
    asComputer("B");
    await syncVaultWithZotero({ takeOver: true });
    expect(holder()?.id).toBe("B");
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000, toFake: ["Date"] });
    asComputer("A");
    expect((await syncVaultWithZotero()).elsewhere).toBeUndefined();
    expect(holder()?.id).toBe("A");
  });

  it("lets go when the sync is turned off", async () => {
    asComputer("A");
    await syncVaultWithZotero();
    await releaseVault();
    expect(holder()).toBeUndefined();
    asComputer("B");
    expect((await syncVaultWithZotero()).elsewhere).toBeUndefined();
  });

  it("keeps each computer's library version out of the vault", async () => {
    asComputer("A");
    await syncVaultWithZotero();
    expect(readSyncStateFile(files.get(SYNC_STATE_PATH) ?? "")?.version).toBe(
      0,
    );
  });
});
