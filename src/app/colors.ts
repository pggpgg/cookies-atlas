/**
 * Banner colors. Every banner gets its own color, kept whatever the filters, and gray means
 * "no banner" and nothing else.
 *
 * Slots 1-8 are the validated data-viz palette, in its CVD-safe order. Slots 9-24 extend it
 * with hues picked for the map, where each banner shows both solid (targeted) and faded
 * (reached indirectly): every pair stays apart solid/solid, faded/faded and solid/faded in
 * both themes, as far as 24 colors allow (worst pair in the first 16 is the base palette's
 * own orange/red). Both sets live in styles.css. Past 24, colors are generated here and
 * injected as CSS variables: still unique, but closer together.
 *
 * Banners that win somewhere get the first slots, in project order; banners that never show
 * come after, so the map always uses the most distinct colors.
 */
import type { Evaluation } from '../engine/evaluate';
import type { AxeptioProject } from '../engine/types';

/** Slots defined in styles.css. */
export const PALETTE_SIZE = 24;

/** CSS variable holding a slot's color. */
export const slotVar = (slot: number) => `var(--series-${slot + 1})`;

export interface ColorAssignment {
  slotOf: Map<string, number>;
}

export function assignColors(project: AxeptioProject, evaluations: Evaluation[]): ColorAssignment {
  const ids = (project.cookies ?? []).map((c) => c.identifier);
  const shows = (id: string) => evaluations.some((e) => (e.wins.get(id)?.size ?? 0) > 0);
  const ordered = [...ids.filter(shows), ...ids.filter((id) => !shows(id))];
  const slotOf = new Map<string, number>();
  for (const id of ordered) if (!slotOf.has(id)) slotOf.set(id, slotOf.size);
  ensureGeneratedSlots(slotOf.size);
  return { slotOf };
}

export const colorOf = (assignment: ColorAssignment, id: string | null | undefined): string => {
  if (!id) return 'var(--no-banner)';
  const slot = assignment.slotOf.get(id);
  // A banner the assignment doesn't know (shouldn't happen) still never borrows the "no banner" gray.
  return slot === undefined ? 'var(--text-secondary)' : slotVar(slot);
};

// --- Colors past the palette -----------------------------------------------------------------

type Mode = 'light' | 'dark';

const toHex = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLCH to hex, or null when the color is outside sRGB. */
export function oklchToHex(L: number, C: number, hDeg: number): string | null {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (rgb.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return '#' + rgb.map((v) => toHex(toSrgb(v))).join('');
}

/**
 * Color for a slot past the palette: hues a golden angle apart, three lightness steps,
 * chroma lowered until it fits sRGB. Dark mode keeps the hue, in the dark theme's lightness band.
 */
export function generatedColor(slot: number, mode: Mode): string {
  const k = slot - PALETTE_SIZE;
  const hue = (k * 137.508 + 25) % 360;
  const L = [0.62, 0.5, 0.72][k % 3];
  const preferred = mode === 'dark' ? Math.min(0.72, Math.max(0.55, L)) : L;
  // Some hues can't reach a clear chroma at every lightness (yellows when dark, blues when
  // light): try the preferred lightness first, then move toward the middle.
  for (const lightness of [preferred, 0.62, 0.68, 0.56, 0.74, 0.5]) {
    for (let C = 0.16; C >= 0.1 - 1e-9; C -= 0.01) {
      const hex = oklchToHex(lightness, C, hue);
      if (hex) return hex;
    }
  }
  return oklchToHex(0.62, 0.08, hue) ?? '#5b8def';
}

const STYLE_ID = 'cookies-atlas-generated-series';

/** Declares --series-25 and up when a project needs them (same theme scopes as styles.css). */
function ensureGeneratedSlots(count: number) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ID);
  if (count <= PALETTE_SIZE) {
    existing?.remove();
    return;
  }
  const vars = (mode: Mode) =>
    Array.from({ length: count - PALETTE_SIZE }, (_, i) => `--series-${PALETTE_SIZE + i + 1}:${generatedColor(PALETTE_SIZE + i, mode)}`).join(';');
  const css =
    `:root{${vars('light')}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${vars('dark')}}}` +
    `:root[data-theme='dark']{${vars('dark')}}`;
  const style = existing ?? Object.assign(document.createElement('style'), { id: STYLE_ID });
  if (style.textContent !== css) style.textContent = css;
  if (!existing) document.head.appendChild(style);
}
