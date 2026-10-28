/**
 * A line-by-line port of `getCookiesConfig()` from Axeptio's sdk.js
 * (https://static.axept.io/sdk.js, read on 2026-10-28; see docs/SPEC.md section 3).
 *
 * Every helper below names the SDK function it mirrors. Behavior must match the SDK
 * exactly, quirks included: the tests in tests/engine.test.ts are the contract.
 */
import { REGION_TABLE } from './regions';
import type { ABTest, AxeptioConfig, AxeptioProject, CookiesSettings, PageRule, StringOrList } from './types';

export type SelectionStep =
  | 'visibility'
  | 'subdivision'
  | 'single-country'
  | 'multi-country'
  | 'regulation'
  | 'fallback'
  | 'cookiesVersion'
  | 'page'
  | 'default'
  | 'none';

export type CandidateStep = 'subdivision' | 'single-country' | 'multi-country' | 'regulation';

export interface VisitorContext {
  /** Value of the X-Viewer-Country header, e.g. "CA". The SDK uses "Unknown" when it is missing. */
  countryCode?: string | null;
  /** Value of the X-Viewer-Country-Region header, e.g. "QC". "Unknown" when missing. */
  subdivisionCode?: string | null;
  /** navigator.language, e.g. "fr-CA". */
  browserLanguage?: string | null;
  /** document.documentElement.lang, used instead of browserLanguage when useDocumentLang is on. */
  documentLanguage?: string | null;
  useDocumentLang?: boolean;
  /** axeptioSettings.cookiesVersion set by the site (only used when geolocation finds nothing). */
  cookiesVersion?: string | null;
  /** location.pathname + location.search, for configs restricted to pages. Defaults to "/". */
  pagePath?: string | null;
  /** Clock for A/B test date windows (ms). Defaults to Date.now(). */
  now?: number;
}

export interface SelectOptions {
  /** Run the geolocation path even when the project has location-based display OFF. */
  forceGeolocation?: boolean;
}

export interface TieBreak {
  /** Two-letter language key used for the tie-break (undefined when no language). */
  language: string | undefined;
  /** Candidates whose language matches the key, in array order. */
  languageMatches: string[];
  /** True when array order decided (no language match, or several matches). */
  byOrder: boolean;
}

export type TraceEntry =
  | { kind: 'language'; source: 'browser' | 'document'; raw: string | null; key: string | undefined }
  | { kind: 'regulation'; country: string | undefined; subdivision: string | undefined; regulation: string | undefined }
  | { kind: 'visibility'; enabled: boolean; allowed: string[]; passed: boolean }
  | { kind: 'geolocation'; enabled: boolean; forced: boolean }
  | {
      kind: 'candidates';
      step: CandidateStep;
      /** The code that was matched: "CA-QC" for subdivision, "CA" for country steps, "ccpa" for regulation. */
      key: string | undefined;
      matched: string[];
      preferred: string[];
      /** True when the regulation preference actually narrowed the list. */
      regulationApplied: boolean;
      winner?: string;
      tieBreak?: TieBreak;
    }
  | { kind: 'stop'; reason: 'no-regulation' }
  | { kind: 'fallback'; configId: string | null; found: boolean }
  | {
      kind: 'nonGeo';
      cookiesVersion: string | null;
      cookiesVersionMatched: boolean;
      pagePath: string;
      pageMatched: string[];
      excludedByPages: string[];
      withoutSteps: string[];
      eligible: string[];
      strategy?: 'cookiesVersion' | 'page' | 'default';
      winner?: string;
    }
  | { kind: 'abTest'; testId: string; variants: string[] };

export interface ABTestHit {
  testId: string;
  variants: string[];
}

export interface Selection {
  config: AxeptioConfig | null;
  step: SelectionStep;
  /** Regulation of the visitor's region according to the SDK table (undefined outside it). */
  regulation: string | undefined;
  /** Two-letter language key the SDK tie-breaks on. */
  languageKey: string | undefined;
  /** True when the config came from geolocationFallbackConfigId. */
  isFallback: boolean;
  /** SDK flag passed to the A/B logic: true unless the config came from the "default" strategy. */
  explicitlyRouted: boolean;
  /** Whether the geolocation path ran. */
  geolocation: boolean;
  /** A/B test that would replace the config with one of its variants for this visitor. */
  abTest: ABTestHit | null;
  trace: TraceEntry[];
}

