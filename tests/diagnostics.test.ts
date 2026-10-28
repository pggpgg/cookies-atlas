import { describe, expect, it } from 'vitest';
import { diagnose, type Finding } from '../src/engine/diagnostics';
import { evaluateProject } from '../src/engine/evaluate';
import type { AxeptioConfig, AxeptioProject } from '../src/engine/types';
import mackageJson from './fixtures/mackage.json';
import quilicotJson from './fixtures/quilicot.json';
import axeptioJson from './fixtures/axeptio.json';

const mackage = mackageJson as AxeptioProject;
const quilicot = quilicotJson as AxeptioProject;
const axeptio = axeptioJson as AxeptioProject;
const NOW = Date.parse('2026-10-28T12:00:00Z');

const id = (project: AxeptioProject, name: string) => project.cookies!.find((c) => c.name === name)!.identifier;
const run = (project: AxeptioProject, mode: 'actual' | 'preview') => diagnose(project, evaluateProject(project, { mode, visitor: { now: NOW } }), NOW);
const ofKind = (findings: Finding[], kind: Finding['kind']) => findings.filter((f) => f.kind === kind);

describe('Mackage diagnostics (geolocation ON)', () => {
  const findings = run(mackage, 'actual');

  it('flags the Québec configs capturing the rest of Canada, pointing at the CCPA config', () => {
    const over = ofKind(findings, 'over-capture');
    expect(over).toHaveLength(1);
    expect(over[0].severity).toBe('warning');
    expect(over[0].regions).toEqual(['CA']);
    expect(over[0].configs).toEqual([id(mackage, 'CA-QC EN'), id(mackage, 'CA-QC FR'), id(mackage, 'EN-US et fallback')]);
    expect(over[0].data).toMatchObject({
      country: 'CA',
      intended: ['CA-QC'],
      step: 'single-country',
      regulation: 'ccpa',
      capturing: [id(mackage, 'CA-QC EN'), id(mackage, 'CA-QC FR')],
      competitor: id(mackage, 'EN-US et fallback'),
      competitorSingle: false,
    });
  });

  it('flags Brazil (LGPD, opt-in) getting the CCPA fallback as an error', () => {
    const errors = ofKind(findings, 'regulation-mismatch').filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].regions).toEqual(['BR']);
    expect(errors[0].configs).toEqual([id(mackage, 'EN-US et fallback')]);
    expect(errors[0].data).toMatchObject({ regulations: ['lgpd'], configRegulation: 'ccpa', targeted: false, steps: ['fallback'] });
  });

  it('groups the softer mismatches: Switzerland on the EU banners, GPP states on the CCPA one', () => {
    const infos = ofKind(findings, 'regulation-mismatch').filter((f) => f.severity === 'info');
    const swiss = infos.find((f) => f.data.configRegulation === 'gpdr');
    expect(swiss?.regions).toEqual(['CH']);
    expect(swiss?.configs).toEqual([id(mackage, 'EU EN'), id(mackage, 'EU FR')]);
    const gpp = infos.find((f) => f.data.configRegulation === 'ccpa');
    expect(gpp?.regions).toContain('US-NY');
    expect(gpp?.data.regulations).toEqual(['gpp']);
    // Canada is explained by the over-capture finding, not repeated here
    expect(infos.some((f) => f.regions.includes('CA'))).toBe(false);
  });

  it('explains once that the EU configs never show in GB (UK EN is single-country)', () => {
    const shadowed = ofKind(findings, 'shadowed-listing');
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].regions).toEqual(['GB']);
    expect(shadowed[0].data).toMatchObject({
      shadowed: [id(mackage, 'EU EN'), id(mackage, 'EU FR')],
      reason: 'specificity',
      winners: [id(mackage, 'UK EN')],
    });
  });

  it('notes the EU configs also serve unlisted GDPR countries through the regulation match', () => {
    const capture = ofKind(findings, 'regulation-capture');
    expect(capture).toHaveLength(1);
    expect(capture[0].configs).toEqual([id(mackage, 'EU EN'), id(mackage, 'EU FR')]);
    expect(capture[0].regions).toEqual(['BA', 'MK', 'RS', 'RU']);
  });

  it('has no dead configs and no geolocation warning', () => {
    expect(ofKind(findings, 'dead-config')).toEqual([]);
    expect(ofKind(findings, 'geolocation-off')).toEqual([]);
    expect(ofKind(findings, 'fallback-missing')).toEqual([]);
  });

  it('sorts errors first', () => {
    const order = findings.map((f) => f.severity);
    expect(order.indexOf('error')).toBe(0);
    expect(order.lastIndexOf('error')).toBeLessThan(order.indexOf('warning'));
  });
});

