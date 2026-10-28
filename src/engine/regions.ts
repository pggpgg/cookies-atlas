/**
 * The region table hardcoded in Axeptio's sdk.js (the `countries` / `subdivisions`
 * object next to the selection helpers). It maps a visitor's country (and region)
 * to the regulation the SDK prefers when several configurations compete.
 *
 * Copied from https://static.axept.io/sdk.js on 2026-10-28.
 * tests/regions.test.ts fails if this drifts from sdk-snapshot/snapshot.json, and the
 * weekly "SDK drift check" workflow opens an issue when the live SDK changes.
 *
 * Quirks kept on purpose (they are the SDK's behavior, not ours):
 * - IS and LI are NOT in the EU list, while NO, MK, RS, BA and RU are.
 * - The enum value for GDPR is spelled "gpdr".
 */

export const REGULATIONS = {
  Gpdr: 'gpdr',
  UkGdpr: 'uk_gdpr',
  Fadp: 'fadp',
  Ccpa: 'ccpa',
  Gpp: 'gpp',
  Lgpd: 'lgpd',
  Loi25: 'loi25',
} as const;

export type KnownRegulation = (typeof REGULATIONS)[keyof typeof REGULATIONS];

export interface CountryRegion {
  internalIsoCode: string;
  isoCodes: string[];
  regulation: KnownRegulation;
}

export interface SubdivisionRegion {
  internalIsoCode: string;
  countryIsoCode: string;
  isoCodes: string[];
  regulation: KnownRegulation;
}

export const REGION_TABLE: { countries: CountryRegion[]; subdivisions: SubdivisionRegion[] } = {
  countries: [
    {
      internalIsoCode: 'EU',
      isoCodes: [
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'NL', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
        'LV', 'LT', 'LU', 'MT', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'MK', 'RS', 'BA', 'RU',
      ],
      regulation: 'gpdr',
    },
    { internalIsoCode: 'GB', isoCodes: ['GB'], regulation: 'uk_gdpr' },
    { internalIsoCode: 'CH', isoCodes: ['CH'], regulation: 'fadp' },
    { internalIsoCode: 'US', isoCodes: ['US'], regulation: 'ccpa' },
    { internalIsoCode: 'BR', isoCodes: ['BR'], regulation: 'lgpd' },
    { internalIsoCode: 'CA', isoCodes: ['CA'], regulation: 'ccpa' },
  ],
  subdivisions: [
    { internalIsoCode: 'CA-QC', countryIsoCode: 'CA', isoCodes: ['CA-QC'], regulation: 'loi25' },
    {
      internalIsoCode: 'US-CCPA',
      countryIsoCode: 'US',
      isoCodes: [
        'US-CA', 'US-CO', 'US-CT', 'US-DE', 'US-IA', 'US-IN', 'US-MT', 'US-NJ', 'US-OR', 'US-TN', 'US-TX',
        'US-UT', 'US-VA',
      ],
      regulation: 'ccpa',
    },
    {
      internalIsoCode: 'US-GPP',
      countryIsoCode: 'US',
      isoCodes: [
        'US-AL', 'US-AK', 'US-AZ', 'US-AR', 'US-FL', 'US-GA', 'US-HI', 'US-ID', 'US-IL', 'US-KS', 'US-KY',
        'US-LA', 'US-ME', 'US-MD', 'US-MA', 'US-MI', 'US-MN', 'US-MS', 'US-MO', 'US-NE', 'US-NV', 'US-NH',
        'US-NM', 'US-NY', 'US-NC', 'US-ND', 'US-OH', 'US-OK', 'US-PA', 'US-RI', 'US-SC', 'US-SD', 'US-VT',
        'US-WA', 'US-WV', 'US-WI', 'US-WY', 'US-DC', 'US-AS', 'US-GU', 'US-MP', 'US-PR', 'US-UM', 'US-VI',
      ],
      regulation: 'gpp',
    },
  ],
};

/** Regulations whose banners must collect consent before tracking (opt-in). */
export const OPT_IN_REGULATIONS: ReadonlySet<string> = new Set(['gpdr', 'uk_gdpr', 'fadp', 'lgpd', 'loi25']);

/** Regulations whose banners let tracking run until the visitor opts out. */
export const OPT_OUT_REGULATIONS: ReadonlySet<string> = new Set(['ccpa', 'gpp']);

/** Subdivision codes (without country prefix) the SDK table knows for a country, e.g. CA → ["QC"]. */
export function tableSubdivisionsOf(country: string): string[] {
  const out: string[] = [];
  for (const sub of REGION_TABLE.subdivisions) {
    for (const code of sub.isoCodes) {
      if (code.startsWith(country + '-')) out.push(code.slice(country.length + 1));
    }
  }
  return out;
}
