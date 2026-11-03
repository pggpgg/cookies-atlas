/**
 * Runs the selection engine for every region and visitor language, so the map and the
 * diagnostics always agree with what the SDK does.
 */
import { ISO_3166_1 } from './iso-3166';
import { FIRST_LEVEL_REGIONS, SECOND_LEVEL_PARENTS } from './region-parents';
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
  /**
   * False for a country-wide outcome no visitor ever gets: Axeptio always locates visitors in a
   * first-level region too, so when every region of the country has its own outcome, the region
   * match decides for everyone.
   */
  reachable: boolean;
  /**
   * For an unreachable country-wide outcome: the languages whose visitors, if Axeptio ever failed
   * to detect their region, would get a banner that doesn't list the country (or none at all).
   * Empty everywhere else, and whenever those visitors would still get a banner meant for the country.
   */
  stranded: string[];
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
  /** True when the ENG-14524 decision tree was replayed instead of today's SDK. */
  experimental: boolean;
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
  /** Replay the ENG-14524 decision tree instead of today's SDK. */
  experimental?: boolean;
}

export const regionKey = (country: string, subdivision: string | null) => (subdivision ? `${country}-${subdivision}` : country);

/** US territories: the SDK table lists them as US subdivisions, but CDNs report them as countries. */
const US_TERRITORIES: ReadonlySet<string> = new Set(['AS', 'GU', 'MP', 'PR', 'UM', 'VI']);

export interface ReportedAs {
  /** Where visitors are reported instead: a country ("PR") or a first-level region ("FR-IDF"). */
  key: string;
  level: 'country' | 'region';
}

/**
 * Region keys no visitor is ever reported in, and where those visitors are reported instead.
 * The CDN reports US territories as countries ("PR", never "US-PR") and only reports first-level
 * regions ("FR-IDF", never the department "FR-75"). Undefined for reachable (or unknown) keys.
 */
export function reportedInstead(key: string): ReportedAs | undefined {
  const m = /^([A-Z]{2})-([A-Z0-9]{1,3})$/.exec(key);
  if (!m) return undefined;
  const [, country, code] = m;
  if (country === 'US' && US_TERRITORIES.has(code)) return { key: code, level: 'country' };
  const parent = SECOND_LEVEL_PARENTS[country]?.[code];
  return parent ? { key: regionKey(country, parent), level: 'region' } : undefined;
}

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
 * Every place a visitor can be reported in that is worth evaluating: all countries on the map and
 * in configs (as a whole), every subdivision the SDK table or a config mentions, plus the caller's
 * extra regions. Codes no visitor is ever reported with ("UK", "US-PR", "FR-75") are left out, so a
 * config only "wins" where real visitors can get it.
 */
export function regionsToEvaluate(project: AxeptioProject, extra: RegionRequest[] = []): RegionRequest[] {
  const out = new Map<string, RegionRequest>();
  const add = (country: string, subdivision: string | null) => {
    if (!ISO_3166_1.has(country)) return;
    if (subdivision && reportedInstead(regionKey(country, subdivision))) return;
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
  options: Pick<EvaluateOptions, 'mode' | 'visitor' | 'experimental'>,
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
      { forceGeolocation: options.mode === 'preview', experimental: options.experimental },
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
    reachable: true,
    stranded: [],
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
  }
  const byId = new Map((project.cookies ?? []).map((c) => [c.identifier, c]));
  const targeted = new Set((project.cookies ?? []).flatMap(subdivisionsOf));
  for (const outcome of regions.values()) {
    if (outcome.subdivision === null) {
      const firstLevel = FIRST_LEVEL_REGIONS[outcome.country];
      outcome.reachable = !firstLevel?.length || !firstLevel.every((code) => regions.has(regionKey(outcome.country, code)));
      // Only countries whose every region has its own banner: elsewhere a visitor without a region
      // gets what the rest of the country gets anyway.
      const allTargeted = Boolean(firstLevel?.length) && firstLevel.every((code) => targeted.has(regionKey(outcome.country, code)));
      if (allTargeted) outcome.stranded = strandedLanguages(outcome, languages, byId);
    }
    for (const winner of outcome.winners) if (winner) wins.get(winner)?.add(outcome.key);
  }
  return { mode: options.mode, experimental: Boolean(options.experimental), languages, regions, wins };
}

