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

  // Drag across the title and subtitle (browser coordinates: Playwright's
  // box for SVG text is off in WebKit).
  const box = (text: string) =>
    page.evaluate((t) => {
      const el = [...document.querySelectorAll(".mupdf-text-layer text")].find(
        (x) => x.textContent?.startsWith(t),
      );
      const r = (el as Element).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, text);
  const a = await box("Scientific Report Title");
  const b = await box("Subtitle or Project Name");
  await page.mouse.move(a.x + 3, a.y + a.h / 2);
  await page.mouse.down();
  // Past the end of the line, so the whole line is taken whatever the font
  // metrics (they differ between macOS and the Linux CI machines).
  await page.mouse.move(b.x + b.w + 30, b.y + b.h / 2, { steps: 12 });
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
