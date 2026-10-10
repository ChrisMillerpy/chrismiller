import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4329);

export default defineConfig({
  testDir: 'tests/e2e',
  // One database shared by every test, so one worker, in order.
  workers: 1,
  fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node tests/e2e/fake-access.mjs', url: 'http://127.0.0.1:4401/health', reuseExistingServer: false },
    { command: './scripts/e2e-server.sh', url: `http://127.0.0.1:${port}/`, reuseExistingServer: false, timeout: 120_000 },
  ],
});
