import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NON_TEXT_CONTRAST_MINIMUM,
  TEXT_CONTRAST_MINIMUM,
  composite,
  contrastRatio,
  declaredValue,
  hexIn,
  parseColor,
  parseCssRules,
  relativeLuminance,
  reportRatio,
} from '../client/src/contrast.js';

const css = readFileSync(new URL('../client/src/style.css', import.meta.url), 'utf8');
const accessibilityCss = readFileSync(new URL('../client/src/observatory-accessibility.css', import.meta.url), 'utf8');
const rules = parseCssRules(css);
const token = (selector, property) => {
  const value = declaredValue(rules, selector, property);
  assert.ok(value, `style.css must still declare ${property} for ${selector}`);
  const colour = hexIn(value);
  assert.ok(colour, `${property} for ${selector} must contain a hex token, got ${value}`);
  return colour;
};

// Opaque surfaces the observatory paints text and controls onto.
const PAGE = token(':root', 'background');
const SIDEBAR = token('.sidebar', 'background');
const CARD = token('.card', 'background');
const COMPOUND = token('.compound', 'background');
const HEADER = token('th', 'background');
const SCENE = '#112423'; // renderer clear colour for the habitat views in Scene.jsx / SharedScene.jsx
const FOOTER = composite(token('.scene-footer', 'background'), SCENE);

