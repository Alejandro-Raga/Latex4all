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
  // Into the submenu by keyboard, from the start if the menu wasn't ready.
  const newFolder = page.getByRole("menuitem", { name: "New folder…" });
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.getByText("Grant proposal").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to folder" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(newFolder).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.getByLabel("Folder name").fill("Teaching");
  await page.getByLabel("Folder name").press("Enter");
  // Filed: out of the list, into the folder.
  const tile = page.getByRole("button", { name: /^Teaching/ });
  await expect(tile).toBeVisible();
  await expect(page.getByText("Grant proposal")).toHaveCount(0);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/folders.png` });
  }
  // Dragged onto the folder: in it too.
  const card = page.getByText("Reading notes", { exact: true }).first();
  const from = await card.boundingBox();
  if (!from) throw new Error("not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await page.waitForTimeout(150);
  // Where the folder is now the drag has begun (the page may have moved).
  const to = await tile.boundingBox();
  if (!to) throw new Error("not on screen");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(tile).toHaveClass(/border-primary/);
  await page.mouse.up();
  await expect(page.getByText("Reading notes", { exact: true })).toHaveCount(0);
  await expect(tile).toContainText("2");
  await page.waitForTimeout(100);
  await tile.click();
  await expect(page.getByText("Grant proposal").first()).toBeVisible();
  await expect(
    page.getByText("Reading notes", { exact: true }).first(),
  ).toBeVisible();
  // Dragged onto "All projects" in the title: out of the folder.
  const back = page
    .getByRole("heading")
    .getByRole("button", { name: "All projects" });
  const out = await page
    .getByText("Reading notes", { exact: true })
    .first()
    .boundingBox();
  if (!out) throw new Error("not on screen");
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(out.x + 20, out.y + 20, { steps: 4 });
  await page.waitForTimeout(150);
  const root = await back.boundingBox();
  if (!root) throw new Error("not on screen");
  await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByText("Reading notes", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(100);
  await back.click();
  await expect(
    page.getByText("Reading notes", { exact: true }).first(),
  ).toBeVisible();
  // Another order: every project, the card saying its folder.
  await page.getByRole("button", { name: /Recent/ }).click();
  await page.getByRole("menuitemradio", { name: /Grouped by type/ }).click();
  await expect(page.getByText("Grant proposal").first()).toBeVisible();
  await expect(page.getByText("Teaching").first()).toBeVisible();
  expect(errors).toEqual([]);
});
