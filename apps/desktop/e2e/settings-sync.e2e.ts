import { expect, test } from "@playwright/test";

test("Settings → Sync: the choice of storage is kept", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/e2e/harness.html?scenario=settings&section=sync");
  await expect(page.getByText(/peer-to-peer service to sync/)).toBeVisible();
  await page.getByRole("switch", { name: "Peer-to-peer sync" }).click();
  await page.getByRole("radio", { name: /Cloud folder/ }).check();
  await page.getByRole("button", { name: "Dropbox" }).click();
  const saved = () =>
    page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("sync-settings") ?? "{}"),
    );
  await expect.poll(async () => (await saved()).folder).toContain("Dropbox");
  expect(await saved()).toMatchObject({
    enabled: true,
    storage: "folder",
    chosen: true,
  });
  // A hub code is only taken when it looks like one.
  await page.getByRole("radio", { name: /Your own server/ }).check();
  const use = page.getByRole("button", { name: "Use", exact: true });
  await page.getByLabel("Hub code").fill("nonsense");
  await expect(use).toBeDisabled();
  await page
    .getByLabel("Hub code")
    .fill(`${"a".repeat(52)}.${"0f".repeat(32)}`);
  await use.click();
  await expect.poll(async () => (await saved()).storage).toBe("hub");
  if (process.env.SHOTS) {
    await page.getByRole("radio", { name: /Cloud folder/ }).check();
    await page.screenshot({ path: `${process.env.SHOTS}/sync-settings.png` });
  }
});

test("Settings → Sync: a change made elsewhere isn't undone by the open section", async ({
  page,
}) => {
  await page.goto("/e2e/harness.html?scenario=settings&section=sync");
  await expect(page.getByText(/peer-to-peer service to sync/)).toBeVisible();
  // Chosen at a first share while the section was open.
  await page.evaluate(() =>
    sessionStorage.setItem(
      "sync-settings",
      JSON.stringify({
        enabled: false,
        storage: "folder",
        folder: "/Users/me/Dropbox",
        hubCode: null,
        hubbed: [],
        chosen: true,
      }),
    ),
  );
  await page.getByRole("switch", { name: "Peer-to-peer sync" }).click();
  const saved = () =>
    page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("sync-settings") ?? "{}"),
    );
  await expect.poll(async () => (await saved()).enabled).toBe(true);
  expect(await saved()).toMatchObject({
    storage: "folder",
    folder: "/Users/me/Dropbox",
    chosen: true,
  });
});
