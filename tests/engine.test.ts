import { describe, expect, it } from 'vitest';
import { selectConfig, pageMatches, regulationFor, isSingleCountry, matchesSubdivision } from '../src/engine/select';
import type { AxeptioConfig, AxeptioProject, CookiesSettings } from '../src/engine/types';
import mackageJson from './fixtures/mackage.json';
import quilicotJson from './fixtures/quilicot.json';
import axeptioJson from './fixtures/axeptio.json';

const mackage = mackageJson as AxeptioProject;
const quilicot = quilicotJson as AxeptioProject;
const axeptio = axeptioJson as AxeptioProject;

/** Splits "CA-QC" into country and subdivision headers the way CloudFront sends them. */
function visitor(region: string, language?: string) {
  const [countryCode, subdivisionCode] = region.split('-');
  return { countryCode, subdivisionCode: subdivisionCode ?? 'Unknown', browserLanguage: language ?? null };
}

const nameOf = (project: AxeptioProject, region: string, language?: string, preview = false) =>
  selectConfig(project, visitor(region, language), { forceGeolocation: preview }).config?.name;

const stepOf = (project: AxeptioProject, region: string, language?: string, preview = false) =>
  selectConfig(project, visitor(region, language), { forceGeolocation: preview }).step;

describe('SPEC section 8: Mackage (geolocation ON, fallback "EN-US et fallback")', () => {
  const cases: Array<[string, string, string, string]> = [
    // region, language, expected config, expected step
    ['CA-QC', 'fr-CA', 'CA-QC FR', 'subdivision'],
    ['CA-QC', 'de-DE', 'CA-QC EN', 'subdivision'],
    ['CA-ON', 'en-CA', 'CA-QC EN', 'single-country'],
    ['CA-ON', 'fr-CA', 'CA-QC FR', 'single-country'],
    ['US-NY', 'en-US', 'EN-US et fallback', 'multi-country'],
    ['US-NY', 'fr-FR', 'EN-US et fallback', 'multi-country'],
    ['GB-ENG', 'en-GB', 'UK EN', 'single-country'],
    ['GB-ENG', 'fr-FR', 'UK EN', 'single-country'],
    ['FR-IDF', 'fr-FR', 'EU FR', 'multi-country'],
    ['FR-IDF', 'en-US', 'EU EN', 'multi-country'],
    ['FR-IDF', 'de-DE', 'EU EN', 'multi-country'],
    ['CH-GE', 'fr-CH', 'EU FR', 'multi-country'],
    ['CH-ZH', 'de-CH', 'EU EN', 'multi-country'],
    ['IS', 'fr-FR', 'EU FR', 'multi-country'],
    ['JP-13', 'ja-JP', 'EN-US et fallback', 'fallback'],
    ['JP-13', 'en-US', 'EN-US et fallback', 'fallback'],
  ];
  it.each(cases)('%s with %s gets %s (%s)', (region, language, expected, step) => {
    const result = selectConfig(mackage, visitor(region, language));
    expect(result.config?.name).toBe(expected);
    expect(result.step).toBe(step);
  });

  it('flags the fallback and keeps Québec on Loi 25', () => {
    const jp = selectConfig(mackage, visitor('JP', 'ja'));
    expect(jp.isFallback).toBe(true);
    expect(jp.regulation).toBeUndefined();
    const qc = selectConfig(mackage, visitor('CA-QC', 'fr'));
    expect(qc.regulation).toBe('loi25');
    expect(qc.isFallback).toBe(false);
  });

  it('explains the Ontario case: regulation ccpa matches no single-country config, so the language decides', () => {
    const result = selectConfig(mackage, visitor('CA-ON', 'en'));
    expect(result.regulation).toBe('ccpa');
    const single = result.trace.find((t) => t.kind === 'candidates' && t.step === 'single-country');
    expect(single).toMatchObject({
      matched: ['691245e5b48e4a03c7b9c5c8', '6913a57eb48e4a03c7b9c9ed'],
      preferred: ['691245e5b48e4a03c7b9c5c8', '6913a57eb48e4a03c7b9c9ed'],
      regulationApplied: false,
      winner: '691245e5b48e4a03c7b9c5c8',
      tieBreak: { language: 'en', languageMatches: ['691245e5b48e4a03c7b9c5c8'], byOrder: false },
    });
  });

  it('a US visitor with an unknown state still gets the multi-country config', () => {
    expect(nameOf(mackage, 'US', 'en')).toBe('EN-US et fallback');
  });
});

