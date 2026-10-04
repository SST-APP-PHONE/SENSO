import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4310);
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "mysql://senso:senso_dev@localhost:3306/senso_e2e_test";
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "es-MX",
    timezoneId: "America/Mazatlan",
    launchOptions: { executablePath },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "android", use: { ...devices["Pixel 7"], launchOptions: { executablePath } }, testMatch: /responsive|mvp-flow/ },
    // Emulación de iPhone sobre Chromium (viewport, UA, táctil); WebKit real requiere su propio motor.
    { name: "iphone", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium", launchOptions: { executablePath } }, testMatch: /responsive/ },
  ],
  webServer: {
    command: `npx vite build && npx tsx server/index.ts`,
    url: `http://localhost:${E2E_PORT}/senso/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(E2E_PORT),
      DATABASE_URL: E2E_DB,
      ADMIN_SECRET: "e2e-secret-0123456789-0123456789-0123456789",
      SENSO_DISABLE_RATE_LIMIT: "1",
      APP_TIMEZONE: "America/Mazatlan",
    },
  },
});
