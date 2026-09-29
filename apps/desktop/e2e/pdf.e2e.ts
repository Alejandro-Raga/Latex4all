import { expect, open, test } from "./fixtures";

test("the PDF's text layer has its words and can be selected", async ({
  page,
}) => {
  await open(page, "scenario=pdf");
  const title = page.locator(".mupdf-text-layer text", {
    hasText: "Scientific Report Title",
  });
  await expect(title).toHaveCount(1, { timeout: 30_000 });

  // Every line carries text and sits on the page, not at y=0.
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll(".mupdf-text-layer text")]
      .filter((t) => (t.textContent ?? "").trim())
      .map((t) => Number(t.getAttribute("y"))),
  );
  expect(lines.length).toBeGreaterThan(5);
  expect(lines.every((y) => y > 0)).toBe(true);

  // Drag from the title's first letter to the subtitle's last, aiming at the
  // letters themselves (SVG reports where each is drawn), so it holds for
  // any font — they differ between macOS and the Linux CI machines.
  const letter = (text: string, which: "first" | "last") =>
    page.evaluate(
      ([t, w]) => {
        const el = [
          ...document.querySelectorAll(".mupdf-text-layer text"),
        ].find((x) => x.textContent?.startsWith(t as string)) as SVGTextElement;
        const i = w === "first" ? 0 : el.getNumberOfChars() - 1;
        const box = el.getExtentOfChar(i);
        const m = el.getScreenCTM() as DOMMatrix;
        const p = new DOMPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ).matrixTransform(m);
        return { x: p.x, y: p.y };
      },
      [text, which],
    );
  const a = await letter("Scientific Report Title", "first");
  const b = await letter("Subtitle or Project Name", "last");
  await page.mouse.move(a.x - 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 1, b.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).lastSelection))
    .toBe("Scientific Report Title\nSubtitle or Project Name");

  // Where it is on the page, in PDF points from the bottom left, as Zotero
  // stores highlights: two lines, inside a US-letter page, title above.
  const { rects, height } = await page.evaluate(() => ({
    rects: (window as any).lastRects as number[][],
    height: (window as any).lastPageHeight as number,
  }));
  expect(height).toBeCloseTo(792, 0);
  expect(rects.length).toBeGreaterThanOrEqual(2);
  for (const [x1, y1, x2, y2] of rects) {
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(x2).toBeLessThanOrEqual(612);
    expect(y1).toBeLessThan(y2);
    expect(y2).toBeLessThanOrEqual(792);
  }
  expect(rects[0][1]).toBeGreaterThan(rects[rects.length - 1][1]);
});
