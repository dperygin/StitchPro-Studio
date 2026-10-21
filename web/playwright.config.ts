import { defineConfig, devices } from '@playwright/test';

// Tests run against their own web (5174) and server (8001) so a running dev session is untouched.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1400, height: 860 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 860 } } }],
  webServer: [
    {
      command: 'node ../server/run.mjs --port 8001',
      url: 'http://127.0.0.1:8001/api/health',
      // Fonts saved by tests go here, never into the real fonts_spf/.
      env: { STITCHPRO_FONTS_DIR: 'test-results/fonts_spf' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      env: { STITCHPRO_API_PORT: '8001' },
    },
  ],
});
