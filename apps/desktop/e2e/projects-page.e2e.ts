import { expect, open, test } from "./fixtures";

test("the projects page: chips, cards, a missing folder and a shared project", async ({
  page,
}) => {
  await open(page, "scenario=projects");
  await expect(page.getByText("Conference talk").first()).toBeVisible();
  await expect(page.getByText("Folder not found").first()).toBeVisible();
  await expect(page.getByText(/Edited 2 h ago/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Presentation/ }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/projects-grid.png" });

  // A type chip filters.
  await page.getByRole("button", { name: /^Article/ }).click();
  await expect(page.getByText("Conference talk")).toHaveCount(0);
  await page.getByRole("button", { name: /^All \d/ }).click();

  // The list view.
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("row").first()).toBeVisible();
  await page.screenshot({ path: "test-results/projects-list.png" });
});
