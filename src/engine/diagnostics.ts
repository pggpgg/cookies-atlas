/**
 * Findings about a project's geolocation setup. Everything engine-related is derived from an
 * Evaluation (the same one the map paints), so findings always agree with the map.
 * Wording lives in src/i18n: a finding only carries its kind, severity and data.
 */
import { countriesOf, OTHER_LANGUAGE, regionKey, subdivisionsOf, type Evaluation, type RegionOutcome } from './evaluate';
import { COUNTRY_CODE_FIXES, ISO_3166_1 } from './iso-3166';
import { OPT_IN_REGULATIONS, OPT_OUT_REGULATIONS, REGULATIONS } from './regions';
import { langKey, pageMatches, sameRegulation, selectConfig, type Selection, type TraceEntry } from './select';
import type { AxeptioConfig, AxeptioProject } from './types';

export type Severity = 'error' | 'warning' | 'info';

export type FindingKind =
  | 'geolocation-off'
  | 'visibility-empty'
  | 'visibility-restricted'
  | 'fallback-invalid'
  | 'fallback-missing'
  | 'dead-config'
  | 'over-capture'
  | 'regulation-mismatch'
  | 'shadowed-listing'
  | 'order-tie'
  | 'regulation-capture'
  | 'subdivision-format'
  | 'unknown-country'
  | 'unknown-regulation'
  | 'invalid-page-rule'
  | 'ab-test';

/** Why a config loses where it should win. */
export type LossReason = 'order' | 'specificity' | 'regulation' | 'untargeted' | 'unknown';

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** Config identifiers involved; the first one is the main subject. */
  configs: string[];
  /** Region keys involved ("FR", "CA-QC"). A country key means "the rest of that country" when it is split. */
  regions: string[];
  data: Record<string, unknown>;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const KNOWN_REGULATIONS = new Set<string>(Object.values(REGULATIONS));

const isWellFormedSubdivision = (value: string) => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(value);

/** What a config is meant to cover: its subdivisions (normalized when possible) and countries. */
export function intentOf(config: AxeptioConfig): { subdivisions: string[]; countries: string[] } {
  const countries = countriesOf(config);
  const single = new Set(countries).size === 1 ? countries[0] : undefined;
  const subdivisions = subdivisionsOf(config)
    .map((s) => (isWellFormedSubdivision(s) ? s : single && /^[A-Z0-9]{1,3}$/.test(s) ? `${single}-${s}` : null))
    .filter((s): s is string => s !== null);
  return { subdivisions, countries };
}

const hasPageRules = (config: AxeptioConfig) => Array.isArray(config.settings?.pages) && config.settings!.pages!.length > 0;

/** The candidate step that picked the winner in a selection, if any. */
function decidingEntry(selection: Selection): Extract<TraceEntry, { kind: 'candidates' }> | undefined {
  return selection.trace.find((t): t is Extract<TraceEntry, { kind: 'candidates' }> => t.kind === 'candidates' && Boolean(t.winner));
}

/** Explain why `configId` lost in a selection that picked someone else. */
export function lossReason(selection: Selection, configId: string, configs: AxeptioConfig[]): { reason: LossReason; by?: string } {
  const winner = selection.config?.identifier;
  const entry = decidingEntry(selection);
  if (!entry || !winner) return { reason: 'unknown', by: winner };
  if (!entry.matched.includes(configId)) return { reason: 'specificity', by: winner };
  if (!entry.preferred.includes(configId)) return { reason: 'regulation', by: winner };
  const loser = configs.find((c) => c.identifier === configId);
  const won = configs.find((c) => c.identifier === winner);
  if (loser && won && langKey(loser.language) === langKey(won.language)) return { reason: 'order', by: winner };
  return { reason: 'unknown', by: winner };
}

/** Language key a config speaks, or OTHER_LANGUAGE when it has none (or one the evaluation didn't use). */
function languageOf(config: AxeptioConfig, evaluation: Evaluation): string {
  const key = langKey(config.language);
  return key && evaluation.languages.includes(key) ? key : OTHER_LANGUAGE;
}

