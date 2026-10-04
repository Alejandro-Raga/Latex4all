import { expect, open, test } from "./fixtures";

// A 4×4 red PNG, as a user's screenshot would arrive.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC",
  "base64",
);

test("a bug report carries text, screenshots and the app's details", async ({
  page,
  errors,
}) => {
  await open(page, "scenario=bug");
  await expect(
    page.getByRole("heading", { name: "Report a bug" }),
  ).toBeVisible();
  const send = page.getByRole("button", { name: "Send report" });
  await expect(send).toBeDisabled();
  await page
    .getByLabel("What happened")
    .fill("The map shrinks when I hide papers");
  await page.locator('input[type="file"]').setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("img", { name: "Screenshot" })).toHaveCount(1);
  await page.getByLabel("Email for a reply").fill("me@example.com");
  await page.getByRole("button", { name: "See what's sent" }).click();
  await expect(page.getByText("version: 1.2.120")).toBeVisible();
  await send.click();
  await expect(page.getByRole("heading", { name: "Report a bug" })).toHaveCount(
    0,
  );
  const sent = await page.evaluate(() => (window as any).__sentReport);
  expect(sent.text).toBe("The map shrinks when I hide papers");
  expect(sent.contact).toBe("me@example.com");
  expect(sent.app.version).toBe("1.2.120");
  expect(sent.images).toHaveLength(1);
  expect(sent.images[0].type).toBe("image/jpeg");
  expect(errors).toEqual([]);
});
