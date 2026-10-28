import type { Finding } from '../engine/diagnostics';
import type { SelectionStep } from '../engine/select';

/** Helpers the copy uses to name things in the current UI language. */
export interface CopyContext {
  /** Banner (config) display name, from its identifier. */
  config: (id: string | null | undefined) => string;
  /** Several banner names joined ("A, B and C"). */
  configs: (ids: string[]) => string;
  /** Places from region keys ("FR", "CA-QC"), compressed ("France, Belgium and 3 more"). */
  places: (keys: string[], max?: number) => string;
  /** One place from a region key. */
  place: (key: string) => string;
  country: (code: string) => string;
  regulation: (value: string | null | undefined) => string;
  regulations: (values: string[]) => string;
  language: (key: string | null | undefined) => string;
  step: (step: SelectionStep) => string;
  list: (items: string[]) => string;
  date: (iso: string | null | undefined) => string;
}

export interface FindingCopy {
  title: string;
  mechanism: string;
  fix?: string;
}

export interface Messages {
  locale: string;
  app: { title: string; tagline: string; sourceNote: string; repo: string; sdkDate: (date: string) => string };
  input: {
    label: string;
    placeholder: string;
    submit: string;
    invalid: string;
    recent: string;
    example: string;
    clearRecent: string;
  };
  load: { loading: string; notFound: string; network: string; invalid: string; empty: string; retry: string };
  theme: { label: string; light: string; dark: string; system: string };
  uiLanguage: string;
  summary: {
    published: (date: string) => string;
    geoOn: string;
    geoOff: string;
    fallback: (name: string) => string;
    noFallback: string;
    banners: (n: number) => string;
    visibility: (n: number) => string;
    you: string;
    youGet: (place: string, banner: string) => string;
    youNoBanner: (place: string) => string;
    youUnknown: string;
    copyId: string;
    copied: string;
    openAdmin: string;
  };
  geoOff: {
    title: string;
    body: (banner: string, hasPageRules: boolean) => string;
    preview: string;
    today: string;
    fix: string;
  };
  map: {
    title: string;
    language: string;
    allLanguages: string;
    otherLanguages: string;
    reset: string;
    zoomIn: string;
    zoomOut: string;
    export: string;
    exporting: string;
    copyLink: string;
    linkCopied: string;
    ariaLabel: (project: string) => string;
    previewBadge: string;
    todayBadge: string;
    keyTitle: string;
    keySolid: string;
    keyLight: string;
    keyStriped: string;
    keyNone: string;
    keyYou: string;
    clickHint: string;
    noRegulation: string;
    howLabel: string;
    abNote: (testId: string) => string;
    youAreHere: string;
    rest: (country: string) => string;
  };
  tabs: { banners: string; simulator: string; diagnostics: string; table: string };
  legend: {
    intro: string;
    lists: (n: number) => string;
    listsNothing: string;
    regionsTargeted: (n: number) => string;
    wins: (countries: number, regions: number) => string;
    neverShown: string;
    fallback: string;
    abTest: string;
    otherBanners: (n: number) => string;
    isolate: string;
    clearIsolation: string;
    noBanner: string;
    admin: string;
  };
  simulator: {
    intro: string;
    region: string;
    country: string;
    subregion: string;
    anyRegion: string;
    loadingRegions: string;
    browserLanguage: string;
    pageLanguage: string;
    logic: string;
    logicBrowser: string;
    logicHtml: string;
    logicHint: string;
    siteSettings: string;
    cookiesVersion: string;
    cookiesVersionHint: string;
    pagePath: string;
    pagePathHint: string;
    result: string;
    resultNone: string;
    resultHidden: string;
    viaFallback: string;
    why: string;
    copyScenario: string;
    pickRegion: string;
    unknownCountry: string;
  };
  trace: {
    language: (source: 'browser' | 'document', raw: string | null, key: string | undefined) => string;
    regulation: (place: string, regulation: string | undefined, c: CopyContext) => string;
    visibility: (allowed: string[], passed: boolean, c: CopyContext) => string;
    geolocation: (enabled: boolean, forced: boolean) => string;
    candidates: (
      entry: {
        step: 'subdivision' | 'single-country' | 'multi-country' | 'regulation';
        key: string | undefined;
        matched: string[];
        preferred: string[];
        regulationApplied: boolean;
        winner?: string;
        tieBreak?: { language: string | undefined; languageMatches: string[]; byOrder: boolean };
      },
      regulation: string | undefined,
      c: CopyContext,
    ) => string;
    stop: string;
    fallback: (configId: string | null, found: boolean, c: CopyContext) => string;
    nonGeo: (
      entry: {
        cookiesVersion: string | null;
        cookiesVersionMatched: boolean;
        pagePath: string;
        pageMatched: string[];
        excludedByPages: string[];
        strategy?: 'cookiesVersion' | 'page' | 'default';
        winner?: string;
      },
      c: CopyContext,
    ) => string;
    abTest: (testId: string, variants: string[], c: CopyContext) => string;
  };
  steps: Record<SelectionStep, string>;
  regulations: Record<string, string>;
  diagnostics: {
    intro: string;
    previewNote: string;
    none: string;
    severity: { error: string; warning: string; info: string };
    why: string;
    fix: string;
    showOnMap: string;
    finding: (finding: Finding, c: CopyContext) => FindingCopy;
  };
  table: {
    intro: string;
    filter: string;
    place: string;
    regulation: string;
    how: string;
    banner: string;
    none: string;
    rows: (n: number) => string;
  };
  bookmarklet: { title: string; body: string; linkLabel: string; notFound: string };
  empty: { title: string; body: string; steps: string[] };
  footer: { disclaimer: string };
}
