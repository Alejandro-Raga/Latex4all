import { test } from "@playwright/test";
for (const theme of ["light", "dark"]) {
  test(`t ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 420 });
    await page.goto(`/e2e/harness.html?scenario=workspace&theme=${theme}`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${process.env.SHOTS}/t-ws-${theme}.png` });
  });
  test(`p ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 420 });
    await page.goto(`/e2e/harness.html?scenario=projects`);
    if (theme === "dark")
      await page.evaluate(() =>
        document.documentElement.classList.add("dark", "theme-dark"),
      );
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${process.env.SHOTS}/t-pj-${theme}.png` });
  });
}
