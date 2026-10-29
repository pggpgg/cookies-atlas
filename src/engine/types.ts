/**
 * Shapes of the public project file served by
 * https://client.axept.io/projectconfigurations/brands/{projectId}.json
 * Only the fields Cookies Atlas reads are typed; everything else passes through.
 */

/** Axeptio stores country and subdivision either as a string or as a list. */
export type StringOrList = string | string[] | null | undefined;

export interface PageRule {
  url?: string | null;
  regex?: boolean | null;
  [key: string]: unknown;
}

/** One entry of `cookies[]`: a cookie configuration ("banner"). */
export interface AxeptioConfig {
  identifier: string;
  name?: string;
  title?: string;
  language?: string | null;
  country?: StringOrList;
  subdivision?: StringOrList;
  regulation?: string | null;
  isLive?: boolean | null;
  published?: boolean | null;
  partOfABTest?: boolean | null;
  steps?: unknown[] | null;
  settings?: {
    pages?: PageRule[] | null;
    /** "show" or "hide": whether the banner opens by itself. */
    displayMode?: string | null;
    /** "opt_in" or "opt_out": whether vendors wait for consent or are accepted on arrival. */
    consentMode?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** `client.cookiesSettings`: absent when location-based display was never enabled. */
export interface CookiesSettings {
  geolocation?: boolean | null;
  geolocationFallbackConfigId?: string | null;
  isBannerVisibilityEnabled?: boolean | null;
  allowedCountries?: string[] | null;
  [key: string]: unknown;
}

export interface ABTestVariant {
  configId: string;
  [key: string]: unknown;
}

/** Top-level `abTests[]` (not present on most projects). */
export interface ABTest {
  testId: string;
  variants?: ABTestVariant[] | null;
  startDate?: string | null;
  endDate?: string | null;
  country?: string | null;
  regulation?: string | null;
  language?: string | null;
  [key: string]: unknown;
}

export interface AxeptioProject {
  projectId?: string;
  projectName?: string;
  publishedAt?: string;
  client?: { cookiesSettings?: CookiesSettings | null; [key: string]: unknown } | null;
  cookies?: AxeptioConfig[] | null;
  abTests?: ABTest[] | null;
  [key: string]: unknown;
}
