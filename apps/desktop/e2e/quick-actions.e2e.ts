import { expect, open, test } from "./fixtures";

test("selecting text offers quick AI actions", async ({ page }) => {
  await open(page, "scenario=workspace");
  const line = page.locator(".cm-line", { hasText: "Firms" });
  await expect(line).toBeVisible({ timeout: 30_000 });
  const box = await line.boundingBox();
  if (!box) throw new Error("no line");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  for (const label of [
    "Improve",
    "Shorten",
    "Formal",
    "Translate",
    "Explain",
    "Check argument",
  ]) {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }
});