/** Region keys of a country's first-level regions ("CA-QC", "CA-ON"...), empty when unknown. */
export const firstLevelKeysOf = (country: string) => (FIRST_LEVEL_REGIONS[country] ?? []).map((code) => regionKey(country, code));

/**
 * Languages for which a visitor located in the country without a region would land on a banner
 * that doesn't list the country, or on none (location-based display on, visibility gate passed).
 */
function strandedLanguages(outcome: RegionOutcome, languages: string[], byId: Map<string, AxeptioConfig>): string[] {
  return languages.filter((language) => {
    const selection = outcome.selections[language];
    if (!selection?.geolocation || selection.step === 'visibility') return false;
    const winner = outcome.byLanguage[language];
    const config = winner ? byId.get(winner) : undefined;
    return !config || !countriesOf(config).includes(outcome.country);
  });
}

/** Which mode tells the truth about a project: geolocation OFF projects are previewed "as if ON". */
export const defaultModeOf = (project: AxeptioProject): EvaluationMode =>
  project.client?.cookiesSettings?.geolocation ? 'actual' : 'preview';

/**
 * Outcome for a map feature. Visitors are reported in first-level regions, so a finer feature
 * (a French department) takes its parent region's outcome, never its own; a region nothing
 * targets takes the outcome of the country as a whole.
 */
export function outcomeForFeature(
  evaluation: Evaluation,
  country: string,
  code?: string | null,
  parent?: string | null,
): RegionOutcome | undefined {
  const reported = parent ?? code;
  return (reported ? evaluation.regions.get(regionKey(country, reported)) : undefined) ?? evaluation.regions.get(country);
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

export interface ChangeGroup {
  /** Winners today (null = no banner) that switch to `after`, in configuration order (null last). */
  befores: Array<string | null>;
  /** Winner with the experimental tree. */
  after: string | null;
  /** Region keys where some banner switches to `after` for at least one language, sorted. */
  regions: string[];
  /**
   * Countries whose visitors with no detected region switch to `after`, listed only when the
   * experimental tree would leave them on a banner that doesn't list the country (or none).
   */
  undetected: string[];
  /** Language keys affected, in evaluation order (OTHER_LANGUAGE last). */
  languages: string[];
}

/**
 * Places and languages where two evaluations of the same project disagree, grouped by the banner
 * visitors get afterwards (several banners can switch to the same one), biggest groups first.
 */
export function compareEvaluations(base: Evaluation, next: Evaluation): ChangeGroup[] {
  const order = [...base.wins.keys()];
  const rank = (id: string | null) => (id === null ? Infinity : order.indexOf(id));
  const groups = new Map<
    string,
    { after: string | null; befores: Set<string | null>; regions: Set<string>; undetected: Set<string>; languages: Set<string> }
  >();
  for (const [key, outcome] of base.regions) {
    const other = next.regions.get(key);
    if (!other) continue;
    // Visitors with no detected region: only worth listing when the new tree strands them.
    if (!outcome.reachable && other.stranded.length === 0) continue;
    for (const language of base.languages) {
      const before = outcome.byLanguage[language] ?? null;
      const after = other.byLanguage[language] ?? null;
      if (before === after) continue;
      const id = String(after);
      const group = groups.get(id) ?? { after, befores: new Set(), regions: new Set(), undetected: new Set(), languages: new Set() };
      group.befores.add(before);
      if (outcome.reachable) group.regions.add(key);
      else group.undetected.add(outcome.country);
      group.languages.add(language);
      groups.set(id, group);
    }
  }
  return [...groups.values()]
    .map((g) => ({
      befores: [...g.befores].sort((a, b) => rank(a) - rank(b)),
      after: g.after,
      regions: [...g.regions].sort(),
      undetected: [...g.undetected].sort(),
      languages: base.languages.filter((l) => g.languages.has(l)),
    }))
    .sort((a, b) => b.regions.length + b.undetected.length - (a.regions.length + a.undetected.length));
}
