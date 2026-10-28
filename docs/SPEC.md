# Cookies Atlas: build spec

A web app where you paste an Axeptio project ID and see, on a world map, which cookie configuration (banner) the Axeptio SDK serves in each country and region, why, and what's misconfigured.

Owner: Pierre Gagnon-Gingras (CSM, Axeptio). Research and interview done 2026-10-28. Everything under "Verified facts" was checked against live data that day.

---

## 1. Decisions (from the interview)

| Topic | Decision |
|---|---|
| Name | **Cookies Atlas** (repo `pggpgg/cookies-atlas`, public) |
| Audience | Internal CS team first, but clients will receive links to their own map, so the app needs to explain itself |
| Hosting | GitHub Pages, deployed by a GitHub Actions workflow. The repo is attached to the build session |
| UI language | FR/EN toggle (Québécois French). Keep tech terms in English: config, fallback, tie-break, match, override. Default to the browser language |
| Look | Mix of Axeptio brand and debugger style (consent.help vibe): dense, data-first, light and dark modes, Axeptio fonts and colors |
| Map detail | Countries **plus any subdivision**: CA provinces and US states always split; any other country gets split when a config targets one of its subdivisions |
| Language ties | Hatched countries when the winner depends on language, a language picker that recolors the map with the exact winner, and a **scenario simulator** (region + browser language + html lang + language-logic toggle: browser vs `useDocumentLang`) |
| Geolocation OFF | Show a loud warning, say what actually happens today, then **simulate the map as if location-based display were ON** |
| Diagnostics | All four: dead configs, over-capture, regulation mismatch, overlaps and ambiguity. Tone: **explain the mechanism + give the exact fix** |
| Extras (v1) | Shareable links, "You are here" pin, PNG export, weekly SDK drift check (GitHub Action) |
| Input | Project ID field (with recent IDs saved in localStorage) + **bookmarklet** that reads the ID on any client site and opens the atlas |
| Admin links | Hidden by default, shown with `?internal=1` |
| Acceptance tests | Mackage, Bicycles Quilicot, Axeptio's own site (details in section 8) |

---

## 2. Verified facts: data source

**Endpoint (public, no auth):**
```
GET https://client.axept.io/projectconfigurations/brands/{projectId}.json
```
- CORS is open to any origin (tested from example.com). A static page can fetch it directly.
- The response carries the visitor's geolocation in headers that JS can read: `X-Viewer-Country` (e.g. `CA`) and `X-Viewer-Country-Region` (e.g. `QC`). The SDK reads exactly these and defaults to `"Unknown"` when they're missing. Use them for the "You are here" pin.
- It only contains **published** state, not drafts.
- Handle errors: invalid ID / unpublished project (4xx), network failure, malformed JSON.

**Useful shape (only the fields we need):**
```jsonc
{
  "projectId": "…", "projectName": "…", "publishedAt": "…",
  "client": {
    // ABSENT when location-based display was never enabled => treat as geolocation OFF
    "cookiesSettings": {
      "geolocation": true,
      "geolocationFallbackConfigId": "6913a674b1b71620d7b06fb7",
      "isBannerVisibilityEnabled": false,   // optional
      "allowedCountries": ["CA", "US"]      // optional
    }
  },
  "cookies": [   // the configurations ("banners"), ARRAY ORDER MATTERS for tie-breaks
    {
      "identifier": "…",          // config ID (used by fallback + admin links)
      "name": "CA-QC FR",         // also what cookiesVersion matches against
      "title": "…",
      "language": "fr",
      "country": ["CA"],          // string OR array of ISO-3166-1 alpha-2
      "subdivision": ["CA-QC"],   // string OR array OR null; SDK expects "CC-SS" format
      "regulation": "loi25",      // seen: "gpdr" (sic), "uk_gdpr", "ccpa", "loi25"
      "isLive": true, "published": true, "partOfABTest": false,
      "steps": [ … ],             // non-empty required for the non-geo path
      "settings": { "pages": [ … ], … }
    }
  ]
}
```
Legacy data exists: Quilicot's configs store `subdivision: "QC"` (not `"CA-QC"`) and `country: "CA"` as a plain string. Support both shapes.

