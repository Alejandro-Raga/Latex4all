import { expect, test } from "@playwright/test";

test("library and vault side by side without a project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    // The harness has no native side; anything else is a real error.
    if (!e.message.includes("no native side")) errors.push(e.message);
  });
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto("/e2e/harness.html?scenario=library");
  const bar = (name: string) =>
    page.locator("button[aria-pressed]").filter({ hasText: name });
  await expect(bar("Zotero library")).toHaveAttribute("aria-pressed", "true");
  await expect(bar("Vault")).toHaveAttribute("aria-pressed", "true");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/library-view.png` });
  }
  // Hide one side from the bar: the other fills the window, and it comes back.
  await bar("Vault").click();
  await expect(bar("Vault")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Swap sides" })).toHaveCount(0);
  // The last open side stays open.
  await bar("Zotero library").click();
  await expect(bar("Zotero library")).toHaveAttribute("aria-pressed", "true");
  await bar("Vault").click();
  await expect(bar("Vault")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Swap sides" }).click();
  // One above the other, and back.
  const group = page.locator("[data-panel-group-direction]").first();
  await expect(group).toHaveAttribute(
    "data-panel-group-direction",
    "horizontal",
  );
  await page.getByRole("button", { name: "One above the other" }).click();
  await expect(group).toHaveAttribute("data-panel-group-direction", "vertical");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/library-stacked.png` });
  }
  await page.getByRole("button", { name: "Side by side" }).click();
  await expect(group).toHaveAttribute(
    "data-panel-group-direction",
    "horizontal",
  );
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
