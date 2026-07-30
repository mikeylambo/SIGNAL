import { defineConfig, devices } from '@playwright/test';

// Sandboxes and CI images often ship a Chromium that doesn't match the build
// @playwright/test wants, and can't download one. PLAYWRIGHT_CHROMIUM_PATH lets
// such an environment point at the browser it already has. `channel` has to be
// cleared alongside it: a channel takes precedence over executablePath, so
// leaving it set sends Playwright back to the build it can't find.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

// That variable also implies WebKit cannot be fetched — it exists precisely
// because this environment can't download browsers. So when it is set, the
// WebKit projects are dropped rather than failing with "executable doesn't
// exist". CI leaves it unset and runs the full matrix.
const chromiumOnly = !!chromiumPath;

const chromiumLaunch = chromiumPath
  ? { channel: undefined, launchOptions: { executablePath: chromiumPath } }
  : {};

// Only the cross-browser spec runs on the non-default projects. The other specs
// cover game rules, which do not vary by engine — running all of them four times
// would quadruple CI for no new signal. See tests/crossbrowser.spec.ts.
const CROSS_BROWSER = /crossbrowser\.spec\.ts/;

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
  },
  projects: [
    // The full suite. Everything else is a platform-surface subset.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
      testMatch: CROSS_BROWSER,
    },
    // Chrome on Android is the same Blink/V8 as mobile-chrome above, so that
    // project transfers closely to real Android hardware. WebKit does not
    // transfer the same way to iOS — see the note in crossbrowser.spec.ts.
    ...(chromiumOnly ? [] : [
      {
        name: 'webkit',
        use: { ...devices['Desktop Safari'] },
        testMatch: CROSS_BROWSER,
      },
      {
        name: 'mobile-safari',
        use: { ...devices['iPhone 14'] },
        testMatch: CROSS_BROWSER,
      },
    ]),
  ],
});
