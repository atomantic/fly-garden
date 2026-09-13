/** WCAG 2.2 relative luminance and contrast ratios for the observatory palette.
 * Pure arithmetic and CSS text parsing: no DOM, runtime, neural or network authority.
 * A passing ratio is a measured colour property, not an accessibility certification. */

/** Minimum ratios from WCAG 2.2 SC 1.4.3 (text) and 1.4.11 (non-text contrast). */
export const TEXT_CONTRAST_MINIMUM = 4.5;
export const NON_TEXT_CONTRAST_MINIMUM = 3;

const HEX = /^#([0-9a-f]{3,8})$/i;

/** Accepts #rgb, #rgba, #rrggbb and #rrggbbaa. Returns { r, g, b, a } with 0-255 channels and 0-1 alpha. */
export function parseColor(value) {
  const match = HEX.exec(String(value ?? '').trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(character => character + character).join('');
  if (hex.length !== 6 && hex.length !== 8) return null;
  const channel = index => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return { r: channel(0), g: channel(1), b: channel(2), a: hex.length === 8 ? channel(3) / 255 : 1 };
}

/** Source-over composite of a translucent colour onto an opaque backdrop. */
export function composite(foreground, backdrop) {
  const top = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  const bottom = typeof backdrop === 'string' ? parseColor(backdrop) : backdrop;
  if (!top || !bottom) return null;
  const alpha = top.a;
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  };
}

/** WCAG relative luminance of an opaque sRGB colour. */
export function relativeLuminance(value) {
  const colour = typeof value === 'string' ? parseColor(value) : value;
  if (!colour) return null;
  const linear = channel => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/** Contrast ratio between a foreground and an opaque backdrop; a translucent foreground is composited first. */
export function contrastRatio(foreground, backdrop) {
  const bottom = typeof backdrop === 'string' ? parseColor(backdrop) : backdrop;
  const top = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  if (!top || !bottom || bottom.a !== 1) return null;
  const front = top.a === 1 ? top : composite(top, bottom);
  const a = relativeLuminance(front), b = relativeLuminance(bottom);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Rounds down to two decimals so a reported ratio never overstates the measurement. */
export function reportRatio(ratio) {
  return Math.floor(ratio * 100) / 100;
}

/**
 * Minimal CSS rule reader for a stylesheet with no nested at-rule blocks other than plain
 * `@media` wrappers. Returns rules in source order as { selectors, declarations }.
 * This is a test/evidence reader, not a general CSS parser.
 */
export function parseCssRules(css) {
  const text = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(text))) {
    const prelude = match[1].split('}').pop().trim();
    if (!prelude || prelude.startsWith('@')) continue;
    const declarations = {};
    for (const part of match[2].split(';')) {
      const index = part.indexOf(':');
      if (index < 0) continue;
      declarations[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    rules.push({ selectors: prelude.split(',').map(one => one.trim()).filter(Boolean), declarations });
  }
  return rules;
}

/** Last declared value of `property` for an exact selector, as authors read the cascade in one file. */
export function declaredValue(rules, selector, property) {
  let value = null;
  for (const rule of rules) if (rule.selectors.includes(selector) && rule.declarations[property] !== undefined) value = rule.declarations[property];
  return value;
}

/** First hex colour inside a shorthand value such as `1px solid #3d5044`. */
export function hexIn(value) {
  const match = /#[0-9a-f]{3,8}\b/i.exec(String(value ?? ''));
  return match ? match[0] : null;
}
