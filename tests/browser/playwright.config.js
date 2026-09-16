import { defineConfig, devices } from '@playwright/test';

// A dedicated loopback port so a browser check never collides with, or talks to, a running
// Fly Garden instance on the configured API port.
const port = Number(process.env.BROWSER_TEST_PORT ?? 8792);
export const baseURL = `http://127.0.0.1:${port}`;

/**
 * Accessibility verification against the production build served by the local server.
 * Nothing here starts, advances, checkpoints or steers a simulation, and no request leaves the
 * loopback interface. `data/` is gitignored, so anatomical and runtime panels may legitimately
 * render their unavailable state; the specs assert that honest state instead of failing.
 *
 * By default the suite launches the pinned Chrome Headless Shell, which has no display and
 * rasterizes in software. Setting `FLY_GARDEN_CDP_ENDPOINT` to the DevTools Protocol endpoint of an
 * already running browser makes `tests/browser/cdp-browser.js` run the same specs there instead, on
 * a real GPU, in its own isolated browser context. Unset, behaviour is unchanged. CI has no GPU and
 * never sets it. Every spec prints the browser and renderer behind the figures it records.
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
      testMatch: ['reduced-motion.spec.js', 'webgl-context-loss.spec.js', 'atlas-redraw.spec.js', 'atlas-interaction.spec.js'],
      use: { ...devices['Desktop Chrome'], reducedMotion: 'no-preference' },
    },
    { name: 'motion-reduce', testMatch: 'reduced-motion.spec.js', use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' } },
    { name: 'forced-colors', testMatch: 'forced-colors.spec.js', use: { ...devices['Desktop Chrome'], forcedColors: 'active' } },
    {
      name: 'panels',
      testMatch: 'panel-keyboard.spec.js',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Issues one explicit load/unload pair; skips itself unless FLY_GARDEN_BROWSER_FIXTURE=1.
      name: 'resident-fixture',
      testMatch: 'resident-fixture.spec.js',
      use: { ...devices['Desktop Chrome'] },
    },
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
    // Its own empty identity directory, so a browser check never takes the writer lock from, or
    // writes into, a Fly Garden instance the developer is already running. The suite creates no
    // individual, so this directory stays empty and the panels render their honest paused state.
    env: {
      PORT: String(port),
      NODE_ENV: 'production',
      FLY_GARDEN_DATA_DIR: process.env.FLY_GARDEN_DATA_DIR
        ?? new URL('./.identities/', import.meta.url).pathname,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
