import { expect, open, test } from "./fixtures";

// A drag that starts just off the text (in the margin, between lines) used
// to select from the top of the page: WebKit anchors there when the press
// misses a glyph. And the selection was drawn by the browser, which the
// page filter recoloured to near invisible on dark pages.
test("a drag that starts in the margin selects from the nearest letter, visibly on a dark page", async ({
  page,
}) => {
  await open(page, "scenario=pdf&pdf=letter-formal&ptheme=dark");
  const lines = page.locator('[data-page-number="1"] .mupdf-text-layer text');
  await expect
    .poll(() => lines.count(), { timeout: 30_000 })
    .toBeGreaterThan(8);

  const target = await page.evaluate(() => {
    const all = [
      ...document.querySelectorAll(
        '[data-page-number="1"] .mupdf-text-layer text',
      ),
    ] as SVGTextElement[];
    const long = all.filter((t) => (t.textContent ?? "").trim().length > 25);
    const a = long[Math.floor(long.length / 2)];
    const b = long[Math.floor(long.length / 2) + 1];
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return {
      from: { x: ra.left - 20, y: ra.top + ra.height / 2 },
      to: { x: rb.right + 20, y: rb.top + rb.height / 2 },
      first: (a.textContent ?? "").trim().slice(0, 12),
      last: (b.textContent ?? "").trim().slice(-8),
    };
  });
  await page.mouse.move(target.from.x, target.from.y);
  await page.mouse.down();
  await page.mouse.move(target.to.x, target.to.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => (window as any).lastSelection as string))
    .toMatch(
      new RegExp(`^${target.first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  const text = await page.evaluate(
    () => (window as any).lastSelection as string,
  );
  expect(text.replace(/\s+/g, " ").trim().endsWith(target.last.trim())).toBe(
    true,
  );

  // Drawn by the viewer, one box per line, outside the page's dark filter.
  const boxes = page.locator(
    '[aria-hidden="true"] > .absolute.rounded-\\[2px\\]',
  );
  await expect(boxes).toHaveCount(2);
});
