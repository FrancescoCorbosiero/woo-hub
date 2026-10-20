import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the Vetrina on its demo shop (VETRINA_SOURCE=fixture),
 * built for production, on a phone's screen. Nothing reaches a real shop.
 *
 * The server is the build already made (`npm run build`) started on its own
 * database, made fresh for every run (e2e/prepare-db.mjs: localhost only, and
 * only a database named for e2e). The tests share one demo shop, so they run
 * one after the other, each putting back what it changed through the app's
 * own "Annulla".
 *
 *   E2E_DATABASE_URL=postgres://postgres@127.0.0.1:5432/hub_e2e npm run test:e2e
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/hub_e2e";
// An iPhone's screen, touch and user agent, in Chromium (the browser CI installs).
const PHONE = { ...devices["iPhone 13"], browserName: "chromium" as const };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "it-IT",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // The demo shop's catalog is read once, before any test needs it.
    { name: "setup", testMatch: /\.setup\.ts$/, use: PHONE },
    { name: "phone", dependencies: ["setup"], testMatch: /\.spec\.ts$/, use: PHONE },
  ],
  webServer: {
    command: `node e2e/prepare-db.mjs && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL,
      // Best-effort cache: with no Redis there, it falls back to memory.
      REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379",
      VETRINA_SOURCE: "fixture",
      SCHEDULER: "off",
      PORT: String(PORT),
    },
  },
});
