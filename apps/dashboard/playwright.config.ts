import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Phase 2A money path. Requires the full stack running
 * locally (supabase + api + worker + `next dev`); this does NOT spin services up.
 * See docs/phase2/UAT_2A.md → "Running the E2E".
 *
 *   BASE_URL=http://localhost:3000 npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
