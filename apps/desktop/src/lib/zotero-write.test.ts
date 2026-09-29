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
