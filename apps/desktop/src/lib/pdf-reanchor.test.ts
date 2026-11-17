import { describe, expect, it } from "vitest";
import type { PageChar } from "@/lib/annotations/pdf-placement";
import type { PdfAnnotationRect } from "@/components/workspace/preview/pdf-viewer";
import { reanchor, searchOrder } from "./pdf-reanchor";

const H = 800;
/** A page of lines, each 20pt tall, 6pt per character, from the top. */
function page(lines: string[], top = 100): PageChar[] {
  const chars: PageChar[] = [];
  lines.forEach((text, line) => {
    [...text].forEach((c, i) => {
      chars.push({
        c,
        x0: 50 + i * 6,
        x1: 56 + i * 6,
        y0: top + line * 20,
        y1: top + line * 20 + 12,
        line,
      });
    });
  });
  return chars;
}

const note = (
  text: string,
  pageIndex: number,
  topY: number,
): PdfAnnotationRect => ({
  key: `local-${text.length}`,
  text,
  pageIndex,
  rects: [[50, H - topY - 12, 200, H - topY]],
  color: "#ffd400",
  type: "highlight",
});

const source = (pages: PageChar[][]) => ({
  count: pages.length,
  height: () => H,
  chars: async (i: number) => pages[i],
});

describe("highlights on a rebuilt draft", () => {
  it("follow their words down the page", async () => {
    const before = note("firms underinvest in research", 0, 100);
    const [after] = await reanchor(
      [before],
      source([
        page(["A new first line.", "Then: firms underinvest in research."]),
      ]),
    );
    expect(after.stale).toBeUndefined();
    expect(after.pageIndex).toBe(0);
    // Now on the second line, 20pt lower.
    expect(after.rects[0][3]).toBe(H - 120);
  });

  it("move to the next page when the text was pushed over", async () => {
    const [after] = await reanchor(
      [note("basic research", 0, 100)],
      source([page(["Something else now."]), page(["On basic research."])]),
    );
    expect(after.pageIndex).toBe(1);
  });

  it("take the occurrence nearest where they were", async () => {
    const [after] = await reanchor(
      [note("same words", 0, 140)],
      source([page(["same words", "filler", "same words", "filler"])]),
    );
    // Lines at 100 and 140: the second.
    expect(after.rects[0][3]).toBe(H - 140);
  });

  it("are kept aside when their words are gone, and come back if they return", async () => {
    const [gone] = await reanchor(
      [note("a sentence I rewrote", 0, 100)],
      source([page(["Entirely different text."])]),
    );
    expect(gone.stale).toBe(true);
    const [back] = await reanchor(
      [gone],
      source([page(["Here is a sentence I rewrote again."])]),
    );
    expect(back.stale).toBeUndefined();
  });

  it("look on their own page first, then outward", () => {
    expect(searchOrder(2, 5)).toEqual([2, 3, 1, 4, 0]);
    // A page past the end (the draft got shorter): from the last one.
    expect(searchOrder(9, 3)).toEqual([2, 1, 0]);
  });
});
