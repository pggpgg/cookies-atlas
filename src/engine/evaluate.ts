/**
 * Runs the selection engine for every region and visitor language, so the map and the
 * diagnostics always agree with what the SDK does.
 */
import { REGION_TABLE } from './regions';
import { langKey, selectConfig, type ABTestHit, type Selection, type SelectionStep, type VisitorContext } from './select';
import type { AxeptioConfig, AxeptioProject, StringOrList } from './types';
import { WORLD_COUNTRY_CODES } from './world-codes';

/** Stands for "any language none of the configurations uses" (the SDK then picks by array order). */
export const OTHER_LANGUAGE = '*';
/** Language value passed to the engine for OTHER_LANGUAGE: two characters no config can match. */
const OTHER_PROBE = '~~';

export type EvaluationMode = 'actual' | 'preview';

export interface RegionRequest {
  country: string;
  /** First-level region code without the country prefix ("QC"), or null for "rest of the country". */
  subdivision: string | null;
}

export interface RegionOutcome extends RegionRequest {
  /** "FR" for the country as a whole, "CA-QC" for a region. */
  key: string;
  regulation: string | undefined;
  step: SelectionStep;
  /** Winning config identifier (null = no banner) for each language key, OTHER_LANGUAGE included. */
  byLanguage: Record<string, string | null>;
  /** Distinct winners in configuration order (null last). */
  winners: Array<string | null>;
  /** A/B tests that apply for at least one language. */
  abTests: ABTestHit[];
  /** Selection for each language, kept for traces and diagnostics. */
  selections: Record<string, Selection>;
}

export interface Evaluation {
  mode: EvaluationMode;
  /** Language keys used by configurations, in configuration order, then OTHER_LANGUAGE. */
  languages: string[];
  regions: Map<string, RegionOutcome>;
  /** For each config identifier, the region keys where it wins for at least one language. */
  wins: Map<string, Set<string>>;
}

export interface EvaluateOptions {
  mode: EvaluationMode;
  /** Visitor settings shared by every region (cookiesVersion, page, clock...). */
  visitor?: Omit<VisitorContext, 'countryCode' | 'subdivisionCode' | 'browserLanguage' | 'documentLanguage' | 'useDocumentLang'>;
  /** Extra regions to evaluate, e.g. first-level regions of countries drawn split on the map. */
  extraRegions?: RegionRequest[];
}

export const regionKey = (country: string, subdivision: string | null) => (subdivision ? `${country}-${subdivision}` : country);

