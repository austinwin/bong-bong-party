import { defineConfig, devices } from '@playwright/test';

const external = process.env.BASE_URL;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 45000,
  use: {
    baseURL: external || 'http://127.0.0.1:10192',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: external ? undefined : {
    command: `${process.env.PYTHON || 'python3'} main.py --prod`,
    url: 'http://127.0.0.1:10192/api/health',
    env: { PORT: '10192' },
    reuseExistingServer: !process.env.CI,
  },
});
