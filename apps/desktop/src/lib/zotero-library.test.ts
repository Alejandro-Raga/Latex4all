import { describe, expect, it, vi } from "vitest";

const zoteroFetch = vi.fn();
vi.mock("./zotero-api", async (orig) => ({
  ...(await orig<typeof import("./zotero-api")>()),
  zoteroFetch: (...args: unknown[]) => zoteroFetch(...args),
  fetchCollections: async () => [
    { key: "COLL0001", name: "Theses", parentKey: false, itemCount: 1 },
  ],
}));

import {
  type ApiItem,
  applyDeleted,
  applyItems,
  emptyMirror,
  itemsIn,
  pdfOf,
  syncMirror,
} from "./zotero-library";

const paper = (key: string, extra: Partial<ApiItem["data"]> = {}): ApiItem => ({
  key,
  data: {
    itemType: "journalArticle",
    title: `Paper ${key}`,
    creators: [{ lastName: "Nelson" }],
    date: "May 1959",
    collections: [],
    ...extra,
  },
});
const pdf = (
  key: string,
  parent: string,
  extra: Partial<ApiItem["data"]> = {},
): ApiItem => ({
  key,
  data: {
    itemType: "attachment",
    parentItem: parent,
    contentType: "application/pdf",
    filename: `${key}.pdf`,
    linkMode: "imported_file",
    md5: `md5-${key}`,
    ...extra,
  },
});

describe("the saved Zotero library", () => {
  it("keeps papers and their PDFs, not notes, annotations or trash", () => {
    const m = emptyMirror("1");
    applyItems(m, [
      paper("AAAA0001", { collections: ["COLL0001"] }),
      paper("AAAA0002", { deleted: 1 }),
      { key: "NOTE0001", data: { itemType: "note", parentItem: "AAAA0001" } },
      pdf("PDF00001", "AAAA0001"),
    ]);
    expect(Object.keys(m.items)).toEqual(["AAAA0001"]);
    expect(m.items.AAAA0001).toMatchObject({
      title: "Paper AAAA0001",
      creators: "Nelson",
      year: "1959",
    });
    expect(itemsIn(m, "COLL0001").map((i) => i.key)).toEqual(["AAAA0001"]);
    expect(itemsIn(m, null)).toHaveLength(1);
    expect(pdfOf(m, "AAAA0001")).toMatchObject({
      key: "PDF00001",
      md5: "md5-PDF00001",
      downloadable: true,
    });
  });

  it("follows edits, moves between collections, trashing and deletion", () => {
    const m = emptyMirror("1");
    applyItems(m, [paper("AAAA0001", { collections: ["COLL0001"] })]);
    applyItems(m, [
      paper("AAAA0001", { title: "Renamed", collections: ["COLL0002"] }),
    ]);
    expect(m.items.AAAA0001.title).toBe("Renamed");
    expect(itemsIn(m, "COLL0001")).toHaveLength(0);
    applyItems(m, [paper("AAAA0001", { deleted: true })]);
    expect(m.items.AAAA0001).toBeUndefined();
    applyItems(m, [paper("AAAA0003"), pdf("PDF00003", "AAAA0003")]);
    applyDeleted(m, ["PDF00003"]);
    expect(pdfOf(m, "AAAA0003")).toBeNull();
  });

  it("prefers a stored PDF over a linked file", () => {
    const m = emptyMirror("1");
    applyItems(m, [
      paper("AAAA0001"),
      pdf("PDF0000A", "AAAA0001", { linkMode: "linked_file" }),
      pdf("PDF0000B", "AAAA0001"),
    ]);
    expect(pdfOf(m, "AAAA0001")?.key).toBe("PDF0000B");
  });

  it("fetches everything once, then only what changed", async () => {
    const reply = (body: unknown, version: number) => ({
      headers: new Headers({ "Last-Modified-Version": String(version) }),
      json: async () => body,
    });
    const m = emptyMirror("1");
    zoteroFetch.mockResolvedValueOnce(reply([paper("AAAA0001")], 10));
    expect(await syncMirror(m, "key", "1")).toBe(true);
    expect(m.version).toBe(10);
    expect(m.collections).toHaveLength(1);
    expect(zoteroFetch.mock.calls[0][1]).toContain("since=0");

    zoteroFetch.mockReset();
    zoteroFetch.mockResolvedValueOnce(reply([], 10));
    expect(await syncMirror(m, "key", "1")).toBe(false);
    expect(zoteroFetch).toHaveBeenCalledTimes(1);

    zoteroFetch.mockReset();
    zoteroFetch
      .mockResolvedValueOnce(reply([paper("AAAA0002")], 12))
      .mockResolvedValueOnce(reply({ items: ["AAAA0001"] }, 12));
    expect(await syncMirror(m, "key", "1")).toBe(true);
    expect(zoteroFetch.mock.calls[0][1]).toContain("since=10");
    expect(zoteroFetch.mock.calls[0][1]).toContain("itemType=-annotation");
    expect(Object.keys(m.items)).toEqual(["AAAA0002"]);
    expect(m.version).toBe(12);
  });
});
