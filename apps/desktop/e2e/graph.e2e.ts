import { expect, open, test } from "./fixtures";

test("the map settles, lights up on hover, opens on click, and pans and zooms", async ({
  page,
}) => {
  await open(page, "scenario=graph");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(2500);

  // Find a note under the pointer by sweeping until the cursor says so.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  let hit: { x: number; y: number } | null = null;
  for (let y = box.y + 30; y < box.y + box.height - 30 && !hit; y += 10) {
    for (let x = box.x + 30; x < box.x + box.width - 30; x += 10) {
      await page.mouse.move(x, y);
      if ((await canvas.evaluate((c) => c.style.cursor)) === "pointer") {
        hit = { x, y };
        break;
      }
    }
  }
  expect(hit).not.toBeNull();
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).opened))
    .toMatch(/^n\d+$/);

  // Drag the background and zoom: nothing should throw.
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 8 });
  await page.mouse.up();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
});
