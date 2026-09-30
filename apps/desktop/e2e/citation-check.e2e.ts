import { expect, open, test } from "./fixtures";

test("check citations shows one list at a time, within the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await open(page, "scenario=workspace&dialog=cite&many=50");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // Counts per list, opening on the first with something in it.
  await expect(
    dialog.getByRole("tab", { name: /Not in bibliography\s*52/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("tab", { name: /Not in vault\s*7/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: /Never cited\s*2/ }),
  ).toBeVisible();

  // A long list scrolls inside the window instead of pushing it off screen.
  const box = await dialog.boundingBox();
  expect(box && box.y >= 0 && box.y + box.height <= 760).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Add all from Zotero" }),
  ).toBeVisible();

  // Papers missing from the vault are named by their title too.
  await dialog.getByRole("tab", { name: /Not in vault/ }).click();
  await expect(
    dialog.getByText("A paper called author0_a_rather_long_title_word_2000"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add all to vault" }),
  ).toBeVisible();
});
