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
  // Into the submenu, from the start if the menu wasn't ready.
  const newFolder = page.getByRole("menuitem", { name: "New folder…" });
  await expect(async () => {
    await page.keyboard.press("Escape");
    // Clear of the window's edge, where the menu would open over the pointer.
    const card = page.getByText("Grant proposal").first();
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await card.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to folder" }).click();
    await expect(newFolder).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await newFolder.click();
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
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
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
  // Only once the title shows it'll take the project (a slow machine lags).
  await expect(back).toHaveClass(/ring-primary/);
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

test("the menu on the left: icons only, widened with names, moves between parts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/e2e/harness.html?scenario=projects");
  const menu = page.getByRole("navigation", { name: "Latex4All" });
  const home = menu.getByRole("button", { name: "Home", exact: true });
  await expect(home).toHaveAttribute("aria-current", "page");
  // Icons only to begin with.
  await expect(menu.getByText("Planner", { exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Planner", exact: true }).click();
  await expect(
    menu.getByRole("button", { name: "Planner", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await menu.getByRole("button", { name: "Expand the menu" }).click();
  await expect(
    menu.getByText("Library & Vault", { exact: true }),
  ).toBeVisible();
  await menu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    menu.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await home.click();
  await expect(
    page.getByRole("heading", { name: "All projects" }),
  ).toBeVisible();
});

test("the Library: a project opens in place on its PDFs, other files left out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/e2e/harness.html?scenario=projects");
  await page
    .getByRole("navigation", { name: "Latex4All" })
    .getByRole("button", { name: "Library & Vault", exact: true })
    .click();
  const project = page.getByRole("button", {
    name: "Paper on corporate science",
    exact: true,
  });
  await project.first().click();
  await expect(project.first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /^Draft v3/ })).toBeVisible();
  // One in a folder says which.
  await expect(
    page.getByRole("button", { name: /^Figure 1\s*figures/ }),
  ).toBeVisible();
  for (const other of ["main.tex", "Comments.docx", "plot.py"]) {
    await expect(page.getByText(other)).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "Show all files" }),
  ).toBeVisible();
  // A project with none says so.
  await page
    .getByRole("button", { name: "Grant proposal", exact: true })
    .first()
    .click();
  await expect(page.getByText("No PDFs")).toBeVisible();
  // Folded again.
  await project.first().click();
  await expect(page.getByRole("button", { name: /^Draft v3/ })).toHaveCount(0);
  // A PDF exported since: there on opening it again.
  await page.evaluate(() => {
    (window as any).__laterFiles = ["Final export.pdf"];
  });
  await project.first().click();
  await expect(
    page.getByRole("button", { name: /^Final export/ }),
  ).toBeVisible();
});

test("the Library opens where you left it", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/e2e/harness.html?scenario=projects");
  const toLibrary = () =>
    page
      .getByRole("navigation", { name: "Latex4All" })
      .getByRole("button", { name: "Library & Vault", exact: true })
      .click();
  await toLibrary();
  await page
    .getByRole("button", { name: "Paper on corporate science", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Show all files" }).click();
  await expect(page.getByText("Draft v3.pdf")).toBeVisible();
  // Kept a moment after it changes.
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("place.json")))
    .toContain("Paper on corporate science");
  await page.reload();
  await toLibrary();
  // Still looking through that project's files.
  await expect(page.getByText("Draft v3.pdf")).toBeVisible();
});

test("the app opens in the part you were in", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("place.json", JSON.stringify({ last: "planner" }));
  });
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/e2e/harness.html?scenario=projects");
  await page.evaluate(async () => {
    const { followProjectNav } = await import("/src/stores/nav-store.ts");
    followProjectNav();
  });
  await expect(
    page
      .getByRole("navigation", { name: "Latex4All" })
      .getByRole("button", { name: "Planner", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
