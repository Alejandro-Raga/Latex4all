import { APP_THEMES } from "../src/lib/app-themes";
import { expect, open, test } from "./fixtures";

// The window reads as regions, as in Obsidian: headers and the ribbon in the
// frame's tone, the sidebars in theirs, the documents on the page.
for (const theme of APP_THEMES) {
  test(`theme ${theme.id} sets the window apart in regions`, async ({
    page,
  }) => {
    await open(page, `scenario=workspace&theme=${theme.id}`);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    const bg = await page.evaluate(() => {
      const of = (sel: string) =>
        getComputedStyle(document.querySelector(sel) as Element)
          .backgroundColor;
      return {
        header: of(".pane-header"),
        editor: of(".cm-editor"),
        sidebar: of(".bg-sidebar"),
      };
    });
    expect(bg.header).not.toBe(bg.editor);
    expect(bg.header).not.toBe(bg.sidebar);
    expect(bg.sidebar).not.toBe(bg.editor);
  });
}
