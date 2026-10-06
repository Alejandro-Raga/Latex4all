import { expect, open, test } from "./fixtures";

test("the help reads as a manual, and its search narrows it", async ({
  page,
  errors,
}) => {
  await open(page, "scenario=help");
  await expect(
    page.getByRole("heading", { name: "Getting started" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeAttached();
  // Inside a project there's no projects page to go to.
  await expect(
    page.getByRole("button", { name: /Open the projects page/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Open Settings → Zotero/ }),
  ).toBeVisible();

  await page.getByLabel("Search help").fill("highlight");
  await expect(
    page.getByRole("heading", { name: "Reading papers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared projects" }),
  ).toHaveCount(0);
  await page.getByLabel("Search help").fill("xyzzy");
  await expect(
    page.getByText("Nothing in the help mentions that."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
