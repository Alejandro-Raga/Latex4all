import { expect, test } from "@playwright/test";

test("a note's connections show as pills by type, each opening its list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/e2e/harness.html?scenario=library&vault=1");
  const vault = page.locator('[data-panel-id="vault"]');
  const row = vault.getByRole("button", { name: /^Corporate Science/ }).first();
  await row.scrollIntoViewIfNeeded();
  const papers = row.getByRole("button", { name: /^Papers \d+/ });
  await expect(papers).toBeVisible();
  const count = Number((await papers.innerText()).match(/\d+/)?.[0]);
  expect(count).toBeGreaterThan(0);

  // The pill opens its list without opening the note.
  await papers.click();
  const list = page.getByRole("dialog");
  await expect(list.getByText(`Papers · ${count}`)).toBeVisible();
  if (process.env.SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.SHOTS}/pills.png` });
  }
  await expect(list.getByRole("button")).toHaveCount(count);
  await list.getByRole("button").first().click();
  await expect(list).toHaveCount(0);
});
