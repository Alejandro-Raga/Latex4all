import { expect, test } from "@playwright/test";

test("Settings → Where things open, in its group", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/e2e/harness.html?scenario=settings&section=memory");
  await expect(page.getByText("Start fresh every time")).toBeVisible();
  for (const group of ["General", "Writing", "Research", "AI", "Sync"]) {
    await expect(page.getByText(group, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole("switch", { name: "Start fresh every time" }).click();
  await expect(page.getByRole("radio", { name: "Home" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("switch", { name: "Start fresh every time" }),
  ).toHaveAttribute("aria-checked", "true");
  if (process.env.SHOTS)
    await page.screenshot({ path: `${process.env.SHOTS}/settings-memory.png` });
});