// ---------------------------------------------------------------------------
// SDK helpers
// ---------------------------------------------------------------------------

/** SDK `Ho(country, subdivision)`: regulation of a region from the SDK table. */
export function regulationFor(country?: string | null, subdivision?: string | null): string | undefined {
  const n = country && /^[A-Z]{2}$/.test(country) ? country : undefined;
  const o = subdivision && /^[A-Z0-9]{1,3}$/.test(subdivision) ? subdivision : undefined;
  if (n && o) {
    const sub = REGION_TABLE.subdivisions.find((s) => s.isoCodes.includes(`${n}-${o}`));
    if (sub) return sub.regulation;
  }
  if (n) return REGION_TABLE.countries.find((c) => c.isoCodes.includes(n))?.regulation;
  return undefined;
}

/** SDK `Vo(language)`: first two characters, lowercased. */
export function langKey(language: unknown): string | undefined {
  if (language == null || typeof language !== 'string') return undefined;
  return language.substring(0, 2).toLowerCase();
}

/** SDK `Wo(list, key)`: first config in the list whose language matches, else the first one. */
export function byLanguage(list: AxeptioConfig[], key: string | undefined): AxeptioConfig {
  if (key) {
    const matches = list.filter((c) => langKey(c.language) === key);
    if (matches.length > 0) return matches[0];
  }
  return list[0];
}

/** SDK `Go(a, b)`: case-insensitive equality of two truthy regulation strings. */
export function sameRegulation(a: unknown, b: unknown): boolean {
  return Boolean(a) && Boolean(b) && typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/** SDK `qo(list, R)`: keep the configs with regulation R, unless none has it. */
export function preferRegulation(list: AxeptioConfig[], regulation: string | undefined): AxeptioConfig[] {
  if (!regulation) return list;
  const matching = list.filter((c) => sameRegulation(c.regulation, regulation));
  return matching.length > 0 ? matching : list;
}

const asList = (value: StringOrList): unknown[] => (Array.isArray(value) ? value : [value]);

/** SDK subdivision matcher: config.subdivision contains "COUNTRY-SUB". */
export function matchesSubdivision(field: StringOrList, country: unknown, subdivision: unknown): boolean {
  const sub = typeof subdivision === 'string' ? subdivision.trim().toUpperCase() : '';
  const ctry = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (!sub || !ctry || ctry === 'UNKNOWN' || sub === 'UNKNOWN') return false;
  const key = `${ctry}-${sub}`;
  return asList(field).some((v) => typeof v === 'string' && v.trim().toUpperCase() === key);
}

/** SDK country matcher: config.country contains the visitor's country. */
export function matchesCountry(field: StringOrList, country: unknown): boolean {
  const ctry = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (!ctry || ctry === 'UNKNOWN') return false;
  return asList(field).some((v) => typeof v === 'string' && v.trim().toUpperCase() === ctry);
}

/** SDK single-country test: exactly one distinct, non-empty country in config.country. */
export function isSingleCountry(field: StringOrList): boolean {
  const values = asList(field)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toUpperCase())
    .filter((v) => v !== '');
  return new Set(values).size === 1;
}

/** SDK banner visibility gate. Returns false when the banner must not show at all. */
export function passesVisibility(settings: CookiesSettings | null | undefined, country: unknown): boolean {
  if (settings == null || !settings.isBannerVisibilityEnabled) return true;
  const allowed = Array.isArray(settings.allowedCountries) ? settings.allowedCountries.map((c) => String(c).toUpperCase()) : [];
  if (allowed.length === 0) return false;
  const ctry = String(country || '').toUpperCase();
  return !(!ctry || ctry === 'UNKNOWN') && allowed.includes(ctry);
}

const escapeRegExp = (value: string) => value.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

/**
 * SDK `pageMatch(rule)`: tests location.pathname + location.search against the rule.
 * A plain URL is escaped and gets an optional trailing slash; nothing is anchored.
 * Returns null when the rule's regex is invalid (the real SDK would throw).
 */
