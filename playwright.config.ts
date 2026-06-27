import { defineConfig, devices } from '@playwright/test';
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
  },
});
