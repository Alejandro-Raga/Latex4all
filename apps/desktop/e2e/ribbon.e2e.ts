import { expect, open, test } from "./fixtures";

const doc = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => (document.querySelector(".cm-content") as HTMLElement).innerText,
  );

test("the ribbon cites in parentheses, adding natbib, and offers keys", async ({
  page,
}) => {
  await open(page, "scenario=workspace");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.getByText("Firms").click();
  await page.keyboard.press("End");

  await page.getByRole("button", { name: "Cite" }).click();
  await page.getByRole("menuitem", { name: /In parentheses/ }).click();
  await expect.poll(() => doc(page)).toContain("\\citep{}");
  await expect.poll(() => doc(page)).toContain("\\usepackage{natbib}");
  // The keys to choose from open by themselves.
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
});

test("the ribbon turns selected lines into a bulleted list", async ({
  page,
}) => {
  await open(page, "scenario=workspace");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3.5 cm").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- apples");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- pears");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+Home");
  await page
    .getByRole("button", { name: "Bulleted list (from the selected lines)" })
    .click();
  await expect
    .poll(() => doc(page))
    .toContain(
      "\\begin{itemize}\n  \\item apples\n  \\item pears\n\\end{itemize}",
    );
});