const asStrings = (value: StringOrList): string[] =>
  (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string').map((v) => v.trim().toUpperCase()).filter(Boolean);

/** Language keys of the project's configurations, in order, plus OTHER_LANGUAGE. */
export function languagesOf(project: AxeptioProject): string[] {
  const keys: string[] = [];
  for (const config of project.cookies ?? []) {
    const key = langKey(config.language);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return [...keys, OTHER_LANGUAGE];
}

/** Countries listed by a config (normalized, valid ISO-like codes only). */
export const countriesOf = (config: AxeptioConfig) => asStrings(config.country);

/** Subdivisions listed by a config, as written ("CA-QC", or a malformed "QC"). */
export const subdivisionsOf = (config: AxeptioConfig) => asStrings(config.subdivision);

/**
 * Every region worth evaluating: all countries on the map and in configs (as a whole),
 * every subdivision the SDK table or a config mentions, plus the caller's extra regions.
 */
export function regionsToEvaluate(project: AxeptioProject, extra: RegionRequest[] = []): RegionRequest[] {
  const out = new Map<string, RegionRequest>();
  const add = (country: string, subdivision: string | null) => {
    if (!/^[A-Z]{2}$/.test(country)) return;
    out.set(regionKey(country, subdivision), { country, subdivision });
  };
  for (const code of WORLD_COUNTRY_CODES) add(code, null);
  for (const config of project.cookies ?? []) {
    for (const code of countriesOf(config)) add(code, null);
    for (const sub of subdivisionsOf(config)) {
      const m = sub.match(/^([A-Z]{2})-([A-Z0-9]{1,3})$/);
      if (m) {
        add(m[1], null);
        add(m[1], m[2]);
      }
    }
  }
  for (const sub of REGION_TABLE.subdivisions) {
    for (const code of sub.isoCodes) {
      const [country, region] = code.split('-');
      add(country, region);
    }
  }
  for (const r of extra) add(r.country, r.subdivision);
  return [...out.values()];
}

/** Evaluate one region for every language. */
export function evaluateRegion(
  project: AxeptioProject,
  region: RegionRequest,
  languages: string[],
  options: Pick<EvaluateOptions, 'mode' | 'visitor'>,
): RegionOutcome {
  const byLanguage: Record<string, string | null> = {};
  const selections: Record<string, Selection> = {};
  const abTests: ABTestHit[] = [];
  let step: SelectionStep = 'none';
  let regulation: string | undefined;
  for (const language of languages) {
    const selection = selectConfig(
      project,
      {
        ...options.visitor,
        countryCode: region.country,
        subdivisionCode: region.subdivision ?? 'Unknown',
        browserLanguage: language === OTHER_LANGUAGE ? OTHER_PROBE : language,
      },
      { forceGeolocation: options.mode === 'preview' },
    );
    selections[language] = selection;
    byLanguage[language] = selection.config?.identifier ?? null;
    step = selection.step;
    regulation = selection.regulation;
    if (selection.abTest && !abTests.some((t) => t.testId === selection.abTest!.testId)) abTests.push(selection.abTest);
  }
  const order = (project.cookies ?? []).map((c) => c.identifier);
  const distinct = [...new Set(Object.values(byLanguage))];
  const winners = distinct.sort((a, b) => (a === null ? 1 : b === null ? -1 : order.indexOf(a) - order.indexOf(b)));
  return {
    ...region,
    key: regionKey(region.country, region.subdivision),
    regulation,
    step,
    byLanguage,
    winners,
    abTests,
    selections,
  };
}

/** Evaluate the whole project. */
export function evaluateProject(project: AxeptioProject, options: EvaluateOptions): Evaluation {
  const languages = languagesOf(project);
  const regions = new Map<string, RegionOutcome>();
  const wins = new Map<string, Set<string>>();
  for (const config of project.cookies ?? []) wins.set(config.identifier, new Set());
  for (const request of regionsToEvaluate(project, options.extraRegions)) {
    const outcome = evaluateRegion(project, request, languages, options);
    regions.set(outcome.key, outcome);
    for (const winner of outcome.winners) if (winner) wins.get(winner)?.add(outcome.key);
  }
  return { mode: options.mode, languages, regions, wins };
}

/** Which mode tells the truth about a project: geolocation OFF projects are previewed "as if ON". */
export const defaultModeOf = (project: AxeptioProject): EvaluationMode =>
  project.client?.cookiesSettings?.geolocation ? 'actual' : 'preview';

/**
 * Outcome for a map feature: its own region if evaluated (e.g. "CA-QC"),
 * else its first-level parent, else the country as a whole.
 */
export function outcomeForFeature(
  evaluation: Evaluation,
  country: string,
  code?: string | null,
  parent?: string | null,
): RegionOutcome | undefined {
  return (
    (parent ? evaluation.regions.get(regionKey(country, parent)) : undefined) ??
    (code ? evaluation.regions.get(regionKey(country, code)) : undefined) ??
    evaluation.regions.get(country)
  );
}

/** Winner for one language, or the list of distinct winners when language is "all". */
export function winnersFor(outcome: RegionOutcome, language: string | 'all'): Array<string | null> {
  if (language === 'all') return outcome.winners;
  const value = language in outcome.byLanguage ? outcome.byLanguage[language] : outcome.byLanguage[OTHER_LANGUAGE];
  return [value ?? null];
}

/** Countries whose subdivisions matter for this project (referenced by configs or by the SDK table). */
export function countriesWithSubdivisions(project: AxeptioProject): string[] {
  const set = new Set<string>(['CA', 'US']);
  for (const config of project.cookies ?? []) {
    for (const sub of subdivisionsOf(config)) {
      const m = sub.match(/^([A-Z]{2})-[A-Z0-9]{1,3}$/);
      if (m) set.add(m[1]);
    }
  }
  return [...set].sort();
}