describe('SPEC section 8: Bicycles Quilicot (geolocation OFF)', () => {
  it('today: everyone gets the first config by default on a regular page', () => {
    for (const region of ['CA-QC', 'CA-ON', 'FR', 'US-NY', 'JP']) {
      for (const language of ['fr', 'en', 'de']) {
        const result = selectConfig(quilicot, { ...visitor(region, language), pagePath: '/' });
        expect(result.config?.name).toBe('fr-ca-qc-04-10-2024');
        expect(result.step).toBe('default');
        expect(result.geolocation).toBe(false);
      }
    }
  });

  it('today: the EN config only wins on pages matching its /en.* rule', () => {
    const result = selectConfig(quilicot, { ...visitor('CA-QC', 'fr'), pagePath: '/en/collections/velos' });
    expect(result.config?.name).toBe('en-ca-qc-04-10-2024');
    expect(result.step).toBe('page');
  });

  it('today: cookiesVersion pins a config by name', () => {
    const result = selectConfig(quilicot, { ...visitor('FR', 'fr'), cookiesVersion: 'en-ca-qc-04-10-2024' });
    expect(result.config?.name).toBe('en-ca-qc-04-10-2024');
    expect(result.step).toBe('cookiesVersion');
  });

  it('preview ON: Québec is matched by country, never by the "QC" subdivision', () => {
    expect(nameOf(quilicot, 'CA-QC', 'fr', true)).toBe('fr-ca-qc-04-10-2024');
    expect(nameOf(quilicot, 'CA-QC', 'en', true)).toBe('en-ca-qc-04-10-2024');
    expect(stepOf(quilicot, 'CA-QC', 'fr', true)).toBe('single-country');
    expect(matchesSubdivision('QC', 'CA', 'QC')).toBe(false);
  });

  it('preview ON: the rest of Canada gets the same Québec configs', () => {
    expect(nameOf(quilicot, 'CA-ON', 'en', true)).toBe('en-ca-qc-04-10-2024');
    expect(nameOf(quilicot, 'CA-BC', 'fr', true)).toBe('fr-ca-qc-04-10-2024');
  });

  it('preview ON: outside Canada there is no geo match and no fallback, so the default config loads', () => {
    for (const region of ['FR', 'US-NY', 'JP']) {
      const result = selectConfig(quilicot, { ...visitor(region, 'en'), pagePath: '/' }, { forceGeolocation: true });
      expect(result.config?.name).toBe('fr-ca-qc-04-10-2024');
      expect(result.step).toBe('default');
    }
  });
});

