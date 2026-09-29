import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationSortIndex,
  createZoteroHighlight,
  ZoteroWriteDeniedError,
} from "./zotero-api";

describe("saving highlights to Zotero", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("orders annotations like Zotero: page, offset, distance from the top", () => {
    expect(annotationSortIndex(2, 118.6)).toBe("00002|000000|00119");
  });

  it("posts a highlight annotation on the attachment", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ successful: { "0": { key: "NEWKEY12" } } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const key = await createZoteroHighlight(
      "k",
      "123",
      "ATTACH01",
      {
        pageIndex: 2,
        rects: [
          [72, 600, 300, 612],
          [72, 586, 180, 598],
        ],
        text: "basic research",
        comment: "key point",
        color: "#ffd400",
      },
      792,
    );
    expect(key).toBe("NEWKEY12");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zotero.org/users/123/items");
    expect(init.method).toBe("POST");
    const [item] = JSON.parse(init.body as string);
    expect(item).toMatchObject({
      itemType: "annotation",
      parentItem: "ATTACH01",
      annotationType: "highlight",
      annotationText: "basic research",
      annotationComment: "key point",
      annotationColor: "#ffd400",
      annotationPageLabel: "3",
      annotationSortIndex: "00002|000000|00180",
    });
    expect(JSON.parse(item.annotationPosition)).toEqual({
      pageIndex: 2,
      rects: [
        [72, 600, 300, 612],
        [72, 586, 180, 598],
      ],
    });
  });

  it("explains a key that can't write", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    await expect(
      createZoteroHighlight(
        "k",
        "1",
        "A",
        { pageIndex: 0, rects: [[0, 0, 1, 1]], text: "x", color: "#ffd400" },
        792,
      ),
    ).rejects.toBeInstanceOf(ZoteroWriteDeniedError);
  });
});

describe("finding and tagging papers", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

  it("finds the item whose BibTeX key matches exactly", async () => {
    const { findItemForCitekey } = await import("./zotero-api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          {
            key: "AAA",
            bibtex: "@article{nelson_other_1959,",
            data: { date: "1959" },
          },
          {
            key: "BBB",
            bibtex: "@article{nelson_simple_1959,",
            data: { date: "1959" },
          },
        ]),
      ),
    );
    expect(
      await findItemForCitekey("k", "1", "nelson_simple_1959", {
        words: "nelson",
        year: "1959",
      }),
    ).toBe("BBB");
  });

  it("falls back to a lone same-year match, but doesn't guess between two", async () => {
    const { findItemForCitekey } = await import("./zotero-api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          {
            key: "AAA",
            bibtex: "@article{nelson_simple_1959,",
            data: { date: "1959-06" },
          },
          {
            key: "CCC",
            bibtex: "@book{nelson_later_1977,",
            data: { date: "1977" },
          },
        ]),
      ),
    );
    expect(
      await findItemForCitekey("k", "1", "Nelson1959", {
        words: "Nelson",
        year: "1959",
      }),
    ).toBe("AAA");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          { key: "AAA", data: { date: "1959" } },
          { key: "DDD", data: { date: "1959" } },
        ]),
      ),
    );
    expect(
      await findItemForCitekey("k", "1", "Nelson1959", {
        words: "Nelson",
        year: "1959",
      }),
    ).toBeNull();
  });

  it("adds a tag keeping the others, and skips one already there", async () => {
    const { addZoteroTag } = await import("./zotero-api");
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? new Response(null, { status: 204 })
        : json({ version: 7, data: { tags: [{ tag: "econ" }] } }),
    );
    vi.stubGlobal("fetch", fetch);
    await addZoteroTag("k", "1", "AAA", "obsidian");
    const patch = fetch.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    ) as unknown as [string, RequestInit];
    expect(JSON.parse(patch[1].body as string)).toEqual({
      tags: [{ tag: "econ" }, { tag: "obsidian" }],
    });
    expect(
      (patch[1].headers as Record<string, string>)[
        "If-Unmodified-Since-Version"
      ],
    ).toBe("7");

    fetch.mockClear();
    fetch.mockImplementation(async () =>
      json({ version: 8, data: { tags: [{ tag: "Obsidian" }] } }),
    );
    await addZoteroTag("k", "1", "AAA", "obsidian");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
      false,
    );
  });
});
