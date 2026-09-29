import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in WebKit — the engine the macOS app renders with — over
 * pages that put one part of the app on screen (e2e/harness.tsx).
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:1455", ...devices["Desktop Safari"] },
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: "pnpm exec vite --port 1455 --strictPort",
    url: "http://localhost:1455/e2e/harness.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
