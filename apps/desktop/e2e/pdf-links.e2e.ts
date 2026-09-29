import { expect, open, test } from "./fixtures";

test("following a link in a PDF lands on its target, and Back returns", async ({
  page,
}) => {
  await open(page, "scenario=pdf&pdf=paper-acm");
  const link = page.locator('.mupdf-link-layer a[href^="#page=2&y="]').first();
  await expect(link).toBeAttached({ timeout: 30_000 });

  const scroller = page.locator("[data-local-zoom-shortcuts]").first();
  const top = () => scroller.evaluate((el) => el.scrollTop);
  const before = await top();
  await link.click({ force: true });

  // It lands partway down page 2, where the reference is, not at its top.
  const back = page.getByRole("button", { name: /Back to p\. 1/ });
  await expect(back).toBeVisible();
  const landed = await top();
  const page2 = await scroller.evaluate((el) => {
    const p = el.querySelector('[data-page-number="2"]') as HTMLElement;
    return (
      p.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop
    );
  });
  // (Or as far down as the document scrolls, which here is the end.)
  const max = await scroller.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  expect(landed).toBeGreaterThanOrEqual(Math.min(page2 + 200, max));

  await back.click();
  await expect(back).toBeHidden();
  expect(Math.abs((await top()) - before)).toBeLessThan(4);
});
