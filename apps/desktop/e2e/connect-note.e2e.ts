import { expect, test } from "@playwright/test";

test("connect to note picks the other note by type", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/e2e/harness.html?scenario=library&vault=1");
  const vault = page.locator('[data-panel-id="vault"]');
  await vault.getByText("Paper 1", { exact: true }).click({ button: "right" });
  // Submenus by keyboard: hovering across them is timing-bound.
  const item = (name: string | RegExp) => page.getByRole("menuitem", { name });
  await item("Connect to note").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(/^(Papers|Topics|Ideas)/)).toHaveCount(3);
  await item(/^Papers/).focus();
  await page.keyboard.press("ArrowRight");
  const papers = page.getByRole("menu").last().getByRole("menuitem");
  // Shown as in the lists (title, author · year), the note itself left out.
  await expect(papers).toHaveCount(13);
  await expect(papers.first()).toContainText(/\d{4}/);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/connect-note.png` });
  }
  const first = (await papers.first().innerText()).split("\n")[0];
  await papers.first().click();
  // Connected: offered again, it's ticked and can't be picked twice.
  await vault.getByText("Paper 1", { exact: true }).click({ button: "right" });
  await item("Connect to note").focus();
  await page.keyboard.press("ArrowRight");
  await item(/^Papers/).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menu").last().getByRole("menuitem", { name: first }),
  ).toBeDisabled();
});
