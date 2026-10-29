import type { Finding } from '../engine/diagnostics';
import type { SelectionStep } from '../engine/select';

/** Helpers the copy uses to name things in the current UI language. */
export interface CopyContext {
  /** Banner (config) display name, from its identifier. */
  config: (id: string | null | undefined) => string;
  /** Several banner names joined ("A, B and C"). */
  configs: (ids: string[]) => string;
  /** Places from region keys ("FR", "CA-QC"), compressed ("France, Belgium and 3 more"), as labels. */
  places: (keys: string[], max?: number) => string;
  /** The same, worded for the middle of a sentence ("the United States and France"). */
  placesIn: (keys: string[], max?: number) => string;
  /** One place from a region key, as a label. */
  place: (key: string) => string;
  /** One place, worded for the middle of a sentence. */
  placeIn: (key: string) => string;
  /** A region key with its name when known: "Île-de-France (FR-IDF)", else just "FR-IDF". */
  regionWithCode: (key: string) => string;
  /** A region's name alone ("Île-de-France"), when known. */
  regionName: (key: string) => string | undefined;
  country: (code: string) => string;
  /** A country name worded for the middle of a sentence ("the Netherlands"). */
  countryIn: (code: string) => string;
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
  /** A place name as it reads inside a sentence (English adds "the" to "United States"). */
  article: (name: string) => string;
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
  /** Each banner's display mode (settings.displayMode) and consent mode (settings.consentMode). */
  modes: {
    shown: string;
    hidden: string;
    optIn: string;
    optOut: string;
    shownText: string;
    hiddenText: (optOut: boolean) => string;
    optInText: string;
    optOutText: string;
    notSet: string;
    /** The setting as it reads in the project file, with the SDK's default when it's absent. */
    field: (name: string, value: string | null, fallback: string) => string;
  };
  legend: {
    intro: string;
    lists: (n: number) => string;
    listsNothing: string;
    regionsTargeted: (n: number) => string;
    wins: (countries: number, regions: number) => string;
    /** Location-based display off: a banner that isn't the default only shows when the site asks for it. */
    notDefault: (hasPageRules: boolean) => string;
    /** Location-based display off: the default banner, when the home page has a page-rule banner of its own. */
    defaultElsewhere: string;
    neverShown: string;
    fallback: string;
    abTest: string;
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
