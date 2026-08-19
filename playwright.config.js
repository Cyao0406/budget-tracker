// Playwright config for budget_tracker_2026's e2e/ regression suite.
// Points at the same "python -m http.server" dev flow documented in CLAUDE.md,
// so this doesn't require adding any bundler/build step to the app itself.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // tests share localStorage/emulator state via one server; keep sequential
  retries: 0, // flaky-test handling is done explicitly in the repair-loop runner, not here
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:8791',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python -m http.server 8791',
    url: 'http://localhost:8791',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
