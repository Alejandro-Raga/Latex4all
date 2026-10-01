import { expect, open, test } from "./fixtures";

test("adding to Zotero asks for a collection and remembers it", async ({
  page,
}) => {
  await open(page, "scenario=workspace&dialog=zotero-target");
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => (window as any).chooseZoteroTarget);
  const ask = () => page.evaluate(() => (window as any).chooseZoteroTarget(2));

  const first = ask();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Add 2 references to Zotero")).toBeVisible();
  await expect(
    dialog.getByText("Tagged “from: Science Policy Paper”."),
  ).toBeVisible();
  await dialog.getByRole("combobox", { name: "Collection" }).click();
  await page.getByRole("option", { name: "EU programmes" }).click();
  await dialog.getByRole("button", { name: "Add" }).click();
  expect(await first).toEqual({ collection: "EU" });

  // Next time it starts where you left it; cancelling adds nothing.
  const second = ask();
  await expect(dialog.getByRole("combobox", { name: "Collection" })).toHaveText(
    /EU programmes/,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await second).toBeNull();
});
