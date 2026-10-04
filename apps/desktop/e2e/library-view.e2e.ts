import { expect, test } from "@playwright/test";

test("library and vault side by side without a project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    // The harness has no native side; anything else is a real error.
    if (!e.message.includes("no native side")) errors.push(e.message);
  });
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto("/e2e/harness.html?scenario=library");
  await expect(
    page.getByText("Reference", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Vault", { exact: false }).first()).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/library-view.png` });
  }
  // Close one side: the other fills the window, and it can come back.
  const closeButtons = page.getByRole("button", { name: /close/i });
  await closeButtons.last().click();
  await expect(
    page.getByRole("button", { name: /show vault too/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /show vault too/i }).click();
  await expect(
    page.getByRole("button", { name: /show vault too/i }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the vault opens on the whole vault's map there", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/e2e/harness.html?scenario=library&vault=1");
  await expect(page.getByText("Whole vault")).toBeVisible();
  const map = page.locator("canvas").first();
  await expect(map).toBeVisible();
  await page.waitForTimeout(2500);
  if (process.env.SHOTS) {
    await map.screenshot({ path: `${process.env.SHOTS}/map-all.png` });
  }
  // One type alone (topics): the notes keep a usable size.
  const legend = page.getByRole("group", { name: "Groups on the map" });
  const chips = legend.getByRole("button");
  for (let i = 0; i < (await chips.count()); i++) {
    const chip = chips.nth(i);
    if (!/topic/i.test(await chip.innerText())) await chip.click();
  }
  await page.waitForTimeout(2500);
  if (process.env.SHOTS) {
    await map.screenshot({ path: `${process.env.SHOTS}/map-topics.png` });
  }
});
