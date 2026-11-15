// E2E tests run against the production build (npm run build) served by astro preview.
// Set BASE_PATH to test a project-site prefix (e.g. /isalang-site), as on GitHub Pages.
// Set PW_CHROMIUM to use a system Chromium instead of Playwright's download.
import { defineConfig, devices } from '@playwright/test';

const base = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const port = 4331;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}${base}`,
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: `npx astro preview --ignore-lock --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
