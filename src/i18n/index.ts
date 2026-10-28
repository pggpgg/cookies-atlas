import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { OTHER_LANGUAGE } from '../engine/evaluate';
import type { SelectionStep } from '../engine/select';
import type { AxeptioProject } from '../engine/types';
import { en } from './en';
import { fr } from './fr';
import type { CopyContext, Messages } from './types';

export type UiLanguage = 'en' | 'fr';
export const MESSAGES: Record<UiLanguage, Messages> = { en, fr };

export function detectUiLanguage(): UiLanguage {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return langs.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

export interface PlaceNames {
  country: (code: string, ui: UiLanguage) => string | undefined;
  /** First-level regions, and finer areas drawn on the map (a French department). */
  region: (country: string, code: string, ui: UiLanguage) => string | undefined;
  /** Countries drawn split on the map: a bare country key then means "the rest of it". */
  isSplit: (country: string) => boolean;
}

const displayNames = new Map<string, Intl.DisplayNames | null>();
function intlName(ui: UiLanguage, type: 'region' | 'language', code: string): string | undefined {
  const key = `${ui}:${type}`;
  if (!displayNames.has(key)) {
    try {
      displayNames.set(key, new Intl.DisplayNames([MESSAGES[ui].locale], { type }));
    } catch {
      displayNames.set(key, null);
    }
  }
  try {
    const name = displayNames.get(key)?.of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

export function buildCopyContext(ui: UiLanguage, project: AxeptioProject | null, names: PlaceNames): CopyContext {
  const t = MESSAGES[ui];
  const byId = new Map((project?.cookies ?? []).map((c) => [c.identifier, c]));
  let listFormat: Intl.ListFormat | null = null;
  try {
    listFormat = new Intl.ListFormat(t.locale, { style: 'long', type: 'conjunction' });
  } catch {
    listFormat = null;
  }
  const list = (items: string[]) => (listFormat ? listFormat.format(items) : items.join(', '));
  const country = (code: string) => names.country(code, ui) ?? intlName(ui, 'region', code) ?? code;
  /** `inText`: the place sits in a sentence ("the United States"), not in a label. */
  const place = (key: string, inText = false) => {
    const [cc, sub] = key.split('-');
    const lead = inText ? t.article(country(cc)) : country(cc);
    if (!sub) return names.isSplit(cc) ? t.map.rest(lead) : lead;
    const region = names.region(cc, sub, ui);
    return region ? `${region} (${country(cc)})` : `${lead} (${sub})`;
  };
  const places = (keys: string[], max = 5, inText = false) => {
    // Many regions of one country collapse to "Country (12 regions)".
    const byCountry = new Map<string, string[]>();
    const singles: string[] = [];
    for (const key of keys) {
      const [cc, sub] = key.split('-');
      if (sub) byCountry.set(cc, [...(byCountry.get(cc) ?? []), key]);
      else singles.push(key);
    }
    const parts: string[] = [];
    for (const [cc, subs] of byCountry) {
      const name = inText ? t.article(country(cc)) : country(cc);
      if (subs.length > 3) parts.push(`${name} (${subs.length} ${ui === 'fr' ? 'régions' : 'regions'})`);
      else parts.push(...subs.map((k) => place(k, inText)));
    }
    parts.push(...singles.map((k) => place(k, inText)));
    if (parts.length <= max) return list(parts);
    const shown = parts.slice(0, max - 1);
    const more = parts.length - shown.length;
    return list([...shown, ui === 'fr' ? `${more} autres` : `${more} more`]);
  };
  const config = (id: string | null | undefined) => {
    if (!id) return t.legend.noBanner;
    const c = byId.get(id);
    const name = c ? c.name || c.title || id : id;
    return ui === 'fr' ? `« ${name} »` : `“${name}”`;
  };
  const regulation = (value: string | null | undefined) => (value ? (t.regulations[value.toLowerCase()] ?? value) : '');
  const language = (key: string | null | undefined) => {
    if (!key || key === OTHER_LANGUAGE) return t.map.otherLanguages.toLowerCase();
    return intlName(ui, 'language', key) ?? key;
  };
  let dateFormat: Intl.DateTimeFormat | null = null;
  try {
    dateFormat = new Intl.DateTimeFormat(t.locale, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    dateFormat = null;
  }
  const regionName = (key: string) => {
    const [cc, sub] = key.split('-');
    return sub ? names.region(cc, sub, ui) : undefined;
  };
  const regionWithCode = (key: string) => {
    const name = regionName(key);
    return name ? `${name} (${key})` : key;
  };
  return {
    config,
    configs: (ids) => list(ids.map(config)),
    places: (keys, max) => places(keys, max),
    placesIn: (keys, max) => places(keys, max, true),
    place: (key) => place(key),
    placeIn: (key) => place(key, true),
    regionWithCode,
    regionName,
    country,
    countryIn: (code) => t.article(country(code)),
    regulation,
    regulations: (values) => list(values.map(regulation)),
    language,
    step: (step: SelectionStep) => t.steps[step],
    list,
    date: (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return isNaN(d.getTime()) || !dateFormat ? String(iso) : dateFormat.format(d);
    },
  };
}

export interface I18n {
  ui: UiLanguage;
  t: Messages;
  c: CopyContext;
}

export const I18nContext = createContext<I18n>({
  ui: 'en',
  t: en,
  c: buildCopyContext('en', null, { country: () => undefined, region: () => undefined, isSplit: () => false }),
});

export const useI18n = () => useContext(I18nContext);
