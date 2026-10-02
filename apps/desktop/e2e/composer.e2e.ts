import { expect, test } from "@playwright/test";

// However narrow, the message box's bottom bar stays one line.
for (const width of [260, 340, 420, 520, 700]) {
  test(`composer bar stays one line at ${width}px`, async ({ page }) => {
    await page.goto(`/e2e/harness.html?scenario=composer&width=${width}`);
    const send = page.getByRole("button", { name: /send|stop/i }).last();
    await expect(send).toBeVisible();
    const box = await send.locator("xpath=../..").boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(34);
    if (process.env.SHOTS) {
      await page
        .getByTestId("composer")
        .screenshot({ path: `${process.env.SHOTS}/composer-${width}.png` });
    }
  });
}