**Regulation enum:** the exact strings for FADP, LGPD and GPP weren't confirmed yet. Read them from the `Nn.g` enum in sdk.js (see section 3) before coding the region table.

**Admin URLs (for `?internal=1`):**
- Config: `https://admin.axeptio.eu/projects/{projectId}/cookies/{configIdentifier}`
- Project banners list (the "Location-based display" toggle lives there): `https://admin.axeptio.eu/projects/{projectId}/cookies`

---

## 3. Verified facts: how sdk.js picks a configuration

Source: `https://static.axept.io/sdk.js` (minified, ~727 KB), method `getCookiesConfig()`. Reproduce this **exactly** in a pure, unit-tested module (`src/engine/select.ts`). Inputs: project JSON, country code, subdivision code, browser language, html lang, `useDocumentLang`, `cookiesVersion`.

### 3.1 Helpers
- `langKey(x)` = first 2 chars of x, lowercased.
- `visitorLang` = `useDocumentLang ? document.documentElement.lang : navigator.language` → `langKey`.
- `byLang(list, key)` = first config in `list` whose `langKey(language) === key`, else `list[0]`. **Uses JSON array order.**
- `preferReg(list, R)` = if `R` is undefined, return `list`. Otherwise the configs whose `regulation` equals `R` (case-insensitive), or the whole `list` if none match.
- `regulationFor(country, sub)`: if `country-sub` is in a subdivision entry of the SDK table, return that regulation. Otherwise return the regulation of the country entry whose `isoCodes` include `country`. Otherwise undefined.

### 3.2 SDK region table (copied 2026-10-28; keep in one file: `src/engine/regions.ts`)
```
countries:
  EU  -> gdpr  : AT BE BG HR CY CZ DK NL EE FI FR DE GR HU IE IT LV LT LU MT PL PT RO SK SI ES SE NO MK RS BA RU
  GB  -> uk_gdpr
  CH  -> fadp
  US  -> ccpa
  BR  -> lgpd
  CA  -> ccpa
subdivisions:
  CA-QC   -> loi25
  US-CCPA -> ccpa : US-CA US-CO US-CT US-DE US-IA US-IN US-MT US-NJ US-OR US-TN US-TX US-UT US-VA
  US-GPP  -> gpp  : US-AL US-AK US-AZ US-AR US-FL US-GA US-HI US-ID US-IL US-KS US-KY US-LA US-ME US-MD
                    US-MA US-MI US-MN US-MS US-MO US-NE US-NV US-NH US-NM US-NY US-NC US-ND US-OH US-OK
                    US-PA US-RI US-SC US-SD US-VT US-WA US-WV US-WI US-WY US-DC US-AS US-GU US-MP US-PR
                    US-UM US-VI
```
Quirks to keep: IS and LI are NOT in the SDK's EU list (so they get no regulation). NO, MK, RS, BA, RU are.

### 3.3 Decision order
0. **Banner visibility gate.** If `cookiesSettings.isBannerVisibilityEnabled`: build `allowed = allowedCountries` uppercased. If `allowed` is empty → no banner anywhere. If the visitor country is missing/`UNKNOWN` or not in `allowed` → **no banner**.
1. **If `cookiesSettings.geolocation` is true:** `R = regulationFor(country, sub)`, then:
   - a. **Subdivision match.** Configs whose `subdivision` (string or array, trimmed, uppercased) equals `"{COUNTRY}-{SUB}"`. Requires both codes, neither `UNKNOWN`. `preferReg(…, R)` → 1 result: pick it; more than one: `byLang`.
   - b. **Single-country match.** Configs whose `country` includes the visitor's country AND list exactly one distinct country. `preferReg`, then pick or `byLang`.
   - c. **Any country match.** All configs whose `country` includes the visitor's country. `preferReg`, then pick or `byLang`.
   - d. If `R` is undefined → no geo match.
   - e. **Regulation match.** Configs with `regulation == R`. 0 → no match; 1 → it; more → `byLang`.
   - f. No geo match → config whose `identifier === geolocationFallbackConfigId` (SDK flags `isFallback = true`).
