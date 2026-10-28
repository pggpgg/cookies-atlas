/**
 * Findings about a project's geolocation setup. Everything engine-related is derived from an
 * Evaluation (the same one the map paints), so findings always agree with the map.
 * Wording lives in src/i18n: a finding only carries its kind, severity and data.
 */
import {
  countriesOf,
  OTHER_LANGUAGE,
  regionKey,
  reportedInstead,
  subdivisionsOf,
  type Evaluation,
  type RegionOutcome,
  type ReportedAs,
} from './evaluate';
import { COUNTRY_CODE_FIXES, ISO_3166_1 } from './iso-3166';
import { OPT_IN_REGULATIONS, OPT_OUT_REGULATIONS, REGULATIONS } from './regions';
import { langKey, pageMatches, sameRegulation, type Selection, type TraceEntry } from './select';
import type { AxeptioConfig, AxeptioProject, PageRule } from './types';

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
  | 'unreachable-subdivision'
  | 'unknown-country'
  | 'unknown-regulation'
  | 'invalid-page-rule'
  | 'ab-test';

/** Why a config loses where it should win. */
export type LossReason = 'order' | 'specificity' | 'regulation' | 'untargeted' | 'unreachable' | 'unknown';

/** A region code a config targets that no visitor is ever reported in. */
export interface UnreachableTarget {
  value: string;
  instead: ReportedAs;
}

/** How a banner's regulation relates to consent: opt-in laws, opt-out laws, none set, or a value the SDK doesn't know. */
export type RegulationKind = 'opt-in' | 'opt-out' | 'none' | 'unknown';

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

/**
 * What a config is meant to cover: its countries, and the regions it targets that a visitor can be
 * reported in (normalized when possible; "FR-75" is left out, see the unreachable-subdivision finding).
 */
export function intentOf(config: AxeptioConfig): { subdivisions: string[]; countries: string[] } {
  const countries = countriesOf(config);
  const single = new Set(countries).size === 1 ? countries[0] : undefined;
  const subdivisions = subdivisionsOf(config)
    .map((s) => (isWellFormedSubdivision(s) ? s : single && /^[A-Z0-9]{1,3}$/.test(s) ? `${single}-${s}` : null))
    .filter((s): s is string => s !== null && !reportedInstead(s));
  return { subdivisions, countries };
}

/** A config's page rules, read like the SDK does: only a list counts. */
const pageRulesOf = (config: AxeptioConfig): PageRule[] => (Array.isArray(config.settings?.pages) ? config.settings!.pages! : []);
const hasPageRules = (config: AxeptioConfig) => pageRulesOf(config).length > 0;

/**
 * The banner the SDK serves when location doesn't decide and the site pins nothing, on pages no
 * page rule matches: the first banner with steps and no page rules.
 */
export function nonGeoDefaultOf(project: AxeptioProject): string | null {
  return (project.cookies ?? []).find((c) => Array.isArray(c.steps) && c.steps.length > 0 && !hasPageRules(c))?.identifier ?? null;
}

export function regulationKind(value: unknown): RegulationKind {
  if (typeof value !== 'string' || !value) return 'none';
  const v = value.toLowerCase();
  return OPT_IN_REGULATIONS.has(v) ? 'opt-in' : OPT_OUT_REGULATIONS.has(v) ? 'opt-out' : 'unknown';
}

