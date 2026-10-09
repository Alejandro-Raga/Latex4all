import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("./zotero-library", () => ({
  useZoteroLibrary: {
    getState: () => ({
      mirror: { items: { PAPER1: { bibtex: "@article{smith2020, }" } } },
    }),
  },
}));

const library = {
  version: 9521,
  collections: [{ key: "COLL0001", name: "Reading", parent: null, items: 1 }],
  items: [
    {
      key: "PAPER1",
      version: 10,
      data: {
        itemType: "journalArticle",
        title: "Like stars",
        date: "2024",
        creators: [{ lastName: "Baruffaldi", firstName: "Stefano" }],
        collections: ["COLL0001"],
      },
    },
    {
      key: "PAPER2",
      version: 11,
      data: { itemType: "book", title: "Trashed", deleted: 1 },
    },
    {
      key: "PDF00001",
      version: 12,
      data: {
        itemType: "attachment",
        parentItem: "PAPER1",
        contentType: "application/pdf",
        linkMode: "imported_file",
      },
    },
    {
      key: "ANNO0001",
      version: 13,
      data: {
        itemType: "annotation",
        parentItem: "PDF00001",
        annotationType: "highlight",
      },
    },
  ],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(library)),
}));

const { databaseResponse } = await import("./zotero-db");

async function get(path: string) {
  const response = await databaseResponse(`/users/14356450${path}`);
  return {
    status: response.status,
    total: response.headers.get("Total-Results"),
    version: response.headers.get("Last-Modified-Version"),
    body: response.status === 200 ? await response.json() : null,
  };
}

describe("databaseResponse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists top-level items without the trash, with the library version", async () => {
    const r = await get("/items/top?format=json&limit=100");
    expect(r.body.map((i: { key: string }) => i.key)).toEqual(["PAPER1"]);
    expect(r.total).toBe("1");
    expect(r.version).toBe("9521");
  });

  it("includes the trash when asked, and leaves out annotations", async () => {
    const r = await get("/items?includeTrashed=1&itemType=-annotation");
    expect(r.body.map((i: { key: string }) => i.key)).toEqual([
      "PAPER1",
      "PAPER2",
      "PDF00001",
    ]);
  });

  it("gives an item's children, and an attachment's annotations", async () => {
    const pdfs = await get("/items/PAPER1/children?format=json");
    expect(pdfs.body[0].data.linkMode).toBe("imported_file");
    const notes = await get("/items/PDF00001/children?limit=100");
    expect(notes.body[0].data.annotationType).toBe("highlight");
  });

  it("serves BibTeX from the library copy", async () => {
    const one = await get("/items/PAPER1?format=json&include=bibtex");
    expect(one.body.bibtex).toBe("@article{smith2020, }");
    const page = await get("/collections/COLL0001/items/top?include=bibtex");
    expect(page.body[0].bibtex).toBe("@article{smith2020, }");
    expect(page.body[0].data).toBeUndefined();
  });

  it("searches title, creators and year", async () => {
    const hit = await get(
      "/items/top?q=baruffaldi%202024&qmode=titleCreatorYear",
    );
    expect(hit.body).toHaveLength(1);
    const miss = await get("/items/top?q=nelson&qmode=titleCreatorYear");
    expect(miss.body).toHaveLength(0);
  });

  it("pages like the API", async () => {
    const r = await get("/items?includeTrashed=1&limit=2&start=2");
    expect(r.body.map((i: { key: string }) => i.key)).toEqual([
      "PDF00001",
      "ANNO0001",
    ]);
    expect(r.total).toBe("4");
  });

  it("lists collections", async () => {
    const r = await get("/collections?format=json&limit=100");
    expect(r.body[0]).toMatchObject({
      key: "COLL0001",
      data: { name: "Reading", parentCollection: false },
      meta: { numItems: 1 },
    });
  });

  it("answers 404 for what it doesn't hold", async () => {
    expect((await get("/items/NOPE0000")).status).toBe(404);
    expect((await get("/deleted?since=5")).status).toBe(404);
  });
});
