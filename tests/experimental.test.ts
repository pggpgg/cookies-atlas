import { describe, expect, it } from 'vitest';
import { compareEvaluations, evaluateProject } from '../src/engine/evaluate';
import { selectConfig, type TraceEntry } from '../src/engine/select';
import type { AxeptioConfig, AxeptioProject } from '../src/engine/types';
import mackageJson from './fixtures/mackage.json';

const mackage = mackageJson as AxeptioProject;

function visitor(region: string, language?: string) {
  const [countryCode, subdivisionCode] = region.split('-');
  return { countryCode, subdivisionCode: subdivisionCode ?? 'Unknown', browserLanguage: language ?? null };
}

const run = (project: AxeptioProject, region: string, language?: string) =>
  selectConfig(project, visitor(region, language), { experimental: true });

const deciding = (trace: TraceEntry[]) =>
  trace.find((t): t is Extract<TraceEntry, { kind: 'candidates' }> => t.kind === 'candidates' && Boolean(t.winner));

const cfg = (identifier: string, language: string, country: string[], regulation: string, extra: Partial<AxeptioConfig> = {}): AxeptioConfig => ({
  identifier,
  name: identifier,
  language,
  country,
  regulation,
  steps: [{}],
  ...extra,
});

const EU = ['FR', 'DE', 'NO', 'IT'];
/** Shaped like the Samboat case in ENG-14524: two GDPR banners, the EN one is the fallback. */
const samboat: AxeptioProject = {
  projectId: 'samboat',
  client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'eu-en' } },
  cookies: [cfg('eu-fr', 'fr', EU, 'gpdr'), cfg('eu-en', 'en', EU, 'gpdr')],
};

describe('ENG-14524 experimental decision tree', () => {
  const mackageCases: Array<[string, string, string, string]> = [
    ['CA-QC', 'fr-CA', 'CA-QC FR', 'subdivision'],
    ['CA-QC', 'de-DE', 'CA-QC EN', 'subdivision'],
    // A CA-QC banner no longer matches the rest of Canada: the US + CA banner takes over.
    ['CA-ON', 'en-CA', 'EN-US et fallback', 'multi-country'],
    ['CA-ON', 'fr-CA', 'EN-US et fallback', 'multi-country'],
    ['GB-ENG', 'fr-FR', 'UK EN', 'single-country'],
    ['FR-IDF', 'fr-FR', 'EU FR', 'multi-country'],
    ['FR-IDF', 'de-DE', 'EU EN', 'multi-country'],
    ['JP-13', 'ja-JP', 'EN-US et fallback', 'fallback'],
  ];
  it.each(mackageCases)('Mackage: %s with %s gets %s (%s)', (region, language, expected, step) => {
    const result = run(mackage, region, language);
    expect(result.config?.name).toBe(expected);
    expect(result.step).toBe(step);
  });

  it('is off by default: today the Quebec banner captures Ontario', () => {
    expect(selectConfig(mackage, visitor('CA-ON', 'en')).config?.name).toBe('CA-QC EN');
  });

  it('serves the fallback when no candidate speaks the language and the fallback is one of them (Samboat)', () => {
    expect(selectConfig(samboat, visitor('NO', 'nb-NO')).config?.identifier).toBe('eu-fr');
    const result = run(samboat, 'NO', 'nb-NO');
    expect(result.config?.identifier).toBe('eu-en');
    expect(result.isFallback).toBe(true);
    expect(deciding(result.trace)?.experimental?.outcome).toBe('fallback');
  });

  it('takes the first candidate when none speaks the language and the fallback is not a candidate', () => {
    const project: AxeptioProject = { ...samboat, client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'other' } } };
    const result = run(project, 'NO', 'nb-NO');
    expect(result.config?.identifier).toBe('eu-fr');
    expect(deciding(result.trace)?.experimental?.outcome).toBe('first');
  });

  it('serves a single match whatever its language', () => {
    const project: AxeptioProject = { ...samboat, cookies: [cfg('eu-fr', 'fr', EU, 'gpdr')] };
    expect(run(project, 'DE', 'de-DE').config?.identifier).toBe('eu-fr');
  });

  it('breaks a same-language tie on regulation, then list order', () => {
    const project: AxeptioProject = {
      client: { cookiesSettings: { geolocation: true } },
      cookies: [cfg('a-ccpa', 'en', ['FR', 'US'], 'ccpa'), cfg('b-gdpr', 'en', ['FR', 'US'], 'gpdr'), cfg('c-gdpr', 'en', ['FR', 'US'], 'gpdr')],
    };
    const result = run(project, 'FR', 'en');
    expect(result.config?.identifier).toBe('b-gdpr');
    expect(deciding(result.trace)?.experimental?.outcome).toBe('order');
    expect(deciding(result.trace)?.regulationApplied).toBe(true);
  });

  it('never matches a region banner at country level, even when it lists only that country', () => {
    const project: AxeptioProject = {
      client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'world' } },
      cookies: [cfg('qc', 'fr', ['CA'], 'loi25', { subdivision: ['CA-QC'] }), cfg('world', 'en', ['US'], 'ccpa')],
    };
    // Ontario: no region or country match; regulation ccpa → "world".
    expect(run(project, 'CA-ON', 'fr').config?.identifier).toBe('world');
    expect(selectConfig(project, visitor('CA-ON', 'fr')).config?.identifier).toBe('qc');
  });

  it('lists what changes between today and the experimental tree', () => {
    const today = evaluateProject(mackage, { mode: 'actual' });
    const next = evaluateProject(mackage, { mode: 'actual', experimental: true });
    expect(next.experimental).toBe(true);
    const groups = compareEvaluations(today, next);
    expect(groups.length).toBeGreaterThan(0);
    const toUs = groups.filter((g) => g.after === mackage.cookies!.find((c) => c.name === 'EN-US et fallback')!.identifier);
    // Ontario has no entry of its own: the rest of Canada ("CA") stands for it.
    expect(toUs.flatMap((g) => g.regions)).toContain('CA');
    expect(groups.flatMap((g) => g.regions)).not.toContain('CA-QC');
    // Both Quebec banners switch to the same one: a single group with two banners before.
    const names = (ids: Array<string | null>) => ids.map((id) => mackage.cookies!.find((c) => c.identifier === id)?.name);
    expect(toUs).toHaveLength(1);
    expect(names(toUs[0].befores)).toEqual(['CA-QC EN', 'CA-QC FR']);
  });
});
