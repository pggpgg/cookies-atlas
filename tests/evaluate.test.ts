import { describe, expect, it } from 'vitest';
import { evaluateProject, languagesOf, outcomeForFeature, OTHER_LANGUAGE, reportedInstead, winnersFor } from '../src/engine/evaluate';
import type { AxeptioProject } from '../src/engine/types';
import mackageJson from './fixtures/mackage.json';
import quilicotJson from './fixtures/quilicot.json';

const mackage = mackageJson as AxeptioProject;
const quilicot = quilicotJson as AxeptioProject;
const id = (project: AxeptioProject, name: string) => project.cookies!.find((c) => c.name === name)!.identifier;

describe('evaluateProject', () => {
  const evaluation = evaluateProject(mackage, { mode: 'actual' });

  it('lists the languages used by configs, then "other"', () => {
    expect(languagesOf(mackage)).toEqual(['en', 'fr', OTHER_LANGUAGE]);
    expect(evaluation.languages).toEqual(['en', 'fr', OTHER_LANGUAGE]);
  });

  it('evaluates every map country plus the SDK table subdivisions', () => {
    expect(evaluation.regions.has('FR')).toBe(true);
    expect(evaluation.regions.has('CA-QC')).toBe(true);
    expect(evaluation.regions.has('US-NY')).toBe(true);
    expect(evaluation.regions.size).toBeGreaterThan(290);
  });

  it('skips US territories the SDK lists as subdivisions (CDNs report them as countries)', () => {
    expect(evaluation.regions.has('US-PR')).toBe(false);
    expect(evaluation.regions.has('PR')).toBe(true);
    expect(evaluation.regions.has('US-DC')).toBe(true);
  });

  it('records one winner per language and the distinct winners in config order', () => {
    const fr = evaluation.regions.get('FR')!;
    expect(fr.step).toBe('multi-country');
    expect(fr.byLanguage).toEqual({ en: id(mackage, 'EU EN'), fr: id(mackage, 'EU FR'), [OTHER_LANGUAGE]: id(mackage, 'EU EN') });
    expect(fr.winners).toEqual([id(mackage, 'EU EN'), id(mackage, 'EU FR')]);
    expect(winnersFor(fr, 'fr')).toEqual([id(mackage, 'EU FR')]);
    expect(winnersFor(fr, 'de')).toEqual([id(mackage, 'EU EN')]);
    expect(winnersFor(fr, 'all')).toHaveLength(2);
  });

  it('paints the rest of Canada with the Québec configs (the over-capture case)', () => {
    const rest = evaluation.regions.get('CA')!;
    expect(rest.step).toBe('single-country');
    expect(rest.winners).toEqual([id(mackage, 'CA-QC EN'), id(mackage, 'CA-QC FR')]);
    expect(evaluation.regions.get('CA-QC')!.step).toBe('subdivision');
  });

  it('marks fallback regions', () => {
    const jp = evaluation.regions.get('JP')!;
    expect(jp.step).toBe('fallback');
    expect(jp.winners).toEqual([id(mackage, 'EN-US et fallback')]);
  });

  it('tracks where each config wins', () => {
    expect(evaluation.wins.get(id(mackage, 'UK EN'))).toEqual(new Set(['GB']));
    expect(evaluation.wins.get(id(mackage, 'CA-QC FR'))!.has('CA-QC')).toBe(true);
  });

  it('maps features to their region, parent region or country', () => {
    expect(outcomeForFeature(evaluation, 'CA', 'QC')!.key).toBe('CA-QC');
    expect(outcomeForFeature(evaluation, 'CA', 'ON')!.key).toBe('CA');
    expect(outcomeForFeature(evaluation, 'US', 'NY')!.key).toBe('US-NY');
    expect(outcomeForFeature(evaluation, 'FR', '75', 'IDF')!.key).toBe('FR');
    expect(outcomeForFeature(evaluation, 'ZZ')).toBeUndefined();
  });

  it('paints a finer feature with its reported region, never with its own code', () => {
    const cfg = (identifier: string, subdivision: string) => ({ identifier, name: identifier, subdivision, steps: [{ name: 'welcome' }] });
    const project: AxeptioProject = {
      client: { cookiesSettings: { geolocation: true } },
      cookies: [cfg('idf', 'FR-IDF'), cfg('paris', 'FR-75')],
    };
    const ev = evaluateProject(project, { mode: 'actual' });
    expect(ev.regions.has('FR-75')).toBe(false);
    expect(outcomeForFeature(ev, 'FR', '75', 'IDF')!.winners).toEqual(['idf']);
    expect(outcomeForFeature(ev, 'FR', '13', 'PAC')!.key).toBe('FR');
  });

  it('previews a geolocation-off project as if it were on', () => {
    const today = evaluateProject(quilicot, { mode: 'actual' });
    const preview = evaluateProject(quilicot, { mode: 'preview' });
    const fr = id(quilicot, 'fr-ca-qc-04-10-2024');
    const en = id(quilicot, 'en-ca-qc-04-10-2024');
    expect(today.regions.get('CA')!.winners).toEqual([fr]);
    expect(today.regions.get('CA')!.step).toBe('default');
    expect(preview.regions.get('CA')!.winners).toEqual([fr, en]);
    expect(preview.regions.get('CA')!.step).toBe('single-country');
    expect(preview.regions.get('JP')!.step).toBe('default');
  });
});

describe('reportedInstead', () => {
  it('knows where visitors in unreachable codes are reported', () => {
    expect(reportedInstead('FR-75')).toEqual({ key: 'FR-IDF', level: 'region' });
    expect(reportedInstead('GB-KEN')).toEqual({ key: 'GB-ENG', level: 'region' });
    expect(reportedInstead('IT-MI')).toEqual({ key: 'IT-25', level: 'region' });
    expect(reportedInstead('ES-NA')).toEqual({ key: 'ES-NC', level: 'region' });
    expect(reportedInstead('IE-D')).toEqual({ key: 'IE-L', level: 'region' });
    expect(reportedInstead('US-PR')).toEqual({ key: 'PR', level: 'country' });
  });

  it('leaves first-level and unknown codes alone', () => {
    for (const key of ['FR-IDF', 'CA-QC', 'US-CA', 'ES-NC', 'ES-ML', 'GW-BS', 'BW-GA', 'MV-MLE', 'XX-YY', 'FR', 'QC']) {
      expect(reportedInstead(key)).toBeUndefined();
    }
  });
});