2. **If still nothing** (geo OFF, or geo found nothing and there's no fallback):
   - If the site sets `cookiesVersion` and a config has `name === cookiesVersion` → it (strategy `"cookiesVersion"`).
   - Else eligible = configs with non-empty `steps`. A config with non-empty `settings.pages` is eligible only if a page rule matches the current page; such matches win (strategy `"page"`). Otherwise the first eligible config (strategy `"default"`).
   - **No language matching on this path.** With geo OFF and no `cookiesVersion`, everyone gets the first config.
3. **A/B tests:** `resolveABTestFor(...)` can swap the result for a variant (`partOfABTest`, `activeABTest`). Investigate where the A/B test definitions live in the JSON. v1: show an "A/B test: variants X / Y" note instead of simulating the split.
4. `_applyPostSelectionTransforms(...)` runs last. Read it and confirm it doesn't change *which* config wins.

The engine returns `{config | null, step: 'visibility'|'subdivision'|'single-country'|'multi-country'|'regulation'|'fallback'|'cookiesVersion'|'page'|'default'|'none', regulation: R, trace: [...]}`. The trace feeds the simulator's step-by-step explanation.

### 3.4 How to read sdk.js from the build session
The cloud sandbox **cannot** reach `*.axept.io` (the proxy returns 403). npm and raw.githubusercontent.com do work. To inspect sdk.js or project JSONs, use Claude in Chrome: open a tab on any site (example.com works) and `fetch()` from `javascript_tool`. The extension blocks output containing cookie-like strings or base64. Work around it by replacing `cookie` with `CK` and `=` with ` EQ ` before returning, and by reading in slices of ~400 chars. Anchors that work: `indexOf('getCookiesConfig(){')` and `indexOf('subdivisions:[{internalIsoCode')`.

---

## 4. Evaluating the whole map

For every map feature (country, or subdivision when the country is split), run the engine once per candidate language:
- candidate languages = the distinct `langKey`s of all configs + one `"other"` language that matches none.
- If every language gives the same result → solid fill with that config's color.
- If results differ → **hatched** with the colors of the distinct winners. The tooltip lists "fr → CA-QC FR, en/other → CA-QC EN".
- Mark how the winner was reached (`step`) with a visual cue: a fallback win gets a dotted outline or a pattern, so "covered on purpose" vs "caught by fallback" is visible at a glance. No banner is neutral grey.
- **Language picker** set to a specific language: recolor everything with that language's exact winner (no hatching).
- Countries that aren't split are evaluated with subdivision `UNKNOWN`. That's equivalent unless a config targets a subdivision of that country, in which case the country must be split.

**Geo OFF:** show a warning card saying what visitors get today (step 2: "everyone gets *{first config}*, unless the site pins `cookiesVersion`"), then paint the map **as if geolocation were ON** (run the engine with `geolocation: true` and no fallback ID), clearly labeled "Preview: location-based display ON". Include an internal-only link to the project banners page where the toggle lives.

---

## 5. Features and UI

**Layout:** header (logo + "Cookies Atlas", project ID input, FR/EN, theme), project summary strip, map (main), right-side panel with tabs: Legend · Simulator · Diagnostics. On mobile the panel stacks under the map.

- **Project summary:** project name, ID (copy button), published date, geolocation ON/OFF badge, fallback config, banner visibility (allowed countries), config count, "your location" (from headers).
- **Legend:** one row per config with color swatch, name, language, regulation, coverage count, and status (live/published, A/B). Hover highlights where the config wins. Click isolates it. With `?internal=1`, each row links to the admin.
- **Map:** d3-geo (Equal Earth or Natural Earth projection), d3-zoom pan/zoom, click a region → it loads into the simulator. Tooltip with region name (localized FR/EN), winner(s), decision step.
- **Simulator:** region picker (search by name or code, or click the map), browser language, html lang, language logic toggle (`browser` vs `useDocumentLang`), optional `cookiesVersion`. Output: the winning config + a numbered trace mirroring 3.3, in plain words ("Step b: 2 single-country configs list CA. Your region's regulation is ccpa, none of them match, so the SDK keeps both and tie-breaks on language: en → CA-QC EN").
- **"You are here" pin:** from `X-Viewer-Country(-Region)` of the project fetch. Show the pin plus "You'd get: *X*".
- **Shareable links:** all state in the query string: `?project=&lang=&region=CA-ON&logic=browser|html&ui=fr|en&internal=1`. A "Copy link" button.
- **PNG export:** map + legend + project name + date + "Cookies Atlas" footer, rendered to a canvas (serialize the SVG; inline fonts so they render).
- **Bookmarklet:** a "Get the bookmarklet" page or section with a draggable link. Logic: `window.axeptioSettings?.clientId`, else scan `performance.getEntriesByType('resource')` for `client.axept.io/projectconfigurations/brands/{id}.json`, then open `https://pggpgg.github.io/cookies-atlas/?project={id}`. If nothing is found, show a small inline message on the page (no `alert()`).
- **Recent projects:** last ~8 IDs + names in localStorage (wrapped in try/catch).

**Look:** Axeptio fonts (Figtree for headings, Source Sans 3 for body; both on Google Fonts). Sample the Axeptio brand colors from axept.io's CSS via Chrome (the warm yellow of the admin's "Publish" button is the primary). Combine with a debugger-style density: monospace for IDs and codes, compact tables, light and dark themes. The config palette must stay distinguishable for 10+ configs, and hatching must still read in dark mode.

