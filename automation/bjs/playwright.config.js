import { defineConfig, devices } from '@playwright/test';

const artifactRoot = '../../artifacts/bjs';

export default defineConfig({
  testDir: './tests',
  timeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${artifactRoot}/playwright-report`, open: 'never' }],
    ['json', { outputFile: `${artifactRoot}/logs/playwright-results.json` }]
  ],
  use: {
    baseURL: 'https://www.bjs.com',
    browserName: 'chromium',
    headless: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox']
    }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  outputDir: `${artifactRoot}/test-results`
});
