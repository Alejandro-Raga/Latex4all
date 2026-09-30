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

  // A real drag across the title selects it, from just before its first
  // letter to just past its last: the viewer takes the nearest letter, so
  // this holds for any font (they differ between macOS and Linux CI).
  const edge = (text: string, which: "first" | "last") =>
    page.evaluate(
      ([t, w]) => {
        const el = [
          ...document.querySelectorAll(".mupdf-text-layer text"),
        ].find((x) => x.textContent?.startsWith(t as string)) as SVGTextElement;
        const r = el.getBoundingClientRect();
        return {
          x: w === "first" ? r.left - 4 : r.right + 4,
          y: r.top + r.height / 2,
        };
      },
      [text, which],
    );
  const a = await edge("Scientific Report Title", "first");
  const b = await edge("Scientific Report Title", "last");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).lastSelection))
    .toBe("Scientific Report Title");

  // Across two lines, the text keeps them apart. Set the selection directly,
  // so how far a drag reaches with a given font doesn't matter.
  await page.evaluate(() => {
    const find = (t: string) =>
      [...document.querySelectorAll(".mupdf-text-layer text")].find((x) =>
        x.textContent?.startsWith(t),
      ) as SVGTextElement;
    const from = find("Scientific Report Title").firstChild as Text;
    const to = find("Subtitle or Project Name").firstChild as Text;
    const range = document.createRange();
    range.setStart(from, 0);
    range.setEnd(to, to.length);
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    from.parentElement?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
  });
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
