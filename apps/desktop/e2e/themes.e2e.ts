import { APP_THEMES } from "../src/lib/app-themes";
import { expect, open, test } from "./fixtures";

for (const theme of APP_THEMES) {
  test(`theme ${theme.id} colors the page`, async ({ page }) => {
    await open(page, `scenario=theme&theme=${theme.id}`);
    await expect(page.getByText("themed")).toBeVisible();
    const bg = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".bg-background") as Element)
          .backgroundColor,
    );
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains("theme-dark"),
    );
    expect(dark).toBe(theme.dark);
  });
}
