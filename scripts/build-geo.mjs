#!/usr/bin/env node
/**
 * Builds the map data served from public/data/ out of Natural Earth (pinned commit):
 *
 *   public/data/countries.json        TopoJSON, one feature per country code the CDN reports
 *   public/data/admin1/{CC}.json      TopoJSON of a country's subdivisions + its first-level region list
 *   public/data/admin1/index.json     which countries have subdivision files
 *
 * Countries come from "admin 0 map units" (not "countries") because Axeptio's CDN reports
 * overseas territories with their own codes: a visitor in Réunion is RE, not FR.
 *
 * Usage: npm run build:geo   (downloads ~65 MB into .cache/natural-earth on first run)
 */
import fs from 'node:fs';
import path from 'node:path';
import mapshaper from 'mapshaper';

const NE_REF = 'ca96624a56bd078437bca8184e78163e5039ad19'; // natural-earth-vector master, 2026-10
const NE_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_REF}/geojson/`;
const CACHE = '.cache/natural-earth';
const OUT = 'public/data';

const MAP_UNITS = 'ne_10m_admin_0_map_units.geojson';
const COUNTRIES = 'ne_10m_admin_0_countries.geojson';
const ADMIN1 = 'ne_10m_admin_1_states_provinces.geojson';

/** Map units without an ISO code, assigned to the country a visitor there would be geolocated in. */
const UNIT_OVERRIDES = {
  Somaliland: 'SO',
  'Turkish Republic of Northern Cyprus': 'CY',
  'United Nations Buffer Zone in Cyprus': 'CY',
  'Dhekelia Cantonment': 'CY',
  'Akrotiri Sovereign Base Area': 'CY',
  'Guantanamo Bay Naval Base': 'CU',
  'Siachen Glacier': 'IN',
  'Southern Patagonian Ice Field': 'AR',
  'Wake Island': 'UM',
};
/** Country names that are too long, ambiguous or misspelled for tooltips and tables. */
const COUNTRY_NAME_OVERRIDES = {
  US: { en: 'United States', fr: 'États-Unis' },
  CN: { en: 'China', fr: 'Chine' },
  SX: { en: 'Sint Maarten', fr: 'Sint Maarten' }, // not to be confused with French Saint-Martin (MF)
  PN: { en: 'Pitcairn Islands', fr: 'Îles Pitcairn' },
};
/** Names are labels: "îles Caïmans" becomes "Îles Caïmans". */
const capitalize = (name) => (typeof name === 'string' && name ? name.charAt(0).toUpperCase() + name.slice(1) : name);
/** Codes we don't draw. */
const SKIP_CODES = new Set(['AQ']);
/** Natural Earth placeholder codes that no CDN reports, merged into the country a visitor there gets. */
const PLACEHOLDER_CODES = { XD: 'SY' }; // UNDOF zone, Golan Heights

/** Irish counties by province (ISO 3166-2:IE: provinces first, counties second). */
const IE_PROVINCES = {
  C: ['G', 'LM', 'MO', 'RN', 'SO'],
  L: ['CW', 'D', 'KE', 'KK', 'LS', 'LD', 'LH', 'MH', 'OY', 'WH', 'WX', 'WW'],
  M: ['CE', 'CO', 'KY', 'LK', 'TA', 'WD'],
  U: ['CN', 'DL', 'MN'],
};
const IE_PROVINCE_OF = Object.fromEntries(Object.entries(IE_PROVINCES).flatMap(([province, counties]) => counties.map((c) => [c, province])));
/** First-level regions for countries where Natural Earth subdivisions are finer than ISO 3166-2 level 1. */
const PARENT_BY_FIELD = {
  GB: (p) => ({ England: 'ENG', Scotland: 'SCT', Wales: 'WLS', 'Northern Ireland': 'NIR' })[p.geonunit],
  BE: (p) => ({ Flemish: 'VLG', Walloon: 'WAL', 'Capital Region': 'BRU' })[p.region],
  IE: (p) => IE_PROVINCE_OF[String(p.iso_3166_2 ?? '').replace(/^IE-/, '')],
};
/**
 * Countries whose Natural Earth `region_cod` is the ISO 3166-2 first-level code of a finer subdivision
 * (French departments → regions, Spanish provinces → autonomous communities, Italian provinces → regions...).
 * Other countries' region_cod values are not ISO codes (economic regions, islands, or groupings ISO
 * doesn't use, like Maldives provinces or Botswana's cities filed under districts), so they are ignored.
 */
const REGION_COD_PARENTS = new Set(['FR', 'ES', 'IT', 'PH', 'LK', 'GN', 'GW', 'CV', 'KN']);
/** Natural Earth ISO 3166-2 codes that are wrong, keyed by "CC:English name". */
const CODE_OVERRIDES = { 'MV:Malé': 'MLE' };
/** First-level regions that Natural Earth's region_cod files under another one. */
const FIRST_LEVEL_EXCEPTIONS = new Set(['ES-ML', 'GW-BS']);
/**
 * Single-province Spanish communities whose region_cod is the province code: ISO 3166-2:ES gives
 * the community its own code (Navarra is the community NC and the province NA).
 */
const PARENT_OVERRIDES = { 'ES-NA': 'NC', 'ES-MU': 'MC', 'ES-PM': 'IB', 'ES-LO': 'RI' };
/** Natural Earth names that would confuse readers. */
const NAME_OVERRIDES = {
  'US-DC': ['District of Columbia', 'District de Columbia'],
};
const PARENT_NAMES = {
  GB: { ENG: ['England', 'Angleterre'], SCT: ['Scotland', 'Écosse'], WLS: ['Wales', 'Pays de Galles'], NIR: ['Northern Ireland', 'Irlande du Nord'] },
  BE: { VLG: ['Flanders', 'Flandre'], WAL: ['Wallonia', 'Wallonie'], BRU: ['Brussels', 'Bruxelles'] },
  ES: { NC: ['Navarre', 'Navarre'], MC: ['Murcia', 'Murcie'], IB: ['Balearic Islands', 'Îles Baléares'], RI: ['La Rioja', 'La Rioja'] },
  IE: { C: ['Connacht', 'Connacht'], L: ['Leinster', 'Leinster'], M: ['Munster', 'Munster'], U: ['Ulster', 'Ulster'] },
};

async function ensure(file) {
  const target = path.join(CACHE, file);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(CACHE, { recursive: true });
  console.log(`Downloading ${file}...`);
  const res = await fetch(NE_BASE + file);
  if (!res.ok) throw new Error(`Download failed for ${file}: HTTP ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return target;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clean = (value) => (typeof value === 'string' ? value.trim() : value);