export function pageMatches(rule: PageRule, pagePath: string): boolean | null {
  const url = rule.url || '';
  const pattern = rule.regex ? url : `${escapeRegExp(url)}${url.indexOf('?') > -1 ? '' : '/?'}`;
  try {
    return new RegExp(pattern).test(pagePath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A/B tests (SDK resolveABTestFor and its helpers)
// ---------------------------------------------------------------------------

interface ABContext {
  countryCode: string | null | undefined;
  regulation: string | undefined;
  language: string | undefined;
}

const time = (value: unknown) => new Date(value as string).getTime();

/** SDK `wr(test, context)`: test is running and its targeting matches the visitor. */
export function abTestTargets(test: ABTest, context: ABContext, now: number): boolean {
  const start = time(test.startDate);
  const end = time(test.endDate);
  if (isNaN(start) || isNaN(end) || now < start || now > end) return false;
  if (test.country && (!context.countryCode || test.country.toLowerCase() !== context.countryCode.toLowerCase())) return false;
  if (test.regulation && (!context.regulation || test.regulation.toLowerCase() !== context.regulation.toLowerCase())) return false;
  if (test.language && (!context.language || test.language.toLowerCase() !== context.language.substring(0, 2).toLowerCase())) return false;
  return true;
}

/** SDK `Sr(test, configId)`. */
function hasVariant(test: ABTest, configId: string | undefined): boolean {
  return Boolean(configId) && Boolean(test.variants?.some((v) => v.configId === configId));
}

/** SDK `xr(tests, ...)`: tests that may apply to the selected config. */
function candidateTests(
  tests: ABTest[] | null | undefined,
  configId: string | undefined,
  explicitlyRouted: boolean,
  context: ABContext,
  now: number,
): ABTest[] {
  if (!tests || !tests.length) return [];
  if (explicitlyRouted) return configId ? tests.filter((t) => hasVariant(t, configId)) : [];
  return tests.filter(
    (t) => hasVariant(t, configId) || (Boolean(t.country || t.regulation || t.language) && abTestTargets(t, context, now)),
  );
}

/** The A/B test that would hand this visitor one of its variants, if any. */
export function abTestFor(
  project: AxeptioProject,
  config: AxeptioConfig | null,
  explicitlyRouted: boolean,
  context: ABContext,
  now: number,
): ABTestHit | null {
  const tests = candidateTests(project.abTests, config?.identifier, explicitlyRouted, context, now);
  const test = tests.find((t) => abTestTargets(t, context, now));
  if (!test) return null;
  return { testId: test.testId, variants: (test.variants ?? []).map((v) => v.configId) };
}

// ---------------------------------------------------------------------------
// getCookiesConfig()
// ---------------------------------------------------------------------------

const ids = (list: AxeptioConfig[]) => list.map((c) => c.identifier);

function tieBreakOf(list: AxeptioConfig[], key: string | undefined): TieBreak {
  const languageMatches = key ? ids(list.filter((c) => langKey(c.language) === key)) : [];
  return { language: key, languageMatches, byOrder: languageMatches.length !== 1 };
}

/** Pick one config from a non-empty candidate list the way the SDK does (single → it, several → language). */
function pick(
  step: CandidateStep,
  key: string | undefined,
  matched: AxeptioConfig[],
  regulation: string | undefined,
  language: string | undefined,
  trace: TraceEntry[],
): AxeptioConfig | null {
  const preferred = preferRegulation(matched, regulation);
  const entry: Extract<TraceEntry, { kind: 'candidates' }> = {
    kind: 'candidates',
    step,
    key,
    matched: ids(matched),
    preferred: ids(preferred),
    regulationApplied: preferred.length !== matched.length,
  };
  trace.push(entry);
  if (preferred.length === 1) {
    entry.winner = preferred[0].identifier;
    return preferred[0];
  }
  if (preferred.length > 1) {
    const winner = byLanguage(preferred, language);
    entry.winner = winner.identifier;
    entry.tieBreak = tieBreakOf(preferred, language);
    return winner;
  }
  return null;
}

/** The geolocation function inside getCookiesConfig (steps a to e of docs/SPEC.md 3.3). */
function geoSelect(
  configs: AxeptioConfig[],
  countryCode: string | null | undefined,
  subdivisionCode: string | null | undefined,
  browserLanguage: string | null | undefined,
  trace: TraceEntry[],
): { config: AxeptioConfig; step: CandidateStep } | null {
  const R = regulationFor(countryCode?.toUpperCase(), subdivisionCode?.toUpperCase());
  const key = langKey(browserLanguage);

  // a. Subdivision match
  const bySub = configs.filter((c) => matchesSubdivision(c.subdivision, countryCode, subdivisionCode));
  const subKey =
    typeof countryCode === 'string' && typeof subdivisionCode === 'string'
      ? `${countryCode.trim().toUpperCase()}-${subdivisionCode.trim().toUpperCase()}`
      : undefined;
  const a = pick('subdivision', subKey, bySub, R, key, trace);
  if (a) return { config: a, step: 'subdivision' };

  // b. Single-country match, c. any country match
  const byCountry = configs.filter((c) => matchesCountry(c.country, countryCode));
  const countryKey = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : undefined;
  const b = pick('single-country', countryKey, byCountry.filter((c) => isSingleCountry(c.country)), R, key, trace);
  if (b) return { config: b, step: 'single-country' };
  const c = pick('multi-country', countryKey, byCountry, R, key, trace);
  if (c) return { config: c, step: 'multi-country' };

  // d. No regulation for this region: stop
  if (R === undefined) {
    trace.push({ kind: 'stop', reason: 'no-regulation' });
    return null;
  }

  // e. Regulation match
  const byRegulation = configs.filter((cfg) => sameRegulation(cfg.regulation, R));
  const entry: Extract<TraceEntry, { kind: 'candidates' }> = {
    kind: 'candidates',
    step: 'regulation',
    key: R,
    matched: ids(byRegulation),
    preferred: ids(byRegulation),
    regulationApplied: false,
  };
  trace.push(entry);
  if (byRegulation.length === 0) return null;
  const winner = byRegulation.length === 1 ? byRegulation[0] : byLanguage(byRegulation, key);
  entry.winner = winner.identifier;
  if (byRegulation.length > 1) entry.tieBreak = tieBreakOf(byRegulation, key);
  return { config: winner, step: 'regulation' };
}

/** The non-geolocation strategies: cookiesVersion, then page rules, then the first config with steps. */
function nonGeoSelect(
  configs: AxeptioConfig[] | null | undefined,
  cookiesVersion: string | null | undefined,
  pagePath: string,
  trace: TraceEntry[],
): { config: AxeptioConfig; strategy: 'cookiesVersion' | 'page' | 'default' } | null {
  const entry: Extract<TraceEntry, { kind: 'nonGeo' }> = {
    kind: 'nonGeo',
    cookiesVersion: cookiesVersion ?? null,
    cookiesVersionMatched: false,
    pagePath,
    pageMatched: [],
    excludedByPages: [],
    withoutSteps: [],
    eligible: [],
  };
  trace.push(entry);
  if (configs == null || !configs.length) return null;
  if (cookiesVersion) {
    const byName = configs.find((c) => c.name === cookiesVersion);
    if (byName) {
      entry.cookiesVersionMatched = true;
      entry.strategy = 'cookiesVersion';
      entry.winner = byName.identifier;
      return { config: byName, strategy: 'cookiesVersion' };
    }
  }
  const pageMatched: AxeptioConfig[] = [];
  const eligible = configs.filter((c) => {
    if (!Array.isArray(c.steps) || c.steps.length === 0) {
      entry.withoutSteps.push(c.identifier);
      return false;
    }
    const pages = c.settings?.pages;
    if (Array.isArray(pages) && pages.length > 0) {
      const matched = pages.some((rule) => pageMatches(rule, pagePath) === true);
      if (matched) pageMatched.push(c);
      else entry.excludedByPages.push(c.identifier);
      return matched;
    }
    return true;
  });
  entry.pageMatched = ids(pageMatched);
  entry.eligible = ids(eligible);
  if (pageMatched[0]) {
    entry.strategy = 'page';
    entry.winner = pageMatched[0].identifier;
    return { config: pageMatched[0], strategy: 'page' };
  }
  if (eligible[0]) {
    entry.strategy = 'default';
    entry.winner = eligible[0].identifier;
    return { config: eligible[0], strategy: 'default' };
  }
  return null;
}

/**
 * Which configuration Axeptio's SDK serves to a visitor, and why.
 * Mirrors sdk.js getCookiesConfig() (geolocation, fallback, cookiesVersion, pages, A/B tests).
 */
export function selectConfig(project: AxeptioProject, visitor: VisitorContext, options: SelectOptions = {}): Selection {
  const trace: TraceEntry[] = [];
  const configs = project.cookies ?? null;
  const settings = project.client?.cookiesSettings ?? undefined;
  const now = visitor.now ?? Date.now();

  const languageRaw = visitor.useDocumentLang ? (visitor.documentLanguage ?? null) : (visitor.browserLanguage ?? null);
  const languageKey = langKey(languageRaw);
  trace.push({ kind: 'language', source: visitor.useDocumentLang ? 'document' : 'browser', raw: languageRaw, key: languageKey });

  // The SDK computes the regulation once without uppercasing (used for A/B context and reporting)...
  const outerRegulation = regulationFor(visitor.countryCode, visitor.subdivisionCode);
  // ...and once inside the geolocation function with uppercased codes (used for selection).
  const regulation = regulationFor(visitor.countryCode?.toUpperCase(), visitor.subdivisionCode?.toUpperCase());
  trace.push({
    kind: 'regulation',
    country: visitor.countryCode?.toUpperCase() ?? undefined,
    subdivision: visitor.subdivisionCode?.toUpperCase() ?? undefined,
    regulation,
  });

  const base = {
    regulation,
    languageKey,
    isFallback: false,
    explicitlyRouted: false,
    geolocation: false,
    abTest: null,
    trace,
  };

  const visible = passesVisibility(settings, visitor.countryCode);
  if (settings?.isBannerVisibilityEnabled) {
    trace.push({
      kind: 'visibility',
      enabled: true,
      allowed: Array.isArray(settings.allowedCountries) ? settings.allowedCountries.map((c) => String(c).toUpperCase()) : [],
      passed: visible,
    });
  }
  if (!visible) return { ...base, config: null, step: 'visibility' };

  let config: AxeptioConfig | null = null;
  let step: SelectionStep = 'none';
  let explicitlyRouted = false;
  let isFallback = false;

  const geolocation = Boolean(settings?.geolocation) || Boolean(options.forceGeolocation);
  trace.push({ kind: 'geolocation', enabled: Boolean(settings?.geolocation), forced: !settings?.geolocation && Boolean(options.forceGeolocation) });

  if (geolocation) {
    const geo = geoSelect(configs ?? [], visitor.countryCode, visitor.subdivisionCode, languageRaw, trace);
    if (geo) {
      config = geo.config;
      step = geo.step;
      explicitlyRouted = true;
    } else {
      const fallbackId = settings?.geolocationFallbackConfigId ?? null;
      const fallback = configs?.find((c) => c.identifier === fallbackId) ?? null;
      trace.push({ kind: 'fallback', configId: fallbackId, found: fallback !== null });
      config = fallback;
      isFallback = fallback !== null;
      explicitlyRouted = fallback !== null;
      if (fallback) step = 'fallback';
    }
  }

  if (!config) {
    const result = nonGeoSelect(configs, visitor.cookiesVersion, visitor.pagePath || '/', trace);
    config = result?.config ?? null;
    step = result ? result.strategy : 'none';
    explicitlyRouted = result !== null && result.strategy !== 'default';
  }

  const abTest = abTestFor(
    project,
    config,
    explicitlyRouted,
    { countryCode: visitor.countryCode, regulation: outerRegulation, language: languageRaw?.substring(0, 2).toLowerCase() },
    now,
  );
  if (abTest) trace.push({ kind: 'abTest', testId: abTest.testId, variants: abTest.variants });

  return { ...base, config, step, isFallback, explicitlyRouted, geolocation, abTest };
}
