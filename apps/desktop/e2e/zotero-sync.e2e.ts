import { expect, open, test } from "./fixtures";

test("Zotero sync settings explain the tags, and a tag can be stopped and resumed", async ({
  page,
}) => {
  await open(page, "scenario=zotero-sync");
  await expect(page.getByText("Tag a paper").first()).toBeVisible();
  await page.screenshot({ path: "test-results/zotero-sync.png" });

  await page.getByRole("button", { name: "Open…" }).click();
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "topic: Renewable energy" });
  await expect(row).toContainText("Makes a topic");
  // Zotero's own tags aren't listed.
  await expect(
    page.getByRole("listitem").filter({ hasText: "Economics" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("listitem").filter({ hasText: "obsidian" }),
  ).toContainText("Puts papers in the vault");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/zotero-tags.png" });

  await row.getByRole("button", { name: "Stop" }).click();
  await expect(row).toContainText("Stopped");
  await page.getByRole("button", { name: /^stopped$/i }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await row.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("listitem")).toHaveText(["No tags here."]);
});