---

## 6. Diagnostics (mechanism + fix)

Each finding has severity (error / warning / info), a title, **why it happens (the SDK mechanism)**, **the fix**, and the affected regions/configs (click → highlight on the map). FR and EN copy.

1. **Dead config.** Never wins in any region for any language (geo ON or preview). Usual cause: same country + same language as an earlier config in the array, so `byLang` always returns the earlier one. Example: Axeptio's own project has `axeptio-prod-fr` and `axeptio prod-fr-FR` (both fr, FR). Fix: delete it, or change its country/language.
2. **Over-capture.** A config wins in regions outside what it targets: it has a subdivision but also wins in other subdivisions of the same country, or it wins through a country match in a region whose regulation `R` differs from the config's regulation. **Mackage case:** the CA-QC EN/FR configs have `country: ["CA"]` (single-country), and "EN-US et fallback" has `["US","CA"]` (multi-country). Step b runs before step c, so an Ontario visitor gets the **Loi 25** banner, not CCPA. Fix: give the rest of Canada its own single-country config (`country: ["CA"]`, regulation CCPA, e.g. split "EN-US et fallback" into US and CA). Québec still matches first through subdivision (step a). Everywhere else in Canada, step b now finds 3 single-country configs and `preferReg(ccpa)` keeps the CA CCPA one.
3. **Regulation mismatch.** A region with a known regulation `R` (from the SDK table) is served a config whose regulation differs, or only the fallback. E.g. EU countries getting a CCPA banner, UK getting GDPR (minor), US GPP states getting nothing specific. Fix: add or retarget a config for that regulation.
4. **Overlaps and ambiguity.**
   - Same country listed in several configs (e.g. Mackage lists GB in "UK EN" and in both EU lists). Explain which one wins and why (single-country beats multi-country).
   - Subdivision in a format the SDK can't match (e.g. Quilicot's `"QC"` instead of `"CA-QC"`).
   - `geolocationFallbackConfigId` missing or pointing to a config that doesn't exist.
   - Geolocation ON but no fallback (unmatched regions drop to "first config").
   - Banner visibility enabled with an empty allowed list (no banner anywhere).
   - Language ties that resolve only through array order.

Engine-backed checks must be computed by running the engine, not by heuristics on the JSON alone, so findings always agree with the map.

---

## 7. Tech and repo

- **Stack:** Vite + TypeScript. UI in Preact (or vanilla TS if simpler). d3-geo, d3-zoom, topojson-client. Vitest for the engine.
- **Map data (build time, committed to `public/data/`):**
  - Countries: Natural Earth admin-0 50m from `raw.githubusercontent.com/nvkelso/natural-earth-vector` (use `ISO_A2_EH` to get FR/NO right), converted to TopoJSON with mapshaper (npm).
  - Subdivisions: Natural Earth admin-1 10m GeoJSON (same repo, ~40 MB), split per country with mapshaper into simplified TopoJSON `public/data/admin1/{CC}.json`. CA and US load upfront; others load lazily when a config references one of their subdivisions. Map NE features to ISO 3166-2 (`iso_3166_2` field) and check that the codes line up with CloudFront's `X-Viewer-Country-Region` format (ISO 3166-2 suffix, e.g. `QC`).
  - Write the preprocessing as a script (`scripts/build-geo.mjs`) so it's reproducible.
