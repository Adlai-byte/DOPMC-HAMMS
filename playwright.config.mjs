import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/live-deployed.spec.mjs', '**/rules/**'],
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    serviceWorkers: 'block',
    timezoneId: 'Asia/Manila',
  },
  webServer: {
    command: 'npx serve public -l 3000',
    port: 3000,
    reuseExistingServer: true,
  },
});