describe('Quilicot diagnostics (geolocation OFF, previewed)', () => {
  const findings = run(quilicot, 'preview');

  it('warns that geolocation is off and names what loads today', () => {
    const off = ofKind(findings, 'geolocation-off')[0];
    expect(off.severity).toBe('warning');
    expect(off.data).toMatchObject({ defaultConfig: id(quilicot, 'fr-ca-qc-04-10-2024'), hasPageRules: true });
  });

  it('flags the "QC" subdivisions and suggests CA-QC', () => {
    const format = ofKind(findings, 'subdivision-format');
    expect(format).toHaveLength(1);
    expect(format[0].configs).toEqual([id(quilicot, 'fr-ca-qc-04-10-2024'), id(quilicot, 'en-ca-qc-04-10-2024')]);
    expect(format[0].data).toEqual({ values: ['QC'], suggestions: ['CA-QC'] });
  });

  it('flags both configs as capturing all of Canada, with no CCPA alternative', () => {
    const over = ofKind(findings, 'over-capture');
    expect(over).toHaveLength(1);
    expect(over[0].data).toMatchObject({
      country: 'CA',
      intended: ['CA-QC'],
      competitor: null,
      capturing: [id(quilicot, 'fr-ca-qc-04-10-2024'), id(quilicot, 'en-ca-qc-04-10-2024')],
    });
  });
});

describe("Axeptio's own project diagnostics (geolocation OFF, previewed)", () => {
  const findings = run(axeptio, 'preview');

  it('finds the three configs that can never win, and why', () => {
    const dead = ofKind(findings, 'dead-config');
    const byConfig = Object.fromEntries(dead.map((f) => [f.configs[0], f.data]));
    expect(Object.keys(byConfig).sort()).toEqual([id(axeptio, 'axeptio prod-en-GB'), id(axeptio, 'axeptio prod-pt-BR'), id(axeptio, 'axeptio prod-fr-FR')].sort());
    expect(byConfig[id(axeptio, 'axeptio prod-en-GB')]).toMatchObject({ reason: 'order', by: id(axeptio, 'axeptio-prod-en'), home: 'FR' });
    expect(byConfig[id(axeptio, 'axeptio prod-pt-BR')]).toMatchObject({ reason: 'order', by: id(axeptio, 'axeptio-prod-pt'), home: 'PT' });
    expect(byConfig[id(axeptio, 'axeptio prod-fr-FR')]).toMatchObject({ reason: 'order', by: id(axeptio, 'axeptio-prod-fr'), home: 'FR' });
  });

  it('flags the Québec config capturing the rest of Canada', () => {
    const over = ofKind(findings, 'over-capture');
    expect(over.map((f) => f.configs[0])).toEqual([id(axeptio, 'axeptio-prod-fr-ca')]);
  });

  it('does not report order ties already explained by dead configs', () => {
    expect(ofKind(findings, 'order-tie')).toEqual([]);
  });
});

