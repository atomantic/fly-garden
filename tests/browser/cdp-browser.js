import { test as base, expect, chromium } from '@playwright/test';

/**
 * Optional real-graphics-device mode for the browser suite.
 *
 * Unset, this module re-exports Playwright's ordinary `test`, and the suite launches the pinned
 * Chrome Headless Shell exactly as before. Setting `FLY_GARDEN_CDP_ENDPOINT` to the DevTools
 * Protocol endpoint of an already running browser makes the same specs run there instead, so the
 * recorded figures come from a real GPU rasterizer rather than a headless software one. CI has no
 * GPU and never sets the variable.
 *
 * Safety contract for the attached browser, which is a person's own live Chrome: this fixture only
 * creates its own isolated browser context and its own pages, and closes exactly those. It never
 * enumerates, reads, navigates or closes a pre-existing page, and it never calls `browser.close()`,
 * which could terminate someone's browser session. The suite still only ever navigates to loopback.
 */
export const cdpEndpoint = process.env.FLY_GARDEN_CDP_ENDPOINT ?? '';

export const test = cdpEndpoint
  ? base.extend({
      browser: [async ({}, use) => {
        const browser = await chromium.connectOverCDP(cdpEndpoint);
        await use(browser);
        // Deliberately no browser.close(): this connection is somebody's running browser.
      }, { scope: 'worker', timeout: 60_000 }],
      context: async ({ browser, contextOptions }, use) => {
        const context = await browser.newContext(contextOptions);
        await use(context);
        for (const page of context.pages()) await page.close().catch(() => {});
        await context.close();
      },
    })
  : base;

/** One line naming the browser and renderer behind every figure a spec prints. */
export async function describeRuntime(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      renderer: gl ? (debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL context',
      glVersion: gl ? gl.getParameter(gl.VERSION) : 'none',
    };
  });
}

export { expect };
