import { expect, open, test } from "./fixtures";

test("a deck's first two slides and its count fit in the portrait card", async ({
  page,
}) => {
  await open(page, "scenario=deck-cards");
  for (const name of ["16:9", "16:10", "4:3", "one slide"]) {
    const card = page.locator(`[data-card="${name}"]`);
    await expect(card.getByText(/\d+ slides?/)).toBeVisible();
    const box = await card.boundingBox();
    const inside = await card
      .locator("img, span")
      .evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().toJSON()),
      );
    expect(box).not.toBeNull();
    for (const r of inside) {
      expect(r.top).toBeGreaterThanOrEqual(box!.y - 0.5);
      expect(r.bottom).toBeLessThanOrEqual(box!.y + box!.height + 0.5);
      expect(r.left).toBeGreaterThanOrEqual(box!.x - 0.5);
      expect(r.right).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
    }
  }
  await expect(
    page.locator('[data-card="16:9"]').getByText("14 slides"),
  ).toBeVisible();
  await expect(
    page.locator('[data-card="one slide"]').getByText("1 slide"),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/deck-cards.png" });
});
