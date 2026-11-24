import { defineConfig, devices } from "@playwright/test";

/** Booking end-to-end tests against mock partners. Uses the locally installed Chrome. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", channel: "chrome", trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "desktop", use: { viewport: { width: 1366, height: 900 }, channel: "chrome" } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
        // Test bookings must never reach the real Slixta CRM (.env.local holds live Slixta keys).
        env: { SLIXTA_MODE: process.env.SLIXTA_MODE ?? "mock" },
      },
});
