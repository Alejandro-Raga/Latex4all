import { expect, open, test } from "./fixtures";

test("a highlight in a note is a card: its comment apart, the notes quoting it, a menu", async ({
  page,
}) => {
  await open(page, "scenario=vault");
  await page
    .getByRole("button", { name: /The decline of science in corporate R&D/ })
    .first()
    .click();
  const card = page.locator("figure", {
    hasText: "Large firms have withdrawn from research.",
  });
  await expect(card).toBeVisible();
  // The comment is in the card, as text, not HTML.
  await expect(card).toContainText("Fits my argument on budgets");
  await expect(page.getByText("<em", { exact: false })).toHaveCount(0);
  // The idea quoting the same highlight, one click away.
  await expect(
    card.getByRole("button", { name: /Firms retreat from research/ }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/vault-highlights.png" });

  await card.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Add to idea…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Open in the PDF" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await card
    .getByRole("button", { name: /Firms retreat from research/ })
    .click();
  await expect(page.getByRole("heading", { name: /The idea/ })).toBeVisible();
});
