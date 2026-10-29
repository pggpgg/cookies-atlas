import { useMemo, useState } from 'preact/hooks';
import { colorOf, type ColorAssignment } from '../app/colors';
import { csvRows, tableRows } from '../app/table';
import { OTHER_LANGUAGE, type Evaluation } from '../engine/evaluate';
import type { AxeptioProject } from '../engine/types';
import { useI18n } from '../i18n';
import { csvSeparator, downloadText, toCsv } from '../lib/csv';
import { Icon } from './Icon';
import { ModeIcons } from './Modes';

interface RegionTableProps {
  project: AxeptioProject;
  evaluation: Evaluation;
  colors: ColorAssignment;
  language: string | 'all';
  /** Export file name without extension ("cookies-atlas-my-shop"). */
  fileStem: string;
  onSelect: (key: string) => void;
}

/** The accessible twin of the map: every evaluated place and its banner per language. */
export function RegionTable({ project, evaluation, colors, language, fileStem, onSelect }: RegionTableProps) {
  const { t, c } = useI18n();
  const [filter, setFilter] = useState('');
  const configs = useMemo(() => new Map((project.cookies ?? []).map((cfg) => [cfg.identifier, cfg])), [project]);
  const nameOf = (id: string) => {
    const cfg = configs.get(id);
    return cfg ? cfg.name || cfg.title || id : id;
  };

  const rows = useMemo(() => tableRows(evaluation, language, c), [evaluation, language, c]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          r.place.toLowerCase().includes(q) ||
          r.outcome.key.toLowerCase().includes(q) ||
          r.groups.some((g) => (g.winner ? nameOf(g.winner).toLowerCase().includes(q) : false)),
      )
    : rows;

  // What's on screen goes in the file: the language picked on the map and the filter.
  const exportCsv = () => {
    const suffix = language === 'all' ? '' : `-${language === OTHER_LANGUAGE ? 'other' : language}`;
    const csv = toCsv(csvRows(visible, { language, configs, t, c }), csvSeparator());
    downloadText(`${fileStem}${suffix}.csv`, csv);
  };

  return (
    <div class="region-table">
      <p class="panel-intro">{t.table.intro}</p>
      <label class="field table-filter">
        <span class="sr-only">{t.table.filter}</span>
        <input type="search" placeholder={t.table.filter} value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="table-tools">
        <span class="field-count" aria-live="polite">
          {t.table.rows(visible.length)}
        </span>
        <button type="button" class="button button-ghost" onClick={exportCsv} disabled={visible.length === 0} title={t.table.exportHint}>
          <Icon name="download" size={16} /> {t.table.exportCsv}
        </button>
      </div>
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
                  {groups.map((g) => {
                    const config = g.winner ? configs.get(g.winner) : undefined;
                    return (
                      <div class="table-banner" key={g.winner ?? 'none'}>
                        <span class="chip-swatch" style={{ background: colorOf(colors, g.winner) }} />
                        <span class="table-banner-name">
                          {g.winner ? nameOf(g.winner) : t.table.none}
                          {language === 'all' && groups.length > 1 && <span class="muted"> ({g.languages.map((l) => c.language(l)).join(', ')})</span>}
                        </span>
                        {config && <ModeIcons config={config} />}
                      </div>
                    );
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
