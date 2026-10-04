import { expect, open, test } from "./fixtures";

test("a plain mouse wheel scrolls the ribbon sideways", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await open(page, "scenario=workspace");
  const ribbon = page.locator("[data-scroll-sideways]").first();
  await expect(ribbon).toBeVisible();
  const before = await ribbon.evaluate((el) => ({
    left: el.scrollLeft,
    room: el.scrollWidth - el.clientWidth,
  }));
  expect(before.room).toBeGreaterThan(0);
  await ribbon.hover();
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => ribbon.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(before.left);
});

test("the map zooms with its buttons", async ({ page }) => {
  await open(page, "scenario=library&vault=1");
  for (const name of ["Zoom in", "Zoom out", "Fit to view (or double-click)"]) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
  const map = page.locator("canvas").first();
  await page.waitForTimeout(1500);
  const before = await map.screenshot();
  await page.getByRole("button", { name: "Zoom in" }).first().click();
  await page.getByRole("button", { name: "Zoom in" }).first().click();
  const after = await map.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
});
