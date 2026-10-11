import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultIndex, VaultNote } from "./vault-index";

const api = vi.hoisted(() => ({
  zoteroFetch: vi.fn(),
  createZoteroItems: vi.fn(),
  updateZoteroItem: vi.fn(),
}));
vi.mock("@/lib/zotero-api", () => api);

const { wantedTags, registryNote, syncTagRegistry, REGISTRY_TITLE } =
  await import("./zotero-tag-registry");

const note = (name: string, kind: string) => ({ name, kind }) as VaultNote;
const index = (...notes: VaultNote[]) => ({ list: notes }) as VaultIndex;

const vault = index(
  note("Geography of innovation", "topic"),
  note("Defense data sources", "topic"),
  note("Frontier research is getting costlier", "idea"),
  note("Hartley2020", "paper"),
  note("Inbox", "note"),
);

describe("ideas and topics as Zotero tags", () => {
  it("asks for a tag per idea and topic, and nothing else", () => {
    const w = wantedTags(vault, []);
    expect(w.tags).toEqual([
      "idea: Frontier research is getting costlier",
      "topic: Defense data sources",
      "topic: Geography of innovation",
    ]);
  });

  it("keeps the spelling a tag already has in Zotero", () => {
    const w = wantedTags(vault, ["Topic: Geography of Innovation", "obsidian"]);
    expect(w.tags).toContain("Topic: Geography of Innovation");
    expect(w.tags).not.toContain("topic: Geography of innovation");
  });

  it("lists the names in the note, escaped", () => {
    const html = registryNote(
      wantedTags(index(note("R&D <costs>", "idea")), []),
    );
    expect(html).toContain(`<h1>${REGISTRY_TITLE}</h1>`);
    expect(html).toContain("<li>R&amp;D &lt;costs&gt;</li>");
  });
});

const json = (body: unknown) => ({ json: async () => body });

describe("keeping the note in step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("makes the note the first time", async () => {
    api.zoteroFetch.mockImplementation(async (_k: string, path: string) =>
      json(path.includes("/tags") ? [] : []),
    );
    api.createZoteroItems.mockResolvedValue([{ key: "REGISTRY" }]);
    expect(await syncTagRegistry("k", "1", vault)).toBe(true);
    const [item] = api.createZoteroItems.mock.calls[0][2];
    expect(item.itemType).toBe("note");
    expect(item.tags).toHaveLength(3);
  });

  it("leaves it alone when nothing changed, and updates it when something did", async () => {
    const w = wantedTags(vault, []);
    const current = {
      key: "REGISTRY",
      data: {
        note: registryNote(w),
        tags: w.tags.map((tag) => ({ tag })),
      },
    };
    api.zoteroFetch.mockImplementation(async (_k: string, path: string) =>
      json(path.includes("/tags") ? [] : [current]),
    );
    expect(await syncTagRegistry("k", "1", vault)).toBe(false);
    expect(api.updateZoteroItem).not.toHaveBeenCalled();

    const more = index(
      ...vault.list,
      note("Basic vs applied research", "topic"),
    );
    expect(await syncTagRegistry("k", "1", more)).toBe(true);
    const change = api.updateZoteroItem.mock.calls[0][3];
    expect(change.tags.map((t: { tag: string }) => t.tag)).toContain(
      "topic: Basic vs applied research",
    );
  });
});
