import {defineConfig} from '@playwright/test';
// Explicit opt-in: production smoke checks are excluded from local/CI tests.
export default defineConfig({testDir:'./tests',testMatch:'live-deployed.spec.mjs',timeout:30000,retries:0,use:{headless:true,serviceWorkers:'block',timezoneId:'Asia/Manila'}});
