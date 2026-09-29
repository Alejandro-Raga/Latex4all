import { APP_THEMES, CUSTOM_THEME } from "../src/lib/app-themes";
import { expect, open, test } from "./fixtures";

for (const theme of [...APP_THEMES, { id: CUSTOM_THEME, dark: false }]) {
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

    // The editor sits on the theme's background and colors LaTeX its way.
    const editor = page.locator(".cm-editor");
    await expect(editor).toBeVisible();
    const colors = await page.evaluate(() => {
      const css = (el: Element | null) =>
        el ? getComputedStyle(el) : ({} as CSSStyleDeclaration);
      const heading = [...document.querySelectorAll(".cm-line span")].find(
        (s) => s.textContent === "\\section",
      );
      return {
        editor: css(document.querySelector(".cm-editor")).backgroundColor,
        page: css(document.querySelector(".bg-background")).backgroundColor,
        gutter: css(document.querySelector(".cm-gutters")).backgroundColor,
        heading: css(heading ?? null).color,
        text: css(document.querySelector(".cm-content")).color,
      };
    });
    expect(colors.editor).toBe(colors.page);
    expect(colors.gutter).toBe(colors.page);
    expect(colors.heading).not.toBe(colors.text);
    await page.screenshot({ path: `test-results/theme-${theme.id}.png` });
  });
}