function selectionAt(outcome: RegionOutcome, language: string): Selection {
  return outcome.selections[language] ?? outcome.selections[OTHER_LANGUAGE];
}

export function diagnose(project: AxeptioProject, evaluation: Evaluation, now: number = Date.now()): Finding[] {
  const findings: Finding[] = [];
  const configs = project.cookies ?? [];
  const byId = new Map(configs.map((c) => [c.identifier, c]));
  const settings = project.client?.cookiesSettings ?? null;
  const geolocationOn = Boolean(settings?.geolocation);
  const regions = [...evaluation.regions.values()];

  // --- Project-level settings ------------------------------------------------------------
  if (!geolocationOn) {
    // What a visitor on the home page gets today (no cookiesVersion pinned by the site).
    const allowed = settings?.isBannerVisibilityEnabled && Array.isArray(settings.allowedCountries) ? settings.allowedCountries : [];
    const today = selectConfig(project, { countryCode: allowed[0] ?? 'FR', subdivisionCode: 'Unknown', pagePath: '/', now }).config;
    findings.push({
      id: 'geolocation-off',
      kind: 'geolocation-off',
      severity: 'warning',
      configs: today ? [today.identifier] : [],
      regions: [],
      data: { defaultConfig: today?.identifier ?? null, configCount: configs.length, hasPageRules: configs.some(hasPageRules) },
    });
  }

  if (settings?.isBannerVisibilityEnabled) {
    const allowed = Array.isArray(settings.allowedCountries) ? settings.allowedCountries.map((c) => String(c).toUpperCase()) : [];
    findings.push(
      allowed.length === 0
        ? { id: 'visibility-empty', kind: 'visibility-empty', severity: 'error', configs: [], regions: [], data: {} }
        : { id: 'visibility-restricted', kind: 'visibility-restricted', severity: 'info', configs: [], regions: allowed, data: { allowed } },
    );
  }

  if (geolocationOn && evaluation.mode === 'actual') {
    const fallbackId = settings?.geolocationFallbackConfigId ?? null;
    if (fallbackId && !byId.has(fallbackId)) {
      findings.push({ id: 'fallback-invalid', kind: 'fallback-invalid', severity: 'error', configs: [], regions: [], data: { fallbackId } });
    }
    if (!fallbackId || !byId.has(fallbackId)) {
      const dropped = regions.filter((r) => r.subdivision === null && (r.step === 'default' || r.step === 'none' || r.step === 'page'));
      if (dropped.length > 0) {
        const defaultConfig = dropped.find((r) => r.winners[0])?.winners[0] ?? null;
        findings.push({
          id: 'fallback-missing',
          kind: 'fallback-missing',
          severity: 'warning',
          configs: defaultConfig ? [defaultConfig] : [],
          regions: dropped.map((r) => r.key),
          data: { defaultConfig, regionCount: dropped.length },
        });
      }
    }
  }

  // --- Configuration fields ----------------------------------------------------------------
  for (const config of configs) {
    const subs = subdivisionsOf(config);
    const malformed = subs.filter((s) => !isWellFormedSubdivision(s));
    if (malformed.length > 0) {
      const countries = countriesOf(config);
      const single = new Set(countries).size === 1 ? countries[0] : undefined;
      const suggestions = malformed.map((v) => (single && /^[A-Z0-9]{1,3}$/.test(v) ? `${single}-${v}` : null));
      // Configs with the same mistake share one finding.
      const id = `subdivision-format:${malformed.join(',')}:${suggestions.join(',')}`;
      const existing = findings.find((f) => f.id === id);
      if (existing) existing.configs.push(config.identifier);
      else
        findings.push({
          id,
          kind: 'subdivision-format',
          severity: 'warning',
          configs: [config.identifier],
          regions: [],
          data: { values: malformed, suggestions },
        });
    }

    const badCountries = countriesOf(config).filter((c) => !ISO_3166_1.has(c));
    if (badCountries.length > 0) {
      findings.push({
        id: `unknown-country:${config.identifier}`,
        kind: 'unknown-country',
        severity: 'warning',
        configs: [config.identifier],
        regions: [],
        data: { values: badCountries, suggestions: badCountries.map((c) => COUNTRY_CODE_FIXES[c] ?? null) },
      });
    }

    if (typeof config.regulation === 'string' && config.regulation && !KNOWN_REGULATIONS.has(config.regulation.toLowerCase())) {
      findings.push({
        id: `unknown-regulation:${config.identifier}`,
        kind: 'unknown-regulation',
        severity: 'warning',
        configs: [config.identifier],
        regions: [],
        data: { value: config.regulation, suggestion: config.regulation.toLowerCase() === 'gdpr' ? 'gpdr' : null },
      });
    }

    for (const rule of config.settings?.pages ?? []) {
      if (pageMatches(rule, '/') === null) {
        findings.push({
          id: `invalid-page-rule:${config.identifier}:${rule.url}`,
          kind: 'invalid-page-rule',
          severity: 'warning',
          configs: [config.identifier],
          regions: [],
          data: { url: rule.url ?? '' },
        });
      }
    }
  }

  // --- Engine-backed findings ----------------------------------------------------------------

  // Over-capture: region-targeted configs that also win elsewhere in their country through a
  // country match. Grouped by country, since configs for the same region share the cause.
  const overCaptured = new Set<string>(); // "configId|regionKey"
  const explainedShadow = new Set<string>(); // "configId|regionKey" losses an over-capture finding explains
  interface CaptureGroup {
    country: string;
    capturing: string[];
    regions: Set<string>;
    intended: Set<string>;
    step: string;
    regulation: string | undefined;
  }
  const captureGroups = new Map<string, CaptureGroup>();
  for (const config of configs) {
    const intent = intentOf(config);
    if (intent.subdivisions.length === 0) continue;
    for (const key of evaluation.wins.get(config.identifier) ?? []) {
      if (intent.subdivisions.includes(key)) continue;
      const outcome = evaluation.regions.get(key)!;
      if (outcome.step !== 'single-country' && outcome.step !== 'multi-country') continue;
      const group: CaptureGroup = captureGroups.get(outcome.country) ?? {
        country: outcome.country,
        capturing: [],
        regions: new Set(),
        intended: new Set(),
        step: outcome.step,
        regulation: undefined,
      };
      if (!group.capturing.includes(config.identifier)) group.capturing.push(config.identifier);
      group.regions.add(key);
      for (const sub of intent.subdivisions) if (sub.startsWith(outcome.country + '-')) group.intended.add(sub);
      // The rest of the country decides the regulation shown in the explanation.
      if (outcome.subdivision === null || group.regulation === undefined) group.regulation = outcome.regulation;
      captureGroups.set(outcome.country, group);
      overCaptured.add(`${config.identifier}|${key}`);
    }
  }
  for (const group of captureGroups.values()) {
    // A config listing the country with the region's regulation, losing because the capturing ones are checked first.
    const competitor = configs.find(
      (c) => !group.capturing.includes(c.identifier) && countriesOf(c).includes(group.country) && sameRegulation(c.regulation, group.regulation),
    );
    if (competitor) for (const key of group.regions) explainedShadow.add(`${competitor.identifier}|${key}`);
    findings.push({
      id: `over-capture:${group.country}`,
      kind: 'over-capture',
      severity: 'warning',
      configs: competitor ? [...group.capturing, competitor.identifier] : [...group.capturing],
      regions: [...group.regions].sort(),
      data: {
        country: group.country,
        intended: [...group.intended].sort(),
        step: group.step,
        regulation: group.regulation ?? null,
        capturing: group.capturing,
        competitor: competitor?.identifier ?? null,
        competitorSingle: competitor ? new Set(countriesOf(competitor)).size === 1 : false,
      },
    });
  }

  const abVariants = new Set((project.abTests ?? []).flatMap((t) => (t.variants ?? []).map((v) => v.configId)));
  const dead = new Set<string>();
  // Region keys where each config is shadowed (reported by shadowed-listing).
  const shadowedIn = new Map<string, Set<string>>();
  const shadowGroups = new Map<string, Finding>();

  for (const config of configs) {
    const wins = evaluation.wins.get(config.identifier) ?? new Set();
    const intent = intentOf(config);
    const homes = [...intent.subdivisions, ...intent.countries.filter((c) => ISO_3166_1.has(c))];
    const language = languageOf(config, evaluation);

    if (wins.size === 0) {
      if (config.partOfABTest || abVariants.has(config.identifier)) continue;
      dead.add(config.identifier);
      const home = homes.find((h) => evaluation.regions.has(h));
      const outcome = home ? evaluation.regions.get(home) : undefined;
      const why = outcome ? lossReason(selectionAt(outcome, language), config.identifier, configs) : { reason: 'untargeted' as LossReason };
      findings.push({
        id: `dead-config:${config.identifier}`,
        kind: 'dead-config',
        severity: hasPageRules(config) ? 'info' : 'warning',
        configs: why.by ? [config.identifier, why.by] : [config.identifier],
        regions: home ? [home] : [],
        data: { reason: why.reason, by: why.by ?? null, home: home ?? null, language, hasPageRules: hasPageRules(config) },
      });
      continue;
    }

    // Listed but never served there (unless an over-capture finding already explains it).
    const shadowed = homes.filter(
      (h) => evaluation.regions.has(h) && !wins.has(h) && !explainedShadow.has(`${config.identifier}|${h}`),
    );
    if (shadowed.length > 0) {
      shadowedIn.set(config.identifier, new Set(shadowed));
      const first = evaluation.regions.get(shadowed[0])!;
      const why = lossReason(selectionAt(first, language), config.identifier, configs);
      const winners = [...new Set(shadowed.flatMap((h) => evaluation.regions.get(h)!.winners))].filter((w): w is string => Boolean(w));
      // Configs shadowed in the same regions by the same winners for the same reason share one finding.
      const id = `shadowed-listing:${[...shadowed].sort().join(',')}:${winners.join(',')}:${why.reason}`;
      const existing = shadowGroups.get(id);
      if (existing) {
        (existing.data.shadowed as string[]).push(config.identifier);
        existing.configs = [...(existing.data.shadowed as string[]), ...winners];
      } else {
        shadowGroups.set(id, {
          id,
          kind: 'shadowed-listing',
          severity: 'info',
          configs: [config.identifier, ...winners],
          regions: shadowed,
          data: { shadowed: [config.identifier], reason: why.reason, by: why.by ?? null, winners },
        });
      }
    }
  }
  findings.push(...shadowGroups.values());

  // Regulation mismatch: regions with their own law served a banner built for another regulation.
  // Grouped by severity, the banner's regulation and whether a config targeted the region at all.
  const UNMATCHED_STEPS = new Set(['fallback', 'default', 'page', 'cookiesVersion', 'none']);
  const mismatches = new Map<string, Finding>();
  for (const outcome of regions) {
    const R = outcome.regulation;
    if (!R) continue;
    for (const language of evaluation.languages) {
      const winnerId = outcome.byLanguage[language];
      if (!winnerId) continue;
      const winner = byId.get(winnerId);
      if (!winner || sameRegulation(winner.regulation, R)) continue;
      if (overCaptured.has(`${winnerId}|${outcome.key}`)) continue;
      const theirs = typeof winner.regulation === 'string' ? winner.regulation.toLowerCase() : null;
      const severity: Severity =
        OPT_IN_REGULATIONS.has(R) && (!theirs || OPT_OUT_REGULATIONS.has(theirs) || !KNOWN_REGULATIONS.has(theirs)) ? 'error' : 'info';
      const targeted = !UNMATCHED_STEPS.has(outcome.step);
      const id = `regulation-mismatch:${severity}:${theirs ?? 'none'}:${targeted ? 'targeted' : 'untargeted'}`;
      const finding: Finding = mismatches.get(id) ?? {
        id,
        kind: 'regulation-mismatch',
        severity,
        configs: [],
        regions: [],
        data: { regulations: [] as string[], configRegulation: theirs, targeted, languages: [] as string[], steps: [] as string[] },
      };
      if (!finding.configs.includes(winnerId)) finding.configs.push(winnerId);
      if (!finding.regions.includes(outcome.key)) finding.regions.push(outcome.key);
      for (const [field, value] of [['regulations', R], ['languages', language], ['steps', outcome.step]] as const) {
        const list = finding.data[field] as string[];
        if (!list.includes(value)) list.push(value);
      }
      mismatches.set(id, finding);
    }
  }
  findings.push(...mismatches.values());

  // Regulation capture: configs serving countries they don't list, through the regulation match.
  // Configs capturing the same countries (tie-broken by language) share one finding.
  const captures = new Map<string, Finding>();
  for (const config of configs) {
    const listed = new Set(countriesOf(config));
    const captured = [...(evaluation.wins.get(config.identifier) ?? [])]
      .filter((key) => {
        const o = evaluation.regions.get(key)!;
        return o.step === 'regulation' && o.subdivision === null && !listed.has(o.country);
      })
      .sort();
    if (captured.length === 0) continue;
    const regulation = typeof config.regulation === 'string' ? config.regulation.toLowerCase() : null;
    const id = `regulation-capture:${regulation}:${captured.join(',')}`;
    const existing = captures.get(id);
    if (existing) existing.configs.push(config.identifier);
    else
      captures.set(id, {
        id,
        kind: 'regulation-capture',
        severity: 'info',
        configs: [config.identifier],
        regions: captured,
        data: { regulation, count: captured.length },
      });
  }
  findings.push(...captures.values());

  // Order ties: same-language configs where the first in the list always wins.
  const ties = new Map<string, Finding>();
  for (const outcome of regions) {
    for (const language of evaluation.languages) {
      if (language === OTHER_LANGUAGE) continue;
      const selection = outcome.selections[language];
      const entry = selection ? decidingEntry(selection) : undefined;
      if (!entry?.tieBreak || entry.tieBreak.languageMatches.length < 2) continue;
      const [winner, ...losers] = entry.tieBreak.languageMatches;
      for (const loser of losers) {
        if (dead.has(loser) || shadowedIn.get(loser)?.has(outcome.key)) continue;
        const id = `order-tie:${winner}:${loser}`;
        const finding = ties.get(id) ?? {
          id,
          kind: 'order-tie' as const,
          severity: 'info' as const,
          configs: [winner, loser],
          regions: [],
          data: { language },
        };
        if (!finding.regions.includes(outcome.key)) finding.regions.push(outcome.key);
        ties.set(id, finding);
      }
    }
  }
  findings.push(...ties.values());

  // Running A/B tests.
  for (const test of project.abTests ?? []) {
    const start = new Date(test.startDate as string).getTime();
    const end = new Date(test.endDate as string).getTime();
    if (isNaN(start) || isNaN(end) || now < start || now > end) continue;
    const where = regions.filter((r) => r.abTests.some((t) => t.testId === test.testId)).map((r) => r.key);
    findings.push({
      id: `ab-test:${test.testId}`,
      kind: 'ab-test',
      severity: 'info',
      configs: (test.variants ?? []).map((v) => v.configId),
      regions: where,
      data: { testId: test.testId, endDate: test.endDate ?? null },
    });
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Region keys of a country that a finding mentions, for highlighting. */
export const regionsOfCountry = (finding: Finding, country: string) =>
  finding.regions.filter((r) => r === country || r.startsWith(country + '-'));

export { regionKey };