describe('field and settings diagnostics', () => {
  const cfg = (identifier: string, fields: Partial<AxeptioConfig> = {}): AxeptioConfig => ({
    identifier,
    name: identifier,
    steps: [{ name: 'welcome', layout: 'welcome' }],
    ...fields,
  });
  const diagnoseProject = (project: AxeptioProject, mode: 'actual' | 'preview' = 'actual') => run(project, mode);

  it('catches typos in countries and regulations, and broken page rules', () => {
    const findings = diagnoseProject({
      projectId: 'p',
      client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'a' } },
      cookies: [cfg('a', { country: ['UK', 'FR'], regulation: 'gdpr', settings: { pages: [{ url: '(', regex: true }] } })],
    });
    expect(ofKind(findings, 'unknown-country')[0].data).toEqual({ values: ['UK'], suggestions: ['GB'] });
    expect(ofKind(findings, 'unknown-regulation')[0].data).toEqual({ value: 'gdpr', suggestion: 'gpdr' });
    expect(ofKind(findings, 'invalid-page-rule')[0].data).toEqual({ url: '(' });
  });

  it('reports banner visibility settings', () => {
    const empty = diagnoseProject({ client: { cookiesSettings: { geolocation: true, isBannerVisibilityEnabled: true, allowedCountries: [] } }, cookies: [cfg('a')] });
    expect(ofKind(empty, 'visibility-empty')[0].severity).toBe('error');
    const restricted = diagnoseProject({ client: { cookiesSettings: { geolocation: true, isBannerVisibilityEnabled: true, allowedCountries: ['fr', 'BE'] } }, cookies: [cfg('a', { country: 'FR' })] });
    expect(ofKind(restricted, 'visibility-restricted')[0].data).toEqual({ allowed: ['FR', 'BE'] });
  });

  it('reports a missing or broken fallback when geolocation is on', () => {
    const missing = diagnoseProject({ client: { cookiesSettings: { geolocation: true } }, cookies: [cfg('fr', { country: 'FR' }), cfg('us', { country: 'US' })] });
    const finding = ofKind(missing, 'fallback-missing')[0];
    expect(finding.data).toMatchObject({ defaultConfig: 'fr' });
    expect(finding.regions).toContain('JP');
    const broken = diagnoseProject({ client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'gone' } }, cookies: [cfg('fr', { country: 'FR' })] });
    expect(ofKind(broken, 'fallback-invalid')[0].data).toEqual({ fallbackId: 'gone' });
  });

  it('reports same-language ties decided by list order when both configs still win elsewhere', () => {
    const findings = diagnoseProject({
      client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'world' } },
      cookies: [
        cfg('eu-1', { country: ['FR', 'BE'], language: 'fr', regulation: 'gpdr' }),
        cfg('eu-2', { country: ['BE', 'LU'], language: 'fr', regulation: 'gpdr' }),
        cfg('world', { language: 'en' }),
      ],
    });
    const tie = ofKind(findings, 'order-tie')[0];
    expect(tie.configs).toEqual(['eu-1', 'eu-2']);
    // Unlisted GDPR countries reached through the regulation match
    expect(tie.regions).toContain('AT');
    // BE is listed by eu-2 but always goes to eu-1: reported once, as a shadowed listing
    expect(tie.regions).not.toContain('BE');
    const shadowed = ofKind(findings, 'shadowed-listing').find((f) => (f.data.shadowed as string[]).includes('eu-2'));
    expect(shadowed?.regions).toEqual(['BE']);
    expect(shadowed?.data).toMatchObject({ reason: 'order', by: 'eu-1' });
  });

  it('lists running A/B tests', () => {
    const findings = diagnoseProject({
      client: { cookiesSettings: { geolocation: true } },
      cookies: [cfg('a', { country: 'FR' }), cfg('b', { country: 'FR' })],
      abTests: [{ testId: 't1', variants: [{ configId: 'a' }, { configId: 'b' }], startDate: '2026-10-01', endDate: '2026-12-01' }],
    });
    const ab = ofKind(findings, 'ab-test')[0];
    expect(ab.configs).toEqual(['a', 'b']);
    expect(ab.regions).toContain('FR');
    // b only wins through the test: not reported as dead
    expect(ofKind(findings, 'dead-config')).toEqual([]);
  });
});
