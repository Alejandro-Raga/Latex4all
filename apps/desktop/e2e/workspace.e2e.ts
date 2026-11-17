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

test("conflicted copies: the same ones go, the others are reviewed", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 820 });
  await open(page, "scenario=workspace&copies=1");
  const disk = () =>
    page.evaluate(() =>
      [...((window as any).__copiesDisk as Map<string, string>).keys()].map(
        (k) => k.split("/").pop(),
      ),
    );
  // The identical copy and Git's pointer go by themselves.
  await expect.poll(disk).not.toContain("refs (conflicted copy).bib");
  await expect.poll(disk).not.toContain(".git (conflicted copy)");
  await page.getByRole("button", { name: /1 conflicted copy/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Compare" }).click();
  await expect(
    dialog.getByText("1 difference.", { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByText("Overview")).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/copies.png` });
  }
  await dialog.getByRole("button", { name: "Keep the copy" }).click();
  await expect.poll(disk).not.toContain("main (conflicted copy).tex");
  const main = await page.evaluate(() =>
    ((window as any).__copiesDisk as Map<string, string>).get(
      "/p/Science Policy Paper/main.tex",
    ),
  );
  expect(main).toContain("Overview");
  await expect(
    page.getByRole("button", { name: /conflicted cop/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