- **Deploy:** GitHub Pages via `actions/deploy-pages`. Vite `base: '/cookies-atlas/'`.
- **SDK drift check** (`.github/workflows/sdk-drift.yml`, weekly + manual trigger; GitHub runners can reach static.axept.io):
  - download sdk.js and extract the `countries`/`subdivisions` region table, the regulation enum values, and the string literals and property names inside `getCookiesConfig` (minified identifiers change every build, so don't hash raw code);
  - compare to the committed snapshot in `sdk-snapshot/`; on change, open an issue with the diff (`issues: write`).
- **Tests:** fixtures of the 3 test projects saved in `tests/fixtures/` (fetched via Chrome during the build). Engine unit tests cover every case in section 8 plus synthetic edge cases (string vs array fields, `UNKNOWN` country, visibility gate, missing fallback, `cookiesVersion`, `pages`).
- **README** (EN + short FR): what it is, how the logic works, the bookmarklet, the URL parameters, how to update the region table when the drift check fires.

**Out of scope for v1:** website-URL input (it would need a proxy), drafts/unpublished configs, TCF configs, simulating A/B test splits, auth.

---

## 8. Acceptance tests (expected engine output)

**Mackage**, project `691245e5b48e4a03c7b9c5c5`, geo ON, fallback `6913a674b1b71620d7b06fb7` ("EN-US et fallback"). Config order: CA-QC EN, CA-QC FR, EN-US et fallback, UK EN, EU EN, EU FR.

| Visitor | Lang | Expected | Step |
|---|---|---|---|
| CA-QC | fr | CA-QC FR | subdivision |
| CA-QC | de | CA-QC EN (list[0]) | subdivision |
| CA-ON | en | **CA-QC EN** (flag over-capture) | single-country |
| CA-ON | fr | **CA-QC FR** | single-country |
| US-NY | any | EN-US et fallback | multi-country |
| GB | any | UK EN | single-country |
| FR | fr / en / de | EU FR / EU EN / EU EN | multi-country |
| CH | fr / de | EU FR / EU EN | multi-country |
| IS | fr | EU FR (R undefined, country match) | multi-country |
| JP | any | EN-US et fallback | fallback |

**Bicycles Quilicot**, project `683f03ffa5e569f3bae4483d`, geo OFF. Configs: `fr-ca-qc-04-10-2024` (fr), `en-ca-qc-04-10-2024` (en), both `country: "CA"`, `subdivision: "QC"`, `loi25`.
- Today (geo off, no cookiesVersion): everyone gets `fr-ca-qc-04-10-2024` (default).
- Preview ON: CA-QC → single-country, by language (the `"QC"` subdivision never matches, flag it). CA-ON → same configs (over-capture). FR / US / JP → no geo match and no fallback → first config.

**Axeptio's own site**, project `624d5e22e4776e1f019014e2`, geo OFF, 11 configs (en, fr, fr-CA [CA / CA-QC / loi25], de, nl, es, it, pt, en-GB, pt-BR, fr-FR). The site sets `cookiesVersion` per language.
- Preview ON: FR visitor ties by language across the FR-country configs. CA-QC fr → `axeptio-prod-fr-ca`. Expect dead-config findings for `axeptio prod-pt-BR` (same PT/pt as `axeptio-prod-pt`) and `axeptio prod-fr-FR` (same FR/fr as `axeptio-prod-fr`), and `axeptio prod-en-GB` (same FR/en as `axeptio-prod-en`).

Before shipping, spot-check at least the Mackage Ontario case on a real browser with a VPN (or ask Pierre to). If it disagrees with the engine, the SDK reading is wrong somewhere: fix the engine, not the test.
