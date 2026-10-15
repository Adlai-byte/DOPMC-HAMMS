import { defineConfig } from '@playwright/test';

const testPort=Number(process.env.HAMMS_TEST_PORT||3000);
if(!Number.isInteger(testPort)||testPort<1024||testPort>65535)throw new Error('Invalid HAMMS_TEST_PORT');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs', // Node emulator/unit *.test.mjs suites run with node --test.
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${testPort}`,
    headless: true,
  },
  webServer: {
    command: `npx serve public -l ${testPort}`,
    port: testPort,
    reuseExistingServer: !process.env.HAMMS_TEST_PORT,
  },
});
