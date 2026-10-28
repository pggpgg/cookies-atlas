import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/engine/diagnostics';
import { evaluateProject } from '../src/engine/evaluate';
import type { AxeptioConfig, AxeptioProject } from '../src/engine/types';
import { buildCopyContext, MESSAGES, type PlaceNames, type UiLanguage } from '../src/i18n';
import mackageJson from './fixtures/mackage.json';
import quilicotJson from './fixtures/quilicot.json';
import axeptioJson from './fixtures/axeptio.json';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const REGION_NAMES: Record<string, { en: string; fr: string }> = {
  'CA-QC': { en: 'Quebec', fr: 'Québec' },
  'CA-ON': { en: 'Ontario', fr: 'Ontario' },
  'US-CA': { en: 'California', fr: 'Californie' },
  'FR-IDF': { en: 'Île-de-France', fr: 'Île-de-France' },
  'FR-75': { en: 'Paris', fr: 'Paris' },
};
const names: PlaceNames = {
  country: () => undefined, // Intl.DisplayNames
  region: (cc, code, ui) => REGION_NAMES[`${cc}-${code}`]?.[ui],
  isSplit: (cc) => ['CA', 'US', 'FR'].includes(cc),
};

const cfg = (identifier: string, fields: Partial<AxeptioConfig> = {}): AxeptioConfig => ({
  identifier,
  name: identifier,
  steps: [{ name: 'welcome' }],
  ...fields,
});
const synthetic: AxeptioProject = {
  projectName: 'synthetic',
  client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'world' } },
  cookies: [
    cfg('paris', { subdivision: ['FR-75'], language: 'fr' }),
    cfg('california', { country: ['US'], subdivision: ['US-CA'], regulation: 'ccpa', language: 'en' }),
    cfg('pr', { country: ['US', 'NL'], subdivision: ['US-PR', 'US-NY'], regulation: 'ccpa', language: 'en' }),
    cfg('eu', { country: ['FR', 'DE', 'GB', 'NL'], regulation: 'gpdr', language: 'en' }),
    cfg('gb', { country: 'GB', regulation: 'uk_gdpr', language: 'en' }),
    cfg('typo', { country: ['UK'], subdivision: '75', regulation: 'gdpr', settings: { pages: [null as never, { url: '(', regex: true }] } }),
    cfg('world', { language: 'en' }),
  ],
};
// One banner for two regions, and one for many: the copy has to agree in number.
const regions: AxeptioProject = {
  client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'world' } },
  cookies: [
    cfg('two', { country: ['CA'], subdivision: ['CA-QC', 'CA-ON'], regulation: 'loi25', language: 'fr' }),
    cfg('many', { country: ['US', 'GB'], subdivision: ['US-CA', 'US-NY', 'US-TX', 'US-FL'], regulation: 'ccpa', language: 'en' }),
    cfg('world', { language: 'en' }),
  ],
};

const projects: Array<[string, AxeptioProject]> = [
  ['mackage', mackageJson as AxeptioProject],
  ['quilicot', quilicotJson as AxeptioProject],
  ['axeptio', axeptioJson as AxeptioProject],
  ['synthetic', synthetic],
  ['regions', regions],
];

describe.each(['en', 'fr'] as UiLanguage[])('finding copy (%s)', (ui) => {
  it.each(projects)('reads cleanly for %s', (_, project) => {
    const mode = project.client?.cookiesSettings?.geolocation ? 'actual' : 'preview';
    const findings = diagnose(project, evaluateProject(project, { mode, visitor: { now: NOW } }), NOW);
    expect(findings.length).toBeGreaterThan(0);
    const c = buildCopyContext(ui, project, names);
    for (const f of findings) {
      const copy = MESSAGES[ui].diagnostics.finding(f, c);
      for (const text of [copy.title, copy.mechanism, copy.fix ?? '']) {
        expect(text, `${f.id}: ${text}`).not.toMatch(/undefined|NaN|\[object|null|\s{2,}|\bthe the\b|^\s|\s$/);
        // French puts a space before : and ; but never before , or .
        expect(text, `${f.id}: ${text}`).not.toMatch(ui === 'fr' ? /\s[,.]/ : /\s[,.:;]/);
      }
      expect(copy.title.length, f.id).toBeGreaterThan(5);
      expect(copy.mechanism.length, f.id).toBeGreaterThan(10);
    }
  });
});

describe('over-capture copy', () => {
  const findings = diagnose(regions, evaluateProject(regions, { mode: 'actual', visitor: { now: NOW } }), NOW).filter((f) => f.kind === 'over-capture');
  const text = (ui: UiLanguage) => findings.map((f) => MESSAGES[ui].diagnostics.finding(f, buildCopyContext(ui, regions, names)));
  it('agrees in number in French', () => {
    const [two, many] = text('fr');
    expect(two.fix).toContain('Les régions Ontario (Canada) et Québec (Canada) gardent leur bandeau');
    expect(many.mechanism).toContain('Il cible 4 régions (États-Unis)');
    expect(many.fix).toContain('Ces 4 régions gardent leur bandeau');
  });
  it('counts long region lists in English', () => {
    const [, many] = text('en');
    expect(many.mechanism).toContain('It targets 4 regions of the United States');
    expect(many.fix).toContain('these 4 regions keep their banner');
  });
});

describe('English place names in sentences', () => {
  const c = buildCopyContext('en', synthetic, names);
  it('adds "the" where English needs it, only in running text', () => {
    expect(c.countryIn('US')).toBe('the United States');
    expect(c.countryIn('NL')).toBe('the Netherlands');
    expect(c.countryIn('FR')).toBe('France');
    expect(c.country('US')).toBe('United States');
    expect(c.placeIn('US')).toBe('the United States (other regions)');
    expect(c.placesIn(['GB', 'BR'])).toBe('the United Kingdom and Brazil');
    expect(c.placeIn('US-CA')).toBe('California (United States)');
    expect(MESSAGES.en.article('The Bahamas')).toBe('the Bahamas');
    expect(MESSAGES.en.article('Vatican City')).toBe('Vatican City');
    expect(MESSAGES.en.article('Caribbean Netherlands')).toBe('the Caribbean Netherlands');
  });
});
