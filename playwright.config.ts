import { defineConfig, devices } from '@playwright/test';

// Sandboxes and CI images often ship a Chromium that doesn't match the build
// @playwright/test wants, and can't download one. PLAYWRIGHT_CHROMIUM_PATH lets
// such an environment point at the browser it already has. `channel` has to be
// cleared alongside it: a channel takes precedence over executablePath, so
// leaving it set sends Playwright back to the build it can't find.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  webServer: {
    command: 'npx vite --port 5174',
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5174',
    ...devices['Desktop Chrome'],
    ...(chromiumPath
      ? { channel: undefined, launchOptions: { executablePath: chromiumPath } }
      : {}),
  },
});
