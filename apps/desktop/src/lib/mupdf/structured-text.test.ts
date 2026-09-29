import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toTextLayer } from "./structured-text";

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
