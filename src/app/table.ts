/** The Table tab's rows, on screen and in the CSV export. */
import { OTHER_LANGUAGE, winnersFor, type Evaluation, type RegionOutcome } from '../engine/evaluate';
import { modesOf } from '../engine/modes';
import type { AxeptioConfig } from '../engine/types';
import type { CopyContext, Messages } from '../i18n/types';

export interface TableRow {
  outcome: RegionOutcome;
  place: string;
  country: string;
  region: string;
  /** Banners by language: one group per distinct winner. */
  groups: Array<{ winner: string | null; languages: string[] }>;
}

/** Every evaluated place with its winner per language (or for the one language shown), each country followed by its regions. */
export function tableRows(evaluation: Evaluation, language: string | 'all', c: CopyContext): TableRow[] {
  return [...evaluation.regions.values()]
    .map((o) => {
      const languages = language === 'all' ? evaluation.languages : [language];
      const groups: TableRow['groups'] = [];
      for (const lang of languages) {
        const [winner] = winnersFor(o, lang);
        const g = groups.find((x) => x.winner === winner);
        if (g) g.languages.push(lang);
        else groups.push({ winner, languages: [lang] });
      }
      const country = c.country(o.country);
      const region = o.subdivision ? c.place(o.key) : '';
      return { outcome: o, place: c.place(o.key), country, region, groups };
    })
    .sort((a, b) => a.country.localeCompare(b.country) || (a.region ? 1 : 0) - (b.region ? 1 : 0) || a.region.localeCompare(b.region));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The rows as a spreadsheet: one line per place and banner, with what the banner does. */
export function csvRows(
  rows: TableRow[],
  options: { language: string | 'all'; configs: ReadonlyMap<string, AxeptioConfig>; t: Messages; c: CopyContext },
): string[][] {
  const { language, configs, t, c } = options;
  const h = t.table.csv;
  // A country drawn by region: its own line covers the regions no banner targets.
  const split = new Set(rows.filter((r) => r.outcome.subdivision).map((r) => r.outcome.country));
  const languageName = (key: string) => (key === OTHER_LANGUAGE ? h.otherLanguages : c.language(key));
  const out: string[][] = [[h.code, h.country, h.region, h.languages, h.banner, h.display, h.consent, h.how, h.regulation, h.bannerId]];
  for (const { outcome: o, groups } of rows) {
    const region = o.subdivision ? (c.regionName(o.key) ?? o.subdivision) : split.has(o.country) ? h.otherRegions : '';
    for (const g of groups) {
      const config = g.winner ? configs.get(g.winner) : undefined;
      const modes = config ? modesOf(config) : null;
      out.push([
        o.key,
        c.country(o.country),
        region,
        language === 'all' && groups.length === 1 ? h.allLanguages : capitalize(g.languages.map(languageName).join(', ')),
        g.winner ? config?.name || config?.title || g.winner : t.legend.noBanner,
        modes ? (modes.shown ? t.modes.shown : t.modes.hidden) : '',
        modes ? (modes.optOut ? t.modes.optOut : t.modes.optIn) : '',
        t.steps[o.step],
        o.regulation ? c.regulation(o.regulation) : t.map.noRegulation,
        g.winner ?? '',
      ]);
    }
  }
  return out;
}
