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

test("backgrounds are flat or a gradient, by choice", async ({ page }) => {
  await page.goto("/e2e/harness.html?scenario=appearance");
  const tile = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(tile("Flat")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-background", "flat");
  await tile("Gradient").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-background",
    "gradient",
  );
  const image = await page.evaluate(
    () => getComputedStyle(document.body).backgroundImage,
  );
  expect(image).toContain("radial-gradient");
});
