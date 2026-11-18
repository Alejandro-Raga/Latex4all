import { expect, open, test } from "./fixtures";

test("highlighting a draft: a comment straight after, and the highlight opened with a click", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await open(page, "scenario=reader");
  const lines = page.locator('[data-page-number="1"] .mupdf-text-layer text');
  await expect
    .poll(() => lines.count(), { timeout: 30_000 })
    .toBeGreaterThan(8);
  // Select a line, as by hand.
  const target = await page.evaluate(() => {
    const all = [
      ...document.querySelectorAll(
        '[data-page-number="1"] .mupdf-text-layer text',
      ),
    ] as SVGTextElement[];
    const t = all.filter((x) => (x.textContent ?? "").trim().length > 25)[3];
    const r = t.getBoundingClientRect();
    return { x0: r.left + 2, x1: r.right - 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(target.x0, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x1, target.y, { steps: 8 });
  await page.mouse.up();
  // A color: highlighted, and a box to comment right away.
  await page
    .getByRole("button", { name: /yellow/i })
    .first()
    .click();
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await comment.fill("Check this claim");
  await comment.press("Enter");
  await expect(comment).toHaveCount(0);
  // A plain click on the highlight opens it: the comment's there to edit.
  await page.mouse.click((target.x0 + target.x1) / 2, target.y);
  await expect(
    page.getByRole("button", { name: "Edit comment" }),
  ).toBeVisible();
});
