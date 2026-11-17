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

test("folders: made, filled from a project's menu, opened, and named on cards in other orders", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await open(page, "scenario=projects");
  await expect(page.getByText("Grant proposal").first()).toBeVisible();
  await page.getByText("Grant proposal").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to folder" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: "New folder…" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByLabel("Folder name").fill("Teaching");
  await page.getByRole("button", { name: "Create" }).click();
  // Filed: out of the list, into the folder.
  const tile = page.getByRole("button", { name: /^Teaching/ });
  await expect(tile).toBeVisible();
  await expect(page.getByText("Grant proposal")).toHaveCount(0);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/folders.png` });
  }
  await tile.click();
  await expect(page.getByText("Grant proposal").first()).toBeVisible();
  await expect(page.getByText("Reading notes")).toHaveCount(0);
  await page
    .getByRole("heading")
    .getByRole("button", { name: "All projects" })
    .click();
  await expect(page.getByText("Reading notes").first()).toBeVisible();
  // Another order: every project, the card saying its folder.
  await page.getByRole("button", { name: /Recent/ }).click();
  await page.getByRole("menuitemradio", { name: /Grouped by type/ }).click();
  await expect(page.getByText("Grant proposal").first()).toBeVisible();
  await expect(page.getByText("Teaching").first()).toBeVisible();
  expect(errors).toEqual([]);
});
