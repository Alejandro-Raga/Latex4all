import { expect, test } from "@playwright/test";

test("menus are clear, frosted or solid, one tile each", async ({ page }) => {
  await page.goto("/e2e/harness.html?scenario=appearance");
  const tile = (name: string) =>
    page.getByRole("button", { name, exact: true });
  // Once, after the themes, not in every group.
  await expect(tile("Frosted")).toHaveCount(1);
  await expect(tile("Clear")).toHaveAttribute("aria-pressed", "true");
  await tile("Frosted").click();
  await expect(tile("Frosted")).toHaveAttribute("aria-pressed", "true");
  await expect(tile("Clear")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).toHaveAttribute("data-glass", "frosted");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/appearance.png` });
  }
  await tile("Solid").click();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "solid");
});
