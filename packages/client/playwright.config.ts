import { defineConfig } from "@playwright/test";
import { E2E_APP_URL, E2E_PORT } from "./e2e/ports.js";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: E2E_APP_URL,
    browserName: "firefox",
    ignoreHTTPSErrors: true,
    // Specs click sidebar items directly, so keep it open as a column.
    // sidebar.spec.ts covers the collapsing sidebar.
    storageState: {
      cookies: [],
      origins: [{ origin: E2E_APP_URL, localStorage: [{ name: "sidebar-pinned", value: "true" }] }],
    },
  },
  webServer: {
    // Always a fresh server on the e2e port. --strictPort fails fast if the
    // port is taken rather than drifting to another one.
    command: `pnpm exec vite --port ${E2E_PORT} --strictPort`,
    url: E2E_APP_URL,
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
  },
});