async function run(commands, inputs) {
  const output = await mapshaper.applyCommands(commands, inputs);
  return JSON.parse(String(output['out.json']));
}

async function buildCountries() {
  const units = readJson(await ensure(MAP_UNITS));
  const countries = readJson(await ensure(COUNTRIES));

  // Country names come from the "countries" layer (e.g. "United Kingdom", not "England").
  const names = {};
  for (const f of countries.features) {
    const p = f.properties;
    const code = p.ISO_A2_EH;
    if (!/^[A-Z]{2}$/.test(code)) continue;
    if (!names[code] || p.HOMEPART === 1) names[code] = { en: p.NAME_EN || p.NAME, fr: p.NAME_FR || p.NAME_EN || p.NAME };
  }

  const features = [];
  for (const f of units.features) {
    const p = f.properties;
    let code = /^[A-Z]{2}$/.test(p.ISO_A2_EH) ? p.ISO_A2_EH : UNIT_OVERRIDES[p.NAME_EN] || UNIT_OVERRIDES[p.NAME] || UNIT_OVERRIDES[p.ADMIN];
    code = PLACEHOLDER_CODES[code] ?? code;
    if (!code || SKIP_CODES.has(code)) continue;
    // Map units split some countries (GB nations, Belgian regions), so prefer the country's own name.
    const name = COUNTRY_NAME_OVERRIDES[code] ?? names[code] ?? { en: p.NAME_EN || p.NAME, fr: p.NAME_FR || p.NAME_EN || p.NAME };
    features.push({ type: 'Feature', properties: { id: code, en: capitalize(name.en), fr: capitalize(name.fr) }, geometry: f.geometry });
  }

  const topo = await run(
    '-i in.json -dissolve id copy-fields=en,fr -simplify 6% weighted keep-shapes -clean -o out.json format=topojson quantization=1e5 precision=0.0001',
    { 'in.json': { type: 'FeatureCollection', features } },
  );
  // Rename the object to "countries".
  topo.objects = { countries: Object.values(topo.objects)[0] };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'countries.json'), JSON.stringify(topo));
  const count = topo.objects.countries.geometries.length;
  console.log(`countries.json: ${count} countries, ${(fs.statSync(path.join(OUT, 'countries.json')).size / 1024).toFixed(0)} KB`);

  // The engine evaluates every drawable country, so it gets the code list without loading the map.
  const codes = topo.objects.countries.geometries.map((g) => g.properties.id).sort();
  fs.writeFileSync(
    'src/engine/world-codes.ts',
    '// Generated by scripts/build-geo.mjs: country codes drawn on the map (CDN country codes).\n' +
      `export const WORLD_COUNTRY_CODES: readonly string[] = ${JSON.stringify(codes)};\n`,
  );
}