test('WCAG relative luminance and contrast arithmetic matches the published reference values', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(reportRatio(contrastRatio('#ffffff', '#000000')), 21);
  assert.equal(reportRatio(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(reportRatio(contrastRatio('#777777', '#ffffff')), 4.47); // documented WCAG borderline grey
  assert.deepEqual(parseColor('#abc'), { r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  assert.equal(parseColor('#0c1a16d9').a, 0xd9 / 255);
  assert.equal(parseColor('rgb(1,2,3)'), null);
  assert.equal(contrastRatio('#ffffff', '#0c1a16d9'), null); // a translucent backdrop is not a measurement
  // An alpha layer is composited before measurement, never ignored.
  assert.deepEqual(composite('#ffffff00', '#0b1413'), { r: 0x0b, g: 0x14, b: 0x13, a: 1 });
});

/** Every pairing below is read live from style.css, so a palette edit that regresses contrast fails here. */
const textPairs = [
  ['body text', token(':root', 'color'), PAGE],
  ['muted body copy', token('.muted', 'color'), CARD],
  ['content panel paragraphs', token('.content-panel p', 'color'), CARD],
  ['section eyebrow', token('.eyebrow', 'color'), CARD],
  ['navigation link', token('nav a', 'color'), SIDEBAR],
  ['active navigation link', token('nav a.active', 'color'), token('nav a.active', 'background')],
  ['navigation group label', token('.nav-label', 'color'), SIDEBAR],
  ['navigation index', token('.nav-index', 'color'), SIDEBAR],
  ['brand subtitle', token('.brand small', 'color'), SIDEBAR],
  ['sidebar footer', token('.sidebar-bottom', 'color'), SIDEBAR],
  ['sidebar footer paragraph', token('.sidebar-bottom p', 'color'), SIDEBAR],
  ['ethos quotation', token('.ethos', 'color'), SIDEBAR],
  ['status pill', token('.pill', 'color'), PAGE],
  ['preview notice', token('.notice', 'color'), PAGE],
  ['preview notice detail', token('.notice > span:last-child', 'color'), PAGE],
  ['individual subtitle', token('.identity small', 'color'), PAGE],
  ['card heading detail', token('.card-heading > span:last-child', 'color'), CARD],
  ['graph legend', token('.legend', 'color'), CARD],
  ['graph legend firing', token('.legend span:last-child', 'color'), CARD],
  ['statistic value', token('.stats strong', 'color'), CARD],
  ['statistic label', token('.stats span', 'color'), CARD],
  ['chart scale', token('.chart-scale', 'color'), CARD],
  ['journal timestamp', token('.events time', 'color'), CARD],
  ['journal entry', token('.events span', 'color'), CARD],
  ['page footer', token('footer', 'color'), PAGE],
  ['error alert text', token('.error', 'color'), token('.error', 'background')],
  ['empty state', token('.empty-state', 'color'), CARD],
  ['empty state detail', token('.empty-state small', 'color'), CARD],
  ['language label', token('.language label', 'color'), CARD],
  ['language path emphasis', token('.language-path b', 'color'), CARD],
  ['travel step', token('.travel-path span', 'color'), CARD],
  ['current travel step', token('.travel-path .current', 'color'), CARD],
  ['table header', token('th', 'color'), HEADER],
  ['adjacency row', token('.edge-row', 'color'), CARD],
  ['compound status', token('.compound small', 'color'), COMPOUND],
  ['button label', token('button', 'color'), token('button', 'background')],
  ['hovered button label', token('button', 'color'), token('button:hover:not(:disabled)', 'background')],
  ['primary button label', token('.primary', 'color'), token('.primary', 'background')],
  ['pressed table button label', token('td button[aria-pressed="true"]', 'color'), token('td button[aria-pressed="true"]', 'background')],
  ['text input value', token('input', 'color'), token('input', 'background')],
  ['WebGL fallback message', token('.scene-fallback', 'color'), SCENE],
  ['habitat caption', token('.habitat-label', 'color'), SCENE],
  ['habitat caption detail', token('.habitat-label small', 'color'), SCENE],
  ['teleport pod label', token('.pod-label', 'color'), SCENE],
  ['teleport pod detail', token('.pod-label span', 'color'), SCENE],
  ['habitat footer hint', token('.scene-footer', 'color'), FOOTER],
  // Teleport-pod phase tones. The phase is also stated in the label text, so colour is never the
  // only carrier, but each tone must still be readable over the canvas and over the away-state card.
  ['pod tone idle over the habitat', token('.pod-label.pod-idle', 'color'), SCENE],
  ['pod tone idle over the away card', token('.pod-label.pod-idle', 'color'), CARD],
  ['pod tone pending over the habitat', token('.pod-label.pod-pending', 'color'), SCENE],
  ['pod tone active over the habitat', token('.pod-label.pod-active', 'color'), SCENE],
  ['pod tone fault over the habitat', token('.pod-label.pod-fault', 'color'), SCENE],
  ['pod tone fault over the away card', token('.pod-label.pod-fault', 'color'), CARD],
];

test('every observatory text token reaches the WCAG 1.4.3 minimum against its own surface', () => {
  const failures = [];
  for (const [label, foreground, backdrop] of textPairs) {
    const ratio = contrastRatio(foreground, backdrop);
    assert.ok(ratio, `${label}: unmeasurable pair ${foreground} on ${JSON.stringify(backdrop)}`);
    if (ratio < TEXT_CONTRAST_MINIMUM) failures.push(`${label}: ${foreground} = ${reportRatio(ratio)}:1`);
  }
  assert.deepEqual(failures, []);
});

/**
 * WCAG 1.4.11 covers the visual information needed to identify a control and its state.
 * Purely decorative separators (card outlines, table rules, panel dividers) are out of that scope
 * and are deliberately not asserted here; their measured ratios are recorded in
 * docs/OBSERVATORY_ACCESSIBILITY.md as a known, documented limitation rather than hidden.
 */
const nonTextPairs = [
  ['running status dot on the page', token('.status-dot', 'background'), PAGE],
  ['running status dot in the sidebar', token('.status-dot', 'background'), SIDEBAR],
  ['button boundary on the page', token('button', 'border'), PAGE],
  ['button boundary on a card', token('button', 'border'), CARD],
  ['button boundary on a compound tile', token('button', 'border'), COMPOUND],
  ['button boundary on a table header', token('button', 'border'), HEADER],
  ['text input boundary on a card', token('input', 'border'), CARD],
  ['text input boundary on the page', token('input', 'border'), PAGE],
  ['language select and textarea boundary', token('.language select', 'border'), CARD],
  ['pressed table button against its unpressed state', token('td button[aria-pressed="true"]', 'background'), token('button', 'background')],
  ['pressed table button against the card', token('td button[aria-pressed="true"]', 'background'), CARD],
  ['current travel step marker', token('.travel-path .current', 'border-color'), CARD],
  ['error alert boundary', token('.error', 'border'), token('.error', 'background')],
];

test('status indicators and control boundaries reach the WCAG 1.4.11 non-text minimum', () => {
  const failures = [];
  for (const [label, foreground, backdrop] of nonTextPairs) {
    const ratio = contrastRatio(foreground, backdrop);
    assert.ok(ratio, `${label}: unmeasurable pair ${foreground} on ${JSON.stringify(backdrop)}`);
    if (ratio < NON_TEXT_CONTRAST_MINIMUM) failures.push(`${label}: ${foreground} = ${reportRatio(ratio)}:1`);
  }
  assert.deepEqual(failures, []);
});

test('the keyboard focus indicator clears the non-text minimum on every surface it can land on', () => {
  const outline = hexIn(declaredValue(parseCssRules(accessibilityCss), '.observatory-accessible :focus-visible', 'outline'));
  assert.ok(outline, 'observatory-accessibility.css must declare a hex focus outline colour');
  for (const surface of [PAGE, SIDEBAR, CARD, COMPOUND, HEADER, SCENE]) {
    const ratio = contrastRatio(outline, surface);
    assert.ok(ratio >= NON_TEXT_CONTRAST_MINIMUM, `focus outline ${outline} on ${surface} is only ${reportRatio(ratio)}:1`);
  }
});

test('the reduced-motion and forced-colors scope is applied at the observatory root, not only the atlas', () => {
  const main = readFileSync(new URL('../client/src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /import "\.\/observatory-accessibility\.css";/);
  assert.match(main, /className="app observatory-accessible"/);
  assert.match(accessibilityCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(accessibilityCss, /@media \(forced-colors: active\)/);
});
