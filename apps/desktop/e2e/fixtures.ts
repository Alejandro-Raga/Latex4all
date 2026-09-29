import { test as base, expect, type Page } from "@playwright/test";

/** A page that fails the test on any uncaught error (bar the stubbed Tauri). */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => {
      if (!/no native side|__TAURI|transformCallback/i.test(e.message)) {
        errors.push(e.message);
      }
    });
    await use(errors);
    expect(errors, "uncaught errors on the page").toEqual([]);
  },
});

export { expect };

export const open = (page: Page, query: string) =>
  page.goto(`/e2e/harness.html?${query}`);