async function buildAdmin1() {
  const admin1 = readJson(await ensure(ADMIN1));
  const byCountry = new Map();
  for (const f of admin1.features) {
    const p = f.properties;
    const cc = p.iso_a2;
    if (!/^[A-Z]{2}$/.test(cc) || SKIP_CODES.has(cc)) continue;
    // Overseas departments are reported as their own countries (GF, MQ, GP, RE, YT).
    if (cc === 'FR' && /^Overseas/.test(p.type_en || '')) continue;
    const iso = clean(p.iso_3166_2) || '';
    const own = iso.match(/^([A-Z]{2})-([A-Z0-9]{1,3})$/);
    const code = CODE_OVERRIDES[`${cc}:${p.name_en || p.name}`] ?? (own && own[1] === cc ? own[2] : null);

    let parent = PARENT_BY_FIELD[cc]?.(p) ?? null;
    if (!parent && REGION_COD_PARENTS.has(cc)) {
      const rc = clean(p.region_cod) || '';
      const m = rc.match(/^([A-Z]{2})[-.]([A-Z0-9]{1,3})$/);
      if (m && m[1] === cc) parent = m[2];
    }
    // Natural Earth files Melilla under Ceuta and Bissau under a "B" region; both are first-level.
    parent = PARENT_OVERRIDES[`${cc}-${code}`] ?? parent;
    if (parent === code || FIRST_LEVEL_EXCEPTIONS.has(`${cc}-${code}`)) parent = null;

    const override = NAME_OVERRIDES[iso];
    const name = override ? { en: override[0], fr: override[1] } : { en: p.name_en || p.name, fr: p.name_fr || p.name_en || p.name };
    const parentName = parent ? PARENT_NAMES[cc]?.[parent] ?? [clean(p.region), clean(p.region)] : null;
    const list = byCountry.get(cc) ?? [];
    list.push({
      type: 'Feature',
      properties: {
        code,
        parent,
        en: capitalize(name.en),
        fr: capitalize(name.fr),
        parentEn: capitalize(parentName?.[0] ?? null),
        parentFr: capitalize(parentName?.[1] ?? null),
      },
      geometry: f.geometry,
    });
    byCountry.set(cc, list);
  }

  const dir = path.join(OUT, 'admin1');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const index = {};
  let total = 0;
  for (const [cc, features] of [...byCountry.entries()].sort()) {
    if (features.length < 2) continue; // nothing to split
    const topo = await run(
      '-i in.json -simplify 12% weighted keep-shapes -clean -o out.json format=topojson quantization=1e5 precision=0.0001',
      { 'in.json': { type: 'FeatureCollection', features } },
    );
    const object = Object.values(topo.objects)[0];
    for (const g of object.geometries) {
      // Keep properties compact: drop nulls and parent names (they move to the region list).
      const { code, parent, en, fr } = g.properties;
      g.properties = { ...(code ? { code } : {}), ...(parent ? { parent } : {}), en, ...(fr !== en ? { fr } : {}) };
    }
    topo.objects = { subdivisions: object };

    // First-level regions the CDN can report: parents when the data is finer, else the features themselves.
    const regions = new Map();
    for (const f of features) {
      const p = f.properties;
      if (p.parent) {
        if (!regions.has(p.parent)) regions.set(p.parent, { code: p.parent, en: p.parentEn ?? p.parent, fr: p.parentFr ?? p.parentEn ?? p.parent });
      } else if (p.code && !regions.has(p.code)) {
        regions.set(p.code, { code: p.code, en: p.en, fr: p.fr });
      }
    }
    topo.regions = [...regions.values()].sort((a, b) => a.en.localeCompare(b.en));

    const file = path.join(dir, `${cc}.json`);
    fs.writeFileSync(file, JSON.stringify(topo));
    total += fs.statSync(file).size;
    index[cc] = topo.regions.length;
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  console.log(`admin1/: ${Object.keys(index).length} countries, ${(total / 1024 / 1024).toFixed(1)} MB total`);

  // The engine needs to know which region codes the CDN never reports (a French department,
  // a UK county), and the first-level region it reports instead, without loading the map.
  const lines = [];
  for (const [cc, features] of [...byCountry.entries()].sort()) {
    if (features.length < 2) continue;
    const parents = Object.fromEntries(
      features
        .filter((f) => f.properties.code && f.properties.parent)
        .map((f) => [f.properties.code, f.properties.parent])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    if (Object.keys(parents).length > 0) lines.push(`  ${cc}: ${JSON.stringify(parents)},`);
  }
  fs.writeFileSync(
    'src/engine/region-parents.ts',
    '// Generated by scripts/build-geo.mjs: region codes finer than the first-level regions the CDN\n' +
      '// reports, mapped to the first-level region a visitor there is reported in\n' +
      '// (French departments → regions, UK counties → nations, Italian provinces → regions...).\n' +
      'export const SECOND_LEVEL_PARENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {\n' +
      lines.join('\n') +
      '\n};\n',
  );
  for (const cc of ['CA', 'US']) console.log(`  ${cc}.json: ${(fs.statSync(path.join(dir, `${cc}.json`)).size / 1024).toFixed(0)} KB`);
}

await buildCountries();
await buildAdmin1();
