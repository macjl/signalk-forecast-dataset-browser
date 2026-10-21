import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.browser.js',
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
    launchOptions: process.env.FORECAST_BROWSER_EXECUTABLE ? { executablePath: process.env.FORECAST_BROWSER_EXECUTABLE } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: { command: 'node test/server.cjs', url: 'http://127.0.0.1:4178', reuseExistingServer: false }
})
