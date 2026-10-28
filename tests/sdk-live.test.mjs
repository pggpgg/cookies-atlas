/**
 * Replays the real selection code from https://static.axept.io/sdk.js against the engine,
 * on ~100k visitor scenarios. Needs network access, so it only runs with SDK_LIVE=1:
 *
 *   SDK_LIVE=1 npx vitest run tests/sdk-live.test.mjs      (or: npm run test:live)
 *   SDK_LIVE=1 SDK_SOURCE=sdk.js npx vitest run tests/sdk-live.test.mjs   (a saved copy)
 *
 * The weekly drift workflow runs it and opens an issue if the engine and the SDK disagree.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSdkHarness } from '../scripts/sdk-drift/sdk-harness.mjs';
import { regulationFor, selectConfig } from '../src/engine/select';

const LIVE = Boolean(process.env.SDK_LIVE);
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const steps = [{ name: 'welcome', layout: 'welcome' }];
const cfg = (identifier, fields = {}) => ({ identifier, name: identifier, steps, ...fields });
const PROJECTS = {
  mackage: fixture('mackage'),
  quilicot: fixture('quilicot'),
  axeptio: fixture('axeptio'),
  mixedFields: { client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'c' } }, cookies: [cfg('a', { country: 'CA', subdivision: 'CA-QC', language: 'fr', regulation: 'loi25' }), cfg('b', { country: ['CA', 'US'], language: 'en', regulation: 'ccpa' }), cfg('c', { country: ['CA'], language: 'en', regulation: 'ccpa' }), cfg('d', { country: [' ca '], subdivision: [' ca-qc ', 'CA-ON'], language: 'EN', regulation: 'LOI25' })] },
  visibility: { client: { cookiesSettings: { geolocation: true, isBannerVisibilityEnabled: true, allowedCountries: ['FR', 'ca', 'US'] } }, cookies: [cfg('fr', { country: 'FR', language: 'fr', regulation: 'gpdr' }), cfg('us', { country: ['US', 'CA'], language: 'en', regulation: 'ccpa' })] },
  visibilityEmpty: { client: { cookiesSettings: { geolocation: true, isBannerVisibilityEnabled: true, allowedCountries: [] } }, cookies: [cfg('x', { country: 'FR' })] },
  noFallbackPages: { client: { cookiesSettings: { geolocation: true } }, cookies: [cfg('empty', { steps: [], country: 'JP' }), cfg('pg', { country: 'FR', settings: { pages: [{ url: '/en', regex: false }] } }), cfg('fr', { country: 'FR', language: 'fr' }), cfg('de', { country: 'DE', language: 'de' })] },
  badFallback: { client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'gone' } }, cookies: [cfg('a', { country: 'GB', regulation: 'uk_gdpr' }), cfg('b', { regulation: 'ccpa', language: 'en' })] },
  regulationOnly: { client: { cookiesSettings: { geolocation: true, geolocationFallbackConfigId: 'w' } }, cookies: [cfg('g-en', { regulation: 'gpdr', language: 'en' }), cfg('g-fr', { regulation: 'gpdr', language: 'fr' }), cfg('c', { regulation: 'ccpa', language: 'en' }), cfg('f', { regulation: 'fadp', language: 'de' }), cfg('w', { language: 'en' })] },
  weird: { client: { cookiesSettings: { geolocation: true } }, cookies: [cfg('dup', { country: ['CA', 'CA'], language: null }), cfg('frca', { country: 'CA', language: 'fr-CA', regulation: null }), cfg('qc', { country: 'CA', subdivision: 'QC', language: 'fr', regulation: 'loi25' }), cfg('num', { country: ['US', ''], language: '', regulation: 'gpp' })] },
  geoOffPages: { client: {}, cookies: [cfg('home', { settings: { pages: [{ url: '/', regex: false }] } }), cfg('en', { settings: { pages: [{ url: '^/en(/|$)', regex: true }] } }), cfg('any'), cfg('fr', { settings: { pages: [{ url: '/fr' }] } })] },
  geoOffNoSteps: { cookies: [cfg('nosteps', { steps: [] }), cfg('second')] },
};
const forceOn = (p) => ({ ...p, client: { ...(p.client ?? {}), cookiesSettings: { ...(p.client?.cookiesSettings ?? {}), geolocation: true } } });

const ISO = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK'.split(' ');
const CA = 'AB BC MB NB NL NS NT NU ON PE QC SK YT qc'.split(' ');
const US = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(' ');
const REGIONS = [
  ...ISO.map((c) => [c, 'Unknown']),
  ...CA.map((r) => ['CA', r]),
  ...US.map((r) => ['US', r]),
  ['FR', 'IDF'], ['GB', 'ENG'], ['JP', '13'], ['Unknown', 'Unknown'], ['fr', 'Unknown'], ['ca', 'qc'], [undefined, undefined],
];
const BROWSERS = ['en-US', 'fr-CA', 'fr', 'de-DE', 'pt-BR', 'es', 'it-IT', 'nl', 'EN', 'zz', '', undefined];

function* scenarios() {
  for (const [country, sub] of REGIONS) for (const browser of BROWSERS) yield { countryCode: country, subdivisionCode: sub, browserLanguage: browser };
  for (const [country, sub] of [...REGIONS.slice(0, 60), ...REGIONS.slice(250, 275)]) {
    for (const html of ['', 'fr', 'en-GB', 'pt']) yield { countryCode: country, subdivisionCode: sub, browserLanguage: 'de-DE', documentLanguage: html, useDocumentLang: true };
    for (const cookiesVersion of ['axeptio-prod-fr', 'CA-QC FR', 'en', 'missing', 'fr-ca-qc-04-10-2024'])
      for (const pagePath of ['/', '/en/x', '/fr', '/shop/fr/items', '/eng'])
        yield { countryCode: country, subdivisionCode: sub, browserLanguage: 'en-US', cookiesVersion, pagePath };
  }
}

describe.skipIf(!LIVE)('engine vs the live sdk.js', () => {
  let sdk;
  it('loads the selection code from the CDN', async () => {
    // SDK_SOURCE=path/to/sdk.js replays a saved copy instead (offline debugging).
    if (process.env.SDK_SOURCE) {
      sdk = buildSdkHarness(fs.readFileSync(process.env.SDK_SOURCE, 'utf8'));
      return;
    }
    const res = await fetch('https://static.axept.io/sdk.js');
    expect(res.ok).toBe(true);
    sdk = buildSdkHarness(await res.text());
  });

  it('agrees with the SDK on the regulation of every region', () => {
    const mismatches = [];
    for (const [country, sub] of REGIONS)
      for (const c of [country, country?.toUpperCase()])
        for (const r of [sub, sub?.toUpperCase(), undefined]) {
          const expected = sdk.regulationFor(c, r);
          if (regulationFor(c, r) !== expected) mismatches.push({ c, r, expected, got: regulationFor(c, r) });
        }
    expect(mismatches).toEqual([]);
  });

  for (const [name, project] of Object.entries(PROJECTS)) {
    it(`picks the same banner as the SDK: ${name}`, () => {
      const geoOn = Boolean(project.client?.cookiesSettings?.geolocation);
      const mismatches = [];
      let count = 0;
      for (const force of geoOn ? [false] : [false, true]) {
        for (const visitor of scenarios()) {
          count++;
          const expected = sdk.select(force ? forceOn(project) : project, visitor);
          const mine = selectConfig(project, visitor, { forceGeolocation: force });
          const got = { id: mine.config?.identifier ?? null, isFallback: mine.isFallback };
          if (got.id !== expected.id || got.isFallback !== expected.isFallback) {
            if (mismatches.length < 10) mismatches.push({ force, visitor, expected, got });
          }
        }
      }
      expect(count).toBeGreaterThan(4000);
      expect(mismatches).toEqual([]);
    });
  }
});
