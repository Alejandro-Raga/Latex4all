import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toTextLayer, withCharEdges } from "./structured-text";

describe("toTextLayer", () => {
  it("reads the lines mupdf produces, so the page's text is selectable", async () => {
    const mupdf = await import("mupdf");
    const pdf = readFileSync(
      resolve(__dirname, "../../../public/examples/report-scientific/main.pdf"),
    );
    const doc = mupdf.Document.openDocument(
      new Uint8Array(pdf),
      "application/pdf",
    );
    const raw = JSON.parse(
      doc.loadPage(0).toStructuredText("preserve-whitespace").asJSON(),
    );
    const lines = toTextLayer(raw).blocks.flatMap((b) =>
      b.type === "text" ? b.lines : [],
    );
    const title = lines.find((l) => l.text === "Scientific Report Title");
    expect(title).toMatchObject({
      y: 299,
      font: { size: 17, family: "serif" },
    });
    expect(lines.filter((l) => l.text.trim()).length).toBeGreaterThan(5);
    expect(lines.every((l) => l.y > 0)).toBe(true);
  });

  it("still reads the older span-and-character output", () => {
    const { blocks } = toTextLayer({
      blocks: [
        {
          type: "text",
          bbox: { x: 0, y: 0, w: 100, h: 20 },
          lines: [
            {
              bbox: { x: 10, y: 5, w: 80, h: 12 },
              spans: [
                {
                  size: 11,
                  font: { name: "Times", family: "serif" },
                  chars: [
                    { c: "H", origin: { x: 10, y: 15 } },
                    { c: "i", origin: { x: 18, y: 15 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(blocks[0].lines[0]).toMatchObject({
      text: "Hi",
      y: 15,
      font: { size: 11 },
    });
  });
});

describe("withCharEdges", () => {
  it("puts each line's printed letter edges on it, when they match", async () => {
    const mupdf = await import("mupdf");
    const pdf = readFileSync(
      resolve(__dirname, "../../../public/examples/report-scientific/main.pdf"),
    );
    const doc = mupdf.Document.openDocument(
      new Uint8Array(pdf),
      "application/pdf",
    );
    const stext = doc.loadPage(0).toStructuredText("preserve-whitespace");
    const edges: [number, number][][] = [];
    stext.walk({
      beginLine: () => {
        edges.push([]);
      },
      onChar: (
        c: string,
        _o: unknown,
        _f: unknown,
        _s: number,
        q: number[],
      ) => {
        for (let i = 0; i < c.length; i++) {
          edges[edges.length - 1].push([
            Math.min(q[0], q[2], q[4], q[6]),
            Math.max(q[0], q[2], q[4], q[6]),
          ]);
        }
      },
    });
    const lines = withCharEdges(
      toTextLayer(JSON.parse(stext.asJSON())),
      edges,
    ).blocks.flatMap((b) => (b.type === "text" ? b.lines : []));
    const title = lines.find((l) => l.text === "Scientific Report Title");
    expect(title?.chars).toHaveLength(title?.text.length ?? -1);
    // Left to right, inside the line's box.
    const xs = title?.chars?.map((c) => c[0]) ?? [];
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[0]).toBeGreaterThanOrEqual((title?.bbox.x ?? 0) - 1);
  });

  it("leaves lines alone when the counts don't match", () => {
    const data = toTextLayer({
      blocks: [
        {
          type: "text",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          lines: [
            { bbox: { x: 0, y: 0, w: 10, h: 10 }, text: "ab", x: 0, y: 9 },
          ],
        },
      ],
    });
    expect(withCharEdges(data, [[[0, 1]]]).blocks[0].lines[0].chars).toBe(
      undefined,
    );
  });
});
