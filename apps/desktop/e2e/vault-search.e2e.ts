import { expect, open, test } from "./fixtures";

test("the vault list filters by year, typed or picked", async ({ page }) => {
  await open(page, "scenario=library&vault=1");
  const search = page.getByLabel("Search notes");
  await expect(search).toBeVisible();
  // Typed: papers from 2000 to 2002.
  await search.fill("year:2000-2002");
  await expect(page.getByText("3 notes")).toBeVisible();
  // Picked in the filter row, newest first.
  await search.fill("");
  await page.getByRole("button", { name: "Filter" }).first().click();
  await page.getByLabel("From year").fill("2010");
  await expect(page.getByText("4 notes")).toBeVisible();
  await page.getByRole("combobox", { name: "Order" }).first().click();
  await page.getByRole("option", { name: "Newest first" }).click();
  const first = page.getByRole("button", { name: /Paper 14/ }).first();
  await expect(first).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("4 notes")).toHaveCount(0);
  // Ordered with nothing searched, the list keeps its sections.
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^Papers\s*14$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Paper \d+/ }).first(),
  ).toHaveAccessibleName(/Paper 14/);
});
