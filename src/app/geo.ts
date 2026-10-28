/** Loads the map files built by scripts/build-geo.mjs (served from public/data). */
import type { Feature, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

export interface CountryProps {
  id: string;
  en: string;
  fr: string;
}

export interface SubdivisionProps {
  code?: string;
  parent?: string;
  en: string;
  fr?: string;
}

export interface RegionInfo {
  code: string;
  en: string;
  fr: string;
}

export interface CountryFile {
  country: string;
  features: Array<Feature<Geometry, SubdivisionProps>>;
  regions: RegionInfo[];
}

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path));
  if (!res.ok) throw new Error(`Map data ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

let worldPromise: Promise<Array<Feature<Geometry, CountryProps>>> | null = null;
export function loadWorld() {
  worldPromise ??= getJson<Topology<{ countries: GeometryCollection<CountryProps> }>>('countries.json').then(
    (topo) => feature(topo, topo.objects.countries).features as Array<Feature<Geometry, CountryProps>>,
  );
  return worldPromise;
}

let indexPromise: Promise<Record<string, number>> | null = null;
/** Countries that have a subdivision file, with their number of first-level regions. */
export function loadAdmin1Index() {
  indexPromise ??= getJson<Record<string, number>>('admin1/index.json').catch(() => ({}));
  return indexPromise;
}

const countryCache = new Map<string, Promise<CountryFile | null>>();
export function loadCountry(country: string): Promise<CountryFile | null> {
  if (!/^[A-Z]{2}$/.test(country)) return Promise.resolve(null);
  let promise = countryCache.get(country);
  if (!promise) {
    promise = loadAdmin1Index().then(async (index) => {
      if (!(country in index)) return null;
      const topo = await getJson<Topology<{ subdivisions: GeometryCollection<SubdivisionProps> }> & { regions: RegionInfo[] }>(
        `admin1/${country}.json`,
      );
      return {
        country,
        features: feature(topo, topo.objects.subdivisions).features as Array<Feature<Geometry, SubdivisionProps>>,
        regions: topo.regions,
      };
    });
    countryCache.set(country, promise);
  }
  return promise;
}
