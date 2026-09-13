import { defineConfig, devices } from '@playwright/test';

// A dedicated loopback port so a browser check never collides with, or talks to, a running
// Fly Garden instance on the configured API port.
const port = Number(process.env.BROWSER_TEST_PORT ?? 8792);
export const baseURL = `http://127.0.0.1:${port}`;

/**
 * Headless accessibility verification against the production build served by the local server.
 * Nothing here starts, advances, checkpoints or steers a simulation, and no request leaves the
 * loopback interface. `data/` is gitignored, so anatomical and runtime panels may legitimately
 * render their unavailable state; the specs assert that honest state instead of failing.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, headless: true, trace: 'off' },
  projects: [
    {
      name: 'motion-default',
      testMatch: ['reduced-motion.spec.js', 'webgl-context-loss.spec.js'],
      use: { ...devices['Desktop Chrome'], reducedMotion: 'no-preference' },
    },
    { name: 'motion-reduce', testMatch: 'reduced-motion.spec.js', use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' } },
    { name: 'forced-colors', testMatch: 'forced-colors.spec.js', use: { ...devices['Desktop Chrome'], forcedColors: 'active' } },
    {
      name: 'small-screen',
      testMatch: 'small-screen.spec.js',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run build && node server/index.js',
    cwd: new URL('../../', import.meta.url).pathname,
    url: `${baseURL}/`,
    env: { PORT: String(port), NODE_ENV: 'production' },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
