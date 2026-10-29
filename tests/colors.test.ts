import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignColors, colorOf, generatedColor, oklchToHex, PALETTE_SIZE, slotVar } from '../src/app/colors';
import { evaluateProject } from '../src/engine/evaluate';
import type { AxeptioConfig, AxeptioProject } from '../src/engine/types';

const cfg = (identifier: string, fields: Partial<AxeptioConfig> = {}): AxeptioConfig => ({ identifier, name: identifier, steps: [{ name: 'welcome' }], ...fields });

/** "Grayish": the three channels nearly equal. Gray is reserved for "no banner". */
const isGrayish = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 40;
};

describe('banner colors', () => {
  // 30 banners: one per country, plus one first in the list that never wins (no real country).
  const countries = ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'PL', 'SE', 'DK', 'FI', 'IE', 'GR', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'LU', 'MT', 'CY', 'JP', 'BR'];
  const project: AxeptioProject = {
    client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'c0' } },
    cookies: [cfg('dead', { country: 'UK' }), ...countries.map((c, i) => cfg(`c${i}`, { country: c }))],
  };
  const evaluation = evaluateProject(project, { mode: 'actual' });
  const colors = assignColors(project, [evaluation]);

  it('gives every banner its own slot, banners on the map first', () => {
    const slots = [...colors.slotOf.values()];
    expect(new Set(slots).size).toBe(project.cookies!.length);
    expect(colors.slotOf.get('c0')).toBe(0);
    // "dead" comes first in the project but never shows, so it gets the last slot.
    expect(colors.slotOf.get('dead')).toBe(project.cookies!.length - 1);
    expect(new Set(project.cookies!.map((c) => colorOf(colors, c.identifier))).size).toBe(project.cookies!.length);
  });

  it('keeps gray for "no banner" only', () => {
    expect(colorOf(colors, null)).toBe('var(--no-banner)');
    for (const c of project.cookies!) expect(colorOf(colors, c.identifier)).not.toContain('no-banner');
  });

  it('defines 24 distinct, non-gray slots in every theme scope', () => {
    const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const scopes = [...css.matchAll(/--series-1: (#[0-9a-f]{6});[\s\S]*?--series-24: (#[0-9a-f]{6});[^\n]*\n/g)].map((m) =>
      [...m[0].matchAll(/--series-(\d+): (#[0-9a-f]{6})/g)].map((x) => x[2]),
    );
    expect(scopes).toHaveLength(3); // light, dark (media query), dark (data-theme)
    for (const values of scopes) {
      expect(values).toHaveLength(PALETTE_SIZE);
      expect(new Set(values).size).toBe(PALETTE_SIZE);
      expect(values.filter(isGrayish)).toEqual([]);
    }
    expect(css).not.toContain('--series-other');
  });

  it('generates unique, non-gray colors past the palette', () => {
    for (const mode of ['light', 'dark'] as const) {
      const generated = Array.from({ length: 60 }, (_, i) => generatedColor(PALETTE_SIZE + i, mode));
      expect(new Set(generated).size).toBe(60);
      for (const hex of generated) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(isGrayish(hex), hex).toBe(false);
      }
    }
    expect(slotVar(29)).toBe('var(--series-30)');
  });

  it('converts OKLCH like the palette tooling does', () => {
    expect(oklchToHex(0.627955, 0.257683, 29.2339)).toBe('#ff0000');
    expect(oklchToHex(0.5, 0.4, 150)).toBeNull();
  });
});
