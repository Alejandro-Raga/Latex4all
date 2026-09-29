import { expect, open, test } from "./fixtures";

const arrows = '[aria-label="Collapse"], [aria-label="Expand"]';

test("a lone panel can't fold, and folding survives neighbours coming and going", async ({
  page,
  errors,
}) => {
  await open(page, "scenario=dock");
  await expect(page.getByText("Quick reference")).toBeVisible();
  await expect(page.locator(arrows)).toHaveCount(0);

  await page.evaluate(() =>
    (window as any).dock.getState().setOpen("vault", true),
  );
  await expect(page.locator(arrows)).toHaveCount(2);
  await page.locator('[aria-label="Collapse"]').first().click();
  await expect(page.locator('[aria-label="Expand"]')).toHaveCount(1);

  // The neighbour closes: the folded panel opens up rather than crashing.
  await page.evaluate(() =>
    (window as any).dock.getState().setOpen("vault", false),
  );
  await expect(page.locator(arrows)).toHaveCount(0);
  await expect(page.getByText("Open folder…")).toBeVisible();

  await page.evaluate(() =>
    (window as any).dock.getState().setOpen("vault", true),
  );
  await expect(page.locator('[aria-label="Expand"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a panel widens into the pane and goes back", async ({ page }) => {
  await open(page, "scenario=dock");
  await page.evaluate(() =>
    (window as any).dock.getState().setOpen("vault", true),
  );
  await page.locator('[aria-label="Widen"]').last().click();
  await expect(
    page.getByTestId("pane").getByText("Where is your vault?"),
  ).toBeVisible();
  await page.locator('[aria-label="Back to the side"]').click();
  await expect(page.getByTestId("pane")).toHaveText("pane");
});