describe("SPEC section 8: Axeptio's own site (geolocation OFF)", () => {
  it('today: the first config loads unless the site pins cookiesVersion', () => {
    expect(nameOf(axeptio, 'FR', 'fr')).toBe('axeptio-prod-en');
    expect(stepOf(axeptio, 'FR', 'fr')).toBe('default');
    const pinned = selectConfig(axeptio, { ...visitor('FR', 'en'), cookiesVersion: 'axeptio-prod-fr' });
    expect(pinned.config?.name).toBe('axeptio-prod-fr');
    expect(pinned.step).toBe('cookiesVersion');
  });

  const preview: Array<[string, string, string]> = [
    ['FR', 'fr', 'axeptio-prod-fr'],
    ['FR', 'en', 'axeptio-prod-en'],
    ['FR', 'de', 'axeptio-prod-en'],
    ['CA-QC', 'fr', 'axeptio-prod-fr-ca'],
    ['CA-ON', 'fr', 'axeptio-prod-fr-ca'],
    ['DE', 'en', 'axeptio-prod-de'],
    ['BE', 'nl', 'axeptio-prod-nl'],
    ['BE', 'ja', 'axeptio-prod-en'],
    ['PT', 'pt', 'axeptio-prod-pt'],
    ['US-CA', 'en', 'axeptio-prod-en'],
  ];
  it.each(preview)('preview ON: %s with %s gets %s', (region, language, expected) => {
    expect(nameOf(axeptio, region, language, true)).toBe(expected);
  });

  it('preview ON: steps match the SDK order', () => {
    expect(stepOf(axeptio, 'CA-QC', 'fr', true)).toBe('subdivision');
    expect(stepOf(axeptio, 'DE', 'en', true)).toBe('single-country');
    expect(stepOf(axeptio, 'BE', 'nl', true)).toBe('regulation');
    expect(stepOf(axeptio, 'US-CA', 'en', true)).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// Synthetic edge cases
// ---------------------------------------------------------------------------

const cfg = (identifier: string, fields: Partial<AxeptioConfig> = {}): AxeptioConfig => ({
  identifier,
  name: identifier,
  steps: [{ name: 'welcome', layout: 'welcome' }],
  ...fields,
});

const project = (cookies: AxeptioConfig[], cookiesSettings: CookiesSettings | null = { geolocation: true }): AxeptioProject => ({
  projectId: 'p',
  client: cookiesSettings ? { cookiesSettings } : {},
  cookies,
});

describe('engine edge cases', () => {
  it('treats string and list fields the same way', () => {
    const asString = project([cfg('a', { country: 'CA', language: 'en' }), cfg('b', { country: 'US', language: 'en' })]);
    const asList = project([cfg('a', { country: ['CA'], language: 'en' }), cfg('b', { country: ['US'], language: 'en' })]);
    for (const p of [asString, asList]) {
      expect(selectConfig(p, visitor('CA-ON', 'en')).config?.identifier).toBe('a');
      expect(selectConfig(p, visitor('US-TX', 'en')).config?.identifier).toBe('b');
    }
  });

  it('counts duplicate countries as one (single-country) and ignores blanks', () => {
    expect(isSingleCountry(['CA', ' ca ', ''])).toBe(true);
    expect(isSingleCountry(['CA', 'US'])).toBe(false);
    expect(isSingleCountry(null)).toBe(false);
    expect(isSingleCountry('')).toBe(false);
  });

  it('matches subdivisions case- and space-insensitively, only in COUNTRY-SUB form', () => {
    expect(matchesSubdivision([' ca-qc '], 'CA', 'QC')).toBe(true);
    expect(matchesSubdivision('CA-QC', 'ca', 'qc')).toBe(true);
    expect(matchesSubdivision('QC', 'CA', 'QC')).toBe(false);
    expect(matchesSubdivision('CA-QC', 'CA', 'Unknown')).toBe(false);
  });

  it('an unknown country gets no geo match and drops to the fallback', () => {
    const p = project([cfg('a', { country: 'FR', regulation: 'gpdr' }), cfg('fb', { country: 'US' })], {
      geolocation: true,
      geolocationFallbackConfigId: 'fb',
    });
    const result = selectConfig(p, { countryCode: 'Unknown', subdivisionCode: 'Unknown', browserLanguage: 'fr' });
    expect(result.config?.identifier).toBe('fb');
    expect(result.step).toBe('fallback');
    expect(result.regulation).toBeUndefined();
  });

  it('applies the banner visibility gate before anything else', () => {
    const cookies = [cfg('a', { country: 'FR' })];
    const gate = (allowedCountries: string[] | null, country: string) =>
      selectConfig(project(cookies, { geolocation: true, isBannerVisibilityEnabled: true, allowedCountries }), {
        countryCode: country,
        subdivisionCode: 'Unknown',
      });
    expect(gate([], 'FR').step).toBe('visibility');
    expect(gate([], 'FR').config).toBeNull();
    expect(gate(null, 'FR').step).toBe('visibility');
    expect(gate(['fr'], 'FR').config?.identifier).toBe('a');
    expect(gate(['FR'], 'DE').step).toBe('visibility');
    expect(gate(['FR'], 'Unknown').step).toBe('visibility');
    // Disabled gate: no effect
    const open = selectConfig(project(cookies, { geolocation: true, isBannerVisibilityEnabled: false, allowedCountries: [] }), {
      countryCode: 'FR',
    });
    expect(open.config?.identifier).toBe('a');
  });

  it('without a fallback, unmatched regions get the first config with steps', () => {
    const p = project([cfg('empty', { steps: [] }), cfg('a', { country: 'FR' }), cfg('b', { country: 'DE' })]);
    const result = selectConfig(p, visitor('JP', 'ja'));
    expect(result.config?.identifier).toBe('a');
    expect(result.step).toBe('default');
    expect(result.explicitlyRouted).toBe(false);
  });

  it('ignores a fallback id that points to a missing config', () => {
    const p = project([cfg('a', { country: 'FR' })], { geolocation: true, geolocationFallbackConfigId: 'gone' });
    const result = selectConfig(p, visitor('JP'));
    expect(result.step).toBe('default');
    expect(result.trace).toContainEqual({ kind: 'fallback', configId: 'gone', found: false });
  });

  it('ignores cookiesVersion when geolocation finds a match, uses it otherwise', () => {
    const p = project([cfg('fr', { country: 'FR' }), cfg('other', { country: 'DE' })]);
    expect(selectConfig(p, { ...visitor('FR'), cookiesVersion: 'other' }).config?.identifier).toBe('fr');
    expect(selectConfig(p, { ...visitor('JP'), cookiesVersion: 'other' }).config?.identifier).toBe('other');
    expect(selectConfig(p, { ...visitor('JP'), cookiesVersion: 'other' }).step).toBe('cookiesVersion');
    expect(selectConfig(p, { ...visitor('JP'), cookiesVersion: 'missing' }).step).toBe('default');
  });

  it('prefers the regulation of the visitor region when several configs match', () => {
    const p = project([
      cfg('ccpa', { country: 'CA', regulation: 'ccpa', language: 'en' }),
      cfg('loi25', { country: 'CA', regulation: 'loi25', language: 'en' }),
    ]);
    expect(selectConfig(p, visitor('CA-QC', 'en')).config?.identifier).toBe('loi25');
    expect(selectConfig(p, visitor('CA-ON', 'en')).config?.identifier).toBe('ccpa');
  });

  it('compares regulations case-insensitively', () => {
    const p = project([cfg('a', { country: 'DE', regulation: 'GPDR' })]);
    expect(selectConfig(p, visitor('BE', 'fr')).config?.identifier).toBe('a');
    expect(selectConfig(p, visitor('BE', 'fr')).step).toBe('regulation');
  });

  it('tie-breaks on the html lang when useDocumentLang is on', () => {
    const p = project([cfg('en', { country: 'CA', language: 'en' }), cfg('fr', { country: 'CA', language: 'fr' })]);
    const base = { ...visitor('CA-ON'), browserLanguage: 'en-CA', documentLanguage: 'fr' };
    expect(selectConfig(p, base).config?.identifier).toBe('en');
    expect(selectConfig(p, { ...base, useDocumentLang: true }).config?.identifier).toBe('fr');
    expect(selectConfig(p, { ...base, useDocumentLang: true, documentLanguage: '' }).config?.identifier).toBe('en');
  });

  it('falls back to array order when no language matches', () => {
    const p = project([cfg('second', { country: 'CA', language: 'fr' }), cfg('first', { country: 'CA', language: 'en' })]);
    const result = selectConfig(p, visitor('CA-ON', 'de'));
    expect(result.config?.identifier).toBe('second');
    const entry = result.trace.find((t) => t.kind === 'candidates' && t.winner);
    expect(entry).toMatchObject({ tieBreak: { language: 'de', languageMatches: [], byOrder: true } });
  });

  it('stops before the regulation step when the region has no regulation', () => {
    const p = project([cfg('a', { country: 'FR', regulation: 'gpdr' }), cfg('b', { country: 'US', regulation: 'ccpa' })]);
    const result = selectConfig(p, visitor('JP', 'en'));
    expect(result.trace).toContainEqual({ kind: 'stop', reason: 'no-regulation' });
    expect(result.step).toBe('default');
  });

  it('matches regulations through the SDK table', () => {
    expect(regulationFor('CA', 'QC')).toBe('loi25');
    expect(regulationFor('CA', 'ON')).toBe('ccpa');
    expect(regulationFor('US', 'NY')).toBe('gpp');
    expect(regulationFor('US', 'TX')).toBe('ccpa');
    expect(regulationFor('NO', 'Unknown')).toBe('gpdr');
    expect(regulationFor('IS', undefined)).toBeUndefined();
    expect(regulationFor('fr', undefined)).toBeUndefined(); // the SDK requires uppercase here
    expect(regulationFor('UNKNOWN', 'UNKNOWN')).toBeUndefined();
  });
});

describe('page rules (SDK pageMatch)', () => {
  it('matches plain URLs anywhere in the path, with an optional trailing slash', () => {
    expect(pageMatches({ url: '/fr' }, '/fr')).toBe(true);
    expect(pageMatches({ url: '/fr' }, '/fr/')).toBe(true);
    expect(pageMatches({ url: '/fr' }, '/shop/fr/items')).toBe(true);
    expect(pageMatches({ url: '/fr' }, '/en')).toBe(false);
    expect(pageMatches({ url: '/a.b' }, '/aXb')).toBe(false);
  });

  it('supports regex rules and reports invalid ones', () => {
    expect(pageMatches({ url: '^/en(/|$)', regex: true }, '/en/x')).toBe(true);
    expect(pageMatches({ url: '^/en(/|$)', regex: true }, '/fr/en')).toBe(false);
    expect(pageMatches({ url: '(', regex: true }, '/')).toBeNull();
  });

  it('reports rules the SDK would throw on instead of crashing, and treats them as no match', () => {
    expect(pageMatches(null as never, '/')).toBeNull();
    expect(pageMatches({ url: 42 as never }, '/42')).toBeNull();
    // new RegExp(42) is fine in the SDK too
    expect(pageMatches({ url: 42 as never, regex: true }, '/42')).toBe(true);
    const p = project([cfg('broken', { settings: { pages: [null as never] } }), cfg('any')], null);
    expect(selectConfig(p, { countryCode: 'FR', pagePath: '/' }).config?.identifier).toBe('any');
  });

  it('only page-matched configs win over the default, and unmatched ones are excluded', () => {
    const p = project(
      [cfg('fr-only', { settings: { pages: [{ url: '/fr' }] } }), cfg('any'), cfg('en-only', { settings: { pages: [{ url: '/en' }] } })],
      null,
    );
    expect(selectConfig(p, { countryCode: 'FR', pagePath: '/en/page' }).config?.identifier).toBe('en-only');
    expect(selectConfig(p, { countryCode: 'FR', pagePath: '/en/page' }).step).toBe('page');
    expect(selectConfig(p, { countryCode: 'FR', pagePath: '/de' }).config?.identifier).toBe('any');
  });
});

describe('A/B tests (SDK resolveABTestFor)', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z');
  const window = { startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-30T00:00:00Z' };

  it('reports a running test that includes the selected config', () => {
    const p: AxeptioProject = {
      ...project([cfg('a', { country: 'FR' }), cfg('b', { country: 'FR' })]),
      abTests: [{ testId: 't1', variants: [{ configId: 'a' }, { configId: 'b' }], ...window }],
    };
    const result = selectConfig(p, { ...visitor('FR', 'fr'), now: NOW });
    expect(result.abTest).toEqual({ testId: 't1', variants: ['a', 'b'] });
  });

  it('ignores tests outside their date window or not targeting the visitor', () => {
    const p: AxeptioProject = {
      ...project([cfg('a', { country: 'FR' }), cfg('b', { country: 'FR' })]),
      abTests: [
        { testId: 'past', variants: [{ configId: 'a' }, { configId: 'b' }], startDate: '2025-01-01', endDate: '2025-02-01' },
        { testId: 'de-only', variants: [{ configId: 'a' }, { configId: 'b' }], country: 'DE', ...window },
      ],
    };
    expect(selectConfig(p, { ...visitor('FR', 'fr'), now: NOW }).abTest).toBeNull();
  });

  it('lets a targeted test take over a default (non-routed) selection', () => {
    const p: AxeptioProject = {
      projectId: 'p',
      cookies: [cfg('a'), cfg('x'), cfg('y')],
      abTests: [{ testId: 'fr-test', variants: [{ configId: 'x' }, { configId: 'y' }], country: 'FR', ...window }],
    };
    expect(selectConfig(p, { ...visitor('FR', 'fr'), now: NOW }).abTest?.testId).toBe('fr-test');
    expect(selectConfig(p, { ...visitor('DE', 'fr'), now: NOW }).abTest).toBeNull();
    // Explicit routing (cookiesVersion) only keeps tests that include the selected config
    expect(selectConfig(p, { ...visitor('FR', 'fr'), cookiesVersion: 'a', now: NOW }).abTest).toBeNull();
  });
});
