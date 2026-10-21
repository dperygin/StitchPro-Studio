import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Fonts saved by tests go to a fresh temporary folder per run, never into the real fonts_spf/.
// (Workers load this file again; they inherit the folder through the environment.)
const fontsDir = (process.env.STITCHPRO_E2E_FONTS_DIR ??= mkdtempSync(join(tmpdir(), 'stitchpro-e2e-fonts-')));

// Tests run against their own web (5174) and server (8001) so a running dev session is untouched.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1400, height: 860 },
  },
  expect: {
    // Screenshot checks: a few anti-aliased pixels are not a change; a new button is.
    toHaveScreenshot: { maxDiffPixels: 100, animations: 'disabled' },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 860 } } }],
  webServer: [
    {
      command: 'node ../server/run.mjs --port 8001',
      url: 'http://127.0.0.1:8001/api/health',
      env: { STITCHPRO_FONTS_DIR: fontsDir },
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
