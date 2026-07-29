import type { CustomPalette } from './types';

/**
 * Curated palette library for the Forge.
 *
 * The Forge used to be five independent RGB sliders. That is a poor instrument
 * for finding a *good* palette: it lets a player set five unrelated colours with
 * no relationship to each other, and the only guard was a 2:1 contrast warning
 * between two of the five. Most reachable states looked nothing like the game.
 *
 * The replacement is "pick a designed base, then rotate its hue". Every result
 * is a rotation of a hand-tuned palette, so the relationships between the five
 * roles — background, idle tile, active, correct, wrong — are preserved by
 * construction. A uniform hue rotation cannot make correct and wrong collide,
 * because it moves both by the same amount; that property is the whole reason
 * rotation is the right control and free RGB is not.
 *
 * NOTE for the economy pass: these bases are free, and the hue slider can reach
 * any hue from any of them, which structurally undercuts the paid shop themes
 * (Ferro/Glacier/Redline). Names here avoid colliding with those, but the real
 * overlap is functional, not nominal — the shop needs to sell something hue
 * rotation cannot produce, or stop selling colour.
 */

export interface CuratedPalette {
  id: string;
  name: string;
  palette: CustomPalette;
}

/**
 * Aesthetic bases. Each keeps `correct` and `wrong` well separated in hue, and
 * each keeps `active` distinct from both so a flashing tile is never mistaken
 * for a scored one. Note Garnet deliberately uses amber for `wrong` — with a
 * red accent, a red failure state would read as "active" at a glance.
 */
export const CURATED_PALETTES: ReadonlyArray<CuratedPalette> = [
  { id: 'mono',     name: 'Mono',     palette: { bg: '#05080D', base: '#1C2733', active: '#00E5FF', correct: '#39FF88', wrong: '#FF3864' } },
  { id: 'ember',    name: 'Ember',    palette: { bg: '#0A0604', base: '#2E1E14', active: '#FF8A3D', correct: '#7FE05A', wrong: '#FF3B5C' } },
  { id: 'viridian', name: 'Viridian', palette: { bg: '#040A08', base: '#14302A', active: '#2EE6A8', correct: '#A8FF60', wrong: '#FF4D6D' } },
  { id: 'amethyst', name: 'Amethyst', palette: { bg: '#08050E', base: '#241A38', active: '#B47CFF', correct: '#5CE1B0', wrong: '#FF5C8A' } },
  { id: 'sodium',   name: 'Sodium',   palette: { bg: '#0A0803', base: '#2E2812', active: '#FFD24A', correct: '#66E0FF', wrong: '#FF6B4A' } },
  { id: 'frost',    name: 'Frost',    palette: { bg: '#060A0F', base: '#1B2A36', active: '#8FD8E8', correct: '#6BE0A8', wrong: '#F0708C' } },
  { id: 'garnet',   name: 'Garnet',   palette: { bg: '#0A0406', base: '#301620', active: '#E0446E', correct: '#4ADE80', wrong: '#FFB020' } },
  { id: 'slate',    name: 'Slate',    palette: { bg: '#07090B', base: '#1E252C', active: '#9FB4C7', correct: '#7FD8A0', wrong: '#E0798C' } },
];

/**
 * Colour-vision palettes. These are NOT in the Forge list — they live in
 * Settings → Accessibility, because burying colour-vision support inside a
 * cosmetic customisation screen puts it where the players who need it are
 * least likely to look.
 *
 * All three replace the red/green success-failure axis, which is the axis every
 * common form of colour-vision deficiency compresses. Deuteranopia and
 * protanopia get blue/orange; tritanopia (blue-yellow) gets red/cyan instead,
 * since blue/orange is precisely what it cannot separate.
 */
export const ACCESSIBLE_PALETTES: ReadonlyArray<CuratedPalette> = [
  { id: 'deuteranopia', name: 'Deuteranopia', palette: { bg: '#05080D', base: '#1A2A38', active: '#FFD60A', correct: '#3FA7FF', wrong: '#FF7800' } },
  { id: 'protanopia',   name: 'Protanopia',   palette: { bg: '#05080D', base: '#1F2D3B', active: '#E8F5FF', correct: '#5BC4FF', wrong: '#FF8C42' } },
  { id: 'tritanopia',   name: 'Tritanopia',   palette: { bg: '#05080D', base: '#2A1F26', active: '#FF4D6D', correct: '#00E0D5', wrong: '#FF9E00' } },
];

export function findCurated(id: string): CuratedPalette | undefined {
  return CURATED_PALETTES.find(p => p.id === id) ?? ACCESSIBLE_PALETTES.find(p => p.id === id);
}

// ── Colour maths ───────────────────────────────────────────────────────────────

interface HSL { h: number; s: number; l: number; }

export function hexToHsl(hex: string): HSL {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

export function hslToHex({ h, s, l }: HSL): string {
  const hue = ((h % 360) + 360) % 360 / 360;

  const hueToRgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }

  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return '#' + [to255(r), to255(g), to255(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Rotates one colour's hue, leaving saturation and lightness untouched. */
export function rotateHex(hex: string, degrees: number): string {
  if (degrees === 0) return hex.toUpperCase();
  const hsl = hexToHsl(hex);
  // A greyscale colour has no hue to rotate; rotating it would introduce a
  // colour cast the base palette deliberately didn't have.
  if (hsl.s === 0) return hex.toUpperCase();
  return hslToHex({ ...hsl, h: hsl.h + degrees });
}

/**
 * Rotates every role in a palette by the same amount. Uniformity is the point:
 * the hue *distances* between active, correct and wrong are what make them
 * telling apart, and rotating them together leaves those distances unchanged.
 */
export function rotatePalette(palette: CustomPalette, degrees: number): CustomPalette {
  return {
    bg:      rotateHex(palette.bg, degrees),
    base:    rotateHex(palette.base, degrees),
    active:  rotateHex(palette.active, degrees),
    correct: rotateHex(palette.correct, degrees),
    wrong:   rotateHex(palette.wrong, degrees),
  };
}

// ── Contrast ───────────────────────────────────────────────────────────────────

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear((n >> 16) & 0xff)
       + 0.7152 * toLinear((n >> 8) & 0xff)
       + 0.0722 * toLinear(n & 0xff);
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Checks the pairs that actually matter for playing the game, not just the one
 * pair the old Forge warned about. Returns a human-readable problem or null.
 *
 * Rotation cannot produce these on a curated base — they exist because the
 * check should still hold if a palette is ever added or edited carelessly.
 */
export function paletteWarning(p: CustomPalette): string | null {
  if (contrastRatio(p.base, p.bg) < 1.6) return 'Tiles are hard to see against the background.';
  if (contrastRatio(p.active, p.bg) < 2.5) return 'Flashing tiles are hard to see.';
  if (contrastRatio(p.correct, p.wrong) < 1.35) return 'Correct and wrong look too similar.';
  return null;
}
