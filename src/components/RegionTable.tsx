import { useMemo, useState } from 'preact/hooks';
import { colorOf, type ColorAssignment } from '../app/colors';
import { winnersFor, type Evaluation } from '../engine/evaluate';
import type { AxeptioProject } from '../engine/types';
import { useI18n } from '../i18n';

interface RegionTableProps {
  project: AxeptioProject;
  evaluation: Evaluation;
  colors: ColorAssignment;
  language: string | 'all';
  onSelect: (key: string) => void;
}

/** The accessible twin of the map: every evaluated place and its banner per language. */
export function RegionTable({ project, evaluation, colors, language, onSelect }: RegionTableProps) {
  const { t, c } = useI18n();
  const [filter, setFilter] = useState('');
  const names = useMemo(() => new Map((project.cookies ?? []).map((cfg) => [cfg.identifier, cfg.name || cfg.title || cfg.identifier])), [project]);

  const rows = useMemo(() => {
    return [...evaluation.regions.values()]
      .map((o) => {
        const languages = language === 'all' ? evaluation.languages : [language];
        const groups: Array<{ winner: string | null; languages: string[] }> = [];
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
      // Countries alphabetically, each followed by its regions.
      .sort((a, b) => a.country.localeCompare(b.country) || (a.region ? 1 : 0) - (b.region ? 1 : 0) || a.region.localeCompare(b.region));
  }, [evaluation, language, c]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          r.place.toLowerCase().includes(q) ||
          r.outcome.key.toLowerCase().includes(q) ||
          r.groups.some((g) => (g.winner ? (names.get(g.winner) ?? '').toLowerCase().includes(q) : false)),
      )
    : rows;

  return (
    <div class="region-table">
      <p class="panel-intro">{t.table.intro}</p>
      <label class="field field-inline">
        <span class="sr-only">{t.table.filter}</span>
        <input type="search" placeholder={t.table.filter} value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
        <span class="field-count">{t.table.rows(visible.length)}</span>
      </label>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{t.table.place}</th>
              <th scope="col">{t.table.how}</th>
              <th scope="col">{t.table.banner}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ outcome, place, groups }) => (
              <tr key={outcome.key} class={outcome.subdivision ? 'sub-row' : undefined}>
                <th scope="row">
                  <button type="button" class="link-button" onClick={() => onSelect(outcome.key)}>
                    {place}
                  </button>
                  <span class="code">{outcome.key}</span>
                </th>
                <td>
                  {t.steps[outcome.step]}
                  <span class="cell-sub">{outcome.regulation ? c.regulation(outcome.regulation) : t.map.noRegulation}</span>
                </td>
                <td>
                  {groups.map((g) => (
                    <div class="table-banner" key={g.winner ?? 'none'}>
                      <span class="chip-swatch" style={{ background: colorOf(colors, g.winner) }} />
                      <span>{g.winner ? names.get(g.winner) : t.table.none}</span>
                      {language === 'all' && groups.length > 1 && <span class="muted"> ({g.languages.map((l) => c.language(l)).join(', ')})</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
