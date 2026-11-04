import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultNote } from "./vault-index";

const files = vi.hoisted(() => new Map<string, string>());
const zoteroItems = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@/lib/zotero-api", () => ({
  zoteroFetch: vi.fn(async (_k: string, path: string) => ({
    json: async () => (path.includes("/items?") ? zoteroItems.value : []),
  })),
}));
vi.mock("@/lib/zotero-library", () => ({
  useZoteroLibrary: {
    getState: () => ({
      mirror: {
        items: { PAPER001: { title: "A paper", year: "2020" } },
        attachments: { PDF00001: { parent: "PAPER001" } },
      },
    }),
  },
}));
vi.mock("@/stores/zotero-store", () => ({
  useZoteroStore: { getState: () => ({ apiKey: "k", userID: "1" }) },
}));
vi.mock("./kind-folders", () => ({
  kindFolder: (kind: string) =>
    kind === "topic" ? "Topics" : kind === "idea" ? "Ideas" : null,
}));
vi.mock("./note-changes", () => ({ chooseNoteKind: vi.fn(async () => null) }));

const vault = vi.hoisted(() => ({
  paperTag: "vault",
  index: { list: [] as VaultNote[] },
  noteTypes: {},
  mode: "local",
  vaultPath: "/v",
}));
const source = vi.hoisted(() => ({
  readNote: async (path: string) => ({
    text: files.get(path) ?? "",
    version: "1",
  }),
  writeNote: vi.fn(async (path: string, text: string) => {
    files.set(path, text);
    return "2";
  }),
  createNote: vi.fn(async (path: string, text: string) => {
    files.set(path, text);
  }),
}));
vi.mock("@/stores/vault-store", () => ({
  useVaultStore: {
    getState: () => ({
      ...vault,
      ensureVault: async () => {},
      noteWritten: vi.fn(),
      source,
    }),
  },
}));

const sync = vi.hoisted(() => vi.fn(async () => ({ written: 1, at: 0 })));
vi.mock("./zotero-sync/run", () => ({ syncVaultWithZotero: sync }));
const settings = vi.hoisted(() => ({ zoteroAutoVault: false }));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: () => settings },
}));

const { previewImport, runImport } = await import("./tag-import");
const { tagTypes } = await import("./zotero-tag-notes");
const topic = tagTypes([]).find((t) => t.kind === "topic") as ReturnType<
  typeof tagTypes
>[number];

const highlight = {
  key: "ANN00001",
  data: {
    itemType: "annotation",
    parentItem: "PDF00001",
    annotationText: "A passage.",
    annotationPageLabel: "3",
  },
};

describe("importing a Zotero tag", () => {
  beforeEach(() => {
    files.clear();
    vault.index = { list: [] };
    zoteroItems.value = [
      { key: "PAPER001", data: { itemType: "journalArticle" } },
      highlight,
    ];
  });

  it("makes a note of the type, in its folder, for the sync to fill", async () => {
    const preview = await previewImport([
      { tag: "Network theory", type: topic, name: "Network theory" },
    ]);
    expect(preview[0].existing).toBeNull();
    expect(preview[0].members.papers).toEqual(["PAPER001"]);
    await runImport(preview);
    const text = files.get("Topics/Network theory.md") as string;
    expect(text).toContain('zotero_tag: "Network theory"');
    expect(text).toContain("%% begin zotero %%\n%% end zotero %%");
    expect(sync).not.toHaveBeenCalled();
  });

  it("fills the notes at once when the sync is on", async () => {
    settings.zoteroAutoVault = true;
    await runImport(
      await previewImport([
        { tag: "Network theory", type: topic, name: "Network theory" },
      ]),
    );
    expect(sync).toHaveBeenCalledOnce();
    settings.zoteroAutoVault = false;
  });

  it("pairs a note of that name instead of making another, keeping its text", async () => {
    files.set(
      "Topics/Network theory.md",
      "---\ntags: [topic]\n---\nMy definition.\n\n## My notes\n",
    );
    vault.index = {
      list: [
        {
          name: "Network theory",
          kind: "topic",
          path: "Topics/Network theory.md",
          frontmatter: {},
          body: "",
        } as unknown as VaultNote,
      ],
    };
    const preview = await previewImport([
      { tag: "Network theory", type: topic, name: "Network theory" },
    ]);
    expect(preview[0].existing?.name).toBe("Network theory");
    await runImport(preview);
    const text = files.get("Topics/Network theory.md") as string;
    expect(text).toContain("My definition.");
    expect(text).toContain('zotero_tag: "Network theory"');
    expect([...files.keys()]).toEqual(["Topics/Network theory.md"]);
  });

  it("pairs a note of another kind where the new one would go", async () => {
    files.set("Topics/Networks.md", "---\ntags: [method]\n---\nMine.\n");
    vault.index = {
      list: [
        {
          name: "Networks",
          kind: "method",
          path: "Topics/Networks.md",
          frontmatter: {},
          body: "",
        } as unknown as VaultNote,
      ],
    };
    await runImport(
      await previewImport([{ tag: "Networks", type: topic, name: "Networks" }]),
    );
    const text = files.get("Topics/Networks.md") as string;
    expect(text).toContain("Mine.");
    expect(text).toContain('zotero_tag: "Networks"');
  });

  it("pairs the rest when one tag fails, and says which", async () => {
    const preview = await previewImport([
      { tag: "One", type: topic, name: "One" },
      { tag: "Two", type: topic, name: "Two" },
      { tag: "Three", type: topic, name: "Three" },
    ]);
    source.createNote.mockImplementationOnce(async () => {
      files.set("Topics/One.md", "x");
    });
    source.createNote.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await expect(runImport(preview)).rejects.toThrow(
      "2 paired; couldn't pair Two: disk full",
    );
    expect(files.has("Topics/Three.md")).toBe(true);
  });
});