/** Region codes a config targets that the CDN never reports (well-formed ones; malformed ones get their own finding). */
export function unreachableTargetsOf(config: AxeptioConfig): UnreachableTarget[] {
  return subdivisionsOf(config)
    .filter(isWellFormedSubdivision)
    .flatMap((value) => {
      const instead = reportedInstead(value);
      return instead ? [{ value, instead }] : [];
    });
}

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
    // What visitors get today when the site pins nothing, on pages no page rule matches.
    const today = nonGeoDefaultOf(project);
    findings.push({
      id: 'geolocation-off',
      kind: 'geolocation-off',
      severity: 'warning',
      configs: today ? [today] : [],
      regions: [],
      data: { defaultConfig: today, configCount: configs.length, hasPageRules: configs.some(hasPageRules) },
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
  const unreachableByConfig = new Map<string, UnreachableTarget[]>();
  for (const config of configs) {
    const subs = subdivisionsOf(config);
    const malformed = subs.filter((s) => !isWellFormedSubdivision(s));
    if (malformed.length > 0) {
      const countries = countriesOf(config);
      const single = new Set(countries).size === 1 ? countries[0] : undefined;
      const suggestions = malformed.map((v) => {
        if (!single || !ISO_3166_1.has(single) || !/^[A-Z0-9]{1,3}$/.test(v)) return null;
        // Suggest the code visitors are reported with: "75" on a French banner means Île-de-France.
        const instead = reportedInstead(`${single}-${v}`);
        return instead ? (instead.level === 'region' ? instead.key : null) : `${single}-${v}`;
      });
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

    const unreachable = unreachableTargetsOf(config);
    if (unreachable.length > 0) unreachableByConfig.set(config.identifier, unreachable);

    for (const rule of pageRulesOf(config)) {
      if (pageMatches(rule, '/') !== null) continue;
      const isObject = Boolean(rule) && typeof rule === 'object';
      const url = isObject && rule.url != null ? String(rule.url) : '';
      // A text URL with the regex option is a broken pattern; anything else is a malformed rule.
      const problem = isObject && rule.regex && typeof rule.url === 'string' ? 'regex' : 'malformed';
      const id = `invalid-page-rule:${config.identifier}:${problem}:${url}`;
      if (findings.some((f) => f.id === id)) continue;
      findings.push({ id, kind: 'invalid-page-rule', severity: 'warning', configs: [config.identifier], regions: [], data: { url, problem } });
    }
  }

  // --- Engine-backed findings ----------------------------------------------------------------

  // Over-capture: region-targeted configs that also win elsewhere in their region's country,
  // through the country match. Grouped by country, since configs for the same region share the cause.
  const overCaptured = new Set<string>(); // "configId|regionKey"
  const explainedShadow = new Set<string>(); // "configId|regionKey" losses an over-capture finding explains
  interface CaptureGroup {
    country: string;
    capturing: string[];
    regions: Set<string>;
    intended: Set<string>;
    step: string;
    regulation: string | undefined;
    /** Regulations of every captured place (US states differ from the rest of the US). */
    regulations: Set<string>;
  }
  const captureGroups = new Map<string, CaptureGroup>();
  for (const config of configs) {
    const intent = intentOf(config);
    if (intent.subdivisions.length === 0) continue;
    for (const key of evaluation.wins.get(config.identifier) ?? []) {
      if (intent.subdivisions.includes(key)) continue;
      const outcome = evaluation.regions.get(key)!;
      if (outcome.step !== 'single-country' && outcome.step !== 'multi-country') continue;
      // Only countries the config targets a region of: winning in another listed country is intended.
      const intendedHere = intent.subdivisions.filter((sub) => sub.startsWith(outcome.country + '-'));
      if (intendedHere.length === 0) continue;
      const group: CaptureGroup = captureGroups.get(outcome.country) ?? {
        country: outcome.country,
        capturing: [],
        regions: new Set(),
        intended: new Set(),
        step: outcome.step,
        regulation: outcome.regulation,
        regulations: new Set(),
      };
      if (!group.capturing.includes(config.identifier)) group.capturing.push(config.identifier);
      group.regions.add(key);
      if (outcome.regulation) group.regulations.add(outcome.regulation);
      for (const sub of intendedHere) group.intended.add(sub);
      // The rest of the country decides the step and regulation shown in the explanation.
      if (outcome.subdivision === null) {
        group.step = outcome.step;
        group.regulation = outcome.regulation;
      }
      captureGroups.set(outcome.country, group);
      overCaptured.add(`${config.identifier}|${key}`);
    }
  }
  for (const group of captureGroups.values()) {
    const single = group.step === 'single-country';
    // At the single-country step, a config listing the country among others, with the regulation
    // of the rest of the country, loses only because the capturing ones are checked first.
    const competitor = single
      ? configs.find(
          (c) =>
            !group.capturing.includes(c.identifier) &&
            countriesOf(c).includes(group.country) &&
            new Set(countriesOf(c)).size > 1 &&
            sameRegulation(c.regulation, group.regulation),
        )
      : undefined;
    // A new single-country banner only wins the regulation preference where its regulation differs
    // from the capturing banners'. Where they share it (or there's none), language then list order decide.
    const tie =
      single &&
      [...group.regions].some((key) => {
        const R = evaluation.regions.get(key)!.regulation;
        return !R || group.capturing.some((id) => sameRegulation(byId.get(id)?.regulation, R));
      });
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
        // The rest of the country's regulation first.
        regulations: [...group.regulations].sort((a, b) => (a === group.regulation ? -1 : b === group.regulation ? 1 : a.localeCompare(b))),
        capturing: group.capturing,
        competitor: competitor?.identifier ?? null,
        tie,
      },
    });
  }

  const abVariants = new Set((project.abTests ?? []).flatMap((t) => (t.variants ?? []).map((v) => v.configId)));
  const dead = new Set<string>();
  // Region keys where each config is shadowed (reported by shadowed-listing).
  const shadowedIn = new Map<string, Set<string>>();
  const shadowGroups = new Map<string, Finding>();

  const mergedUnreachable = new Set<string>(); // configs whose dead-config finding explains their unreachable regions
  for (const config of configs) {
    const wins = evaluation.wins.get(config.identifier) ?? new Set();
    const intent = intentOf(config);
    // Where the config is meant to win: its regions, and the countries it lists for themselves
    // (a country listed next to one of its regions only accompanies that region).
    const regionCountries = new Set(intent.subdivisions.map((s) => s.slice(0, 2)));
    const homes = [...intent.subdivisions, ...intent.countries.filter((c) => ISO_3166_1.has(c) && !regionCountries.has(c))];
    const language = languageOf(config, evaluation);

    if (wins.size === 0) {
      if (config.partOfABTest || abVariants.has(config.identifier)) continue;
      dead.add(config.identifier);
      // Prefer a place it targets; else a country it lists next to a region it targets.
      const home =
        homes.find((h) => evaluation.regions.has(h)) ?? intent.countries.find((c) => regionCountries.has(c) && evaluation.regions.has(c));
      const outcome = home ? evaluation.regions.get(home) : undefined;
      const unreachable = unreachableByConfig.get(config.identifier) ?? [];
      const why: { reason: LossReason; by?: string } = outcome
        ? lossReason(selectionAt(outcome, language), config.identifier, configs)
        : { reason: unreachable.length > 0 ? 'unreachable' : 'untargeted' };
      if (why.reason === 'unreachable') mergedUnreachable.add(config.identifier);
      findings.push({
        id: `dead-config:${config.identifier}`,
        kind: 'dead-config',
        severity: hasPageRules(config) ? 'info' : 'warning',
        configs: why.by ? [config.identifier, why.by] : [config.identifier],
        regions: home ? [home] : why.reason === 'unreachable' ? unreachable.map((u) => u.instead.key) : [],
        data: {
          reason: why.reason,
          by: why.by ?? null,
          home: home ?? null,
          language,
          hasPageRules: hasPageRules(config),
          ...(why.reason === 'unreachable' ? { unreachable } : {}),
        },
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

  // Region codes no visitor is ever reported in (unless a dead-config finding already explains them).
  // Configs with the same codes share one finding.
  const unreachableGroups = new Map<string, Finding>();
  for (const [configId, unreachable] of unreachableByConfig) {
    if (mergedUnreachable.has(configId)) continue;
    const id = `unreachable-subdivision:${unreachable.map((u) => u.value).join(',')}`;
    const existing = unreachableGroups.get(id);
    if (existing) existing.configs.push(configId);
    else
      unreachableGroups.set(id, {
        id,
        kind: 'unreachable-subdivision',
        severity: 'warning',
        configs: [configId],
        regions: [...new Set(unreachable.map((u) => u.instead.key))],
        data: { unreachable },
      });
  }
  findings.push(...unreachableGroups.values());

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
      const theirs = typeof winner.regulation === 'string' && winner.regulation ? winner.regulation.toLowerCase() : null;
      const configKind = regulationKind(theirs);
      // Consent-first places served a banner that isn't an opt-in one: opt-out, or no (known) regulation.
      const severity: Severity = OPT_IN_REGULATIONS.has(R) && configKind !== 'opt-in' ? 'error' : 'info';
      const targeted = !UNMATCHED_STEPS.has(outcome.step);
      const id = `regulation-mismatch:${severity}:${theirs ?? 'none'}:${targeted ? 'targeted' : 'untargeted'}`;
      const finding: Finding = mismatches.get(id) ?? {
        id,
        kind: 'regulation-mismatch',
        severity,
        configs: [],
        regions: [],
        data: { regulations: [] as string[], configRegulation: theirs, configKind, targeted, languages: [] as string[], steps: [] as string[] },
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
