import { expect, open, test } from "./fixtures";

test("the command palette finds and runs a command by typing", async ({
  page,
}) => {
  await open(page, "scenario=palette");
  const input = page.getByPlaceholder("Files, notes, papers, commands…");
  await expect(input).toBeVisible();
  await expect(page.getByText("main.tex")).toBeVisible();
  await input.fill("show vault");
  await expect(page.getByText("main.tex")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => (window as any).dock.getState().open.vault))
    .toBe(true);
  await expect(input).toHaveCount(0);
});
