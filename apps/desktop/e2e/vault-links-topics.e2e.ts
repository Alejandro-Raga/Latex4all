import { expect, open, test } from "./fixtures";

const file = (page: import("@playwright/test").Page, path: string) =>
  page.evaluate((p) => (window as any).vaultFiles.get(p) as string, path);

test("typing [[ in a note suggests notes, found by title as well as name", async ({
  page,
}) => {
  await open(page, "scenario=vault");
  await page.getByRole("button", { name: /My idea/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" See [[transformative");

  // The paper whose file is named something else entirely, by its title.
  const option = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "A human capability approach",
  });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("See [[A human capability approach]]");
});

test("right-click a paper to connect it to a new topic", async ({ page }) => {
  await open(page, "scenario=vault");
  await page
    .getByRole("button", { name: /Absorptive capacity: a new perspective/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Connect to topic" }).hover();
  await page.getByRole("menuitem", { name: "New topic…" }).click();
  await page.getByLabel("Topic name").fill("Absorptive capacity");
  await page.getByRole("button", { name: "Connect" }).click();

  // The topic note lists the paper; the paper links to the topic.
  await expect
    .poll(() => file(page, "Topics/Absorptive capacity.md"))
    .toContain("- [[Cohen1990]]");
  expect(await file(page, "Topics/Absorptive capacity.md")).toContain(
    "zotero_topic: absorptivecapacity",
  );
  expect(await file(page, "Papers/Cohen1990.md")).toContain(
    'topics:\n- "[[Absorptive capacity]]"',
  );

  // Next time, the topic is offered, ticked for this paper.
  await page
    .getByRole("button", { name: /Absorptive capacity: a new perspective/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Connect to topic" }).hover();
  await expect(
    page.getByRole("menuitem", { name: "Absorptive capacity" }),
  ).toBeDisabled();
});

test("pointing at a link suggestion selects it", async ({ page }) => {
  await open(page, "scenario=vault");
  await page.getByRole("button", { name: /My idea/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" [[");
  const options = page.locator(".cm-tooltip-autocomplete li");
  await expect(options.nth(1)).toBeVisible();
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await options.nth(1).hover();
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(options.nth(0)).not.toHaveAttribute("aria-selected", "true");
});
