import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:3000/api/v1/health', reuseExistingServer: false },
    { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
  ],
});
