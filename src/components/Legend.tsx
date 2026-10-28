import { colorOf, type ColorAssignment } from '../app/colors';
import { ADMIN_CONFIG_URL } from '../app/project';
import { countriesOf, subdivisionsOf, type Evaluation } from '../engine/evaluate';
import { langKey } from '../engine/select';
import type { AxeptioProject } from '../engine/types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

interface LegendProps {
  project: AxeptioProject;
  evaluation: Evaluation;
  colors: ColorAssignment;
  isolated: string | null;
  internal: boolean;
  /** Configs the diagnostics found can never show (whatever the map mode). */
  deadIds: ReadonlySet<string>;
  /** Location-based display off, shown as it is today: banners other than the default show only on request. */
  today: boolean;
  onHover: (id: string | null) => void;
  onIsolate: (id: string | null) => void;
}

/** Countries won as a whole, and regions won where the rest of the country isn't. */
export function coverageOf(evaluation: Evaluation, id: string) {
  const keys = [...(evaluation.wins.get(id) ?? [])];
  const whole = new Set(keys.filter((k) => !k.includes('-')));
  const regionsOnly = keys.filter((k) => k.includes('-') && !whole.has(k.split('-')[0]));
  return { countries: whole.size, regions: regionsOnly.length };
}

export function Legend({ project, evaluation, colors, isolated, internal, deadIds, today, onHover, onIsolate }: LegendProps) {
  const { t, c } = useI18n();
  const fallbackId = project.client?.cookiesSettings?.geolocationFallbackConfigId ?? null;
  const abIds = new Set((project.abTests ?? []).flatMap((x) => (x.variants ?? []).map((v) => v.configId)));

  return (
    <div class="legend">
      <p class="panel-intro">{t.legend.intro}</p>
      {isolated && (
        <button type="button" class="text-button" onClick={() => onIsolate(null)}>
          <Icon name="close" size={14} /> {t.legend.clearIsolation}
        </button>
      )}
      <ul class="legend-list">
        {(project.cookies ?? []).map((config) => {
          const id = config.identifier;
          const coverage = coverageOf(evaluation, id);
          const offMap = coverage.countries + coverage.regions === 0;
          // Diagnostics describe location-based display on; today a site can still pin any banner.
          const never = !today && deadIds.has(id);
          const hasPages = Array.isArray(config.settings?.pages) && config.settings!.pages!.length > 0;
          const wins = offMap && today ? t.legend.notDefault(hasPages) : t.legend.wins(coverage.countries, coverage.regions);
          const countries = countriesOf(config);
          const subs = subdivisionsOf(config);
          const lang = langKey(config.language);
          const meta = [
            lang ? c.language(lang) : null,
            config.regulation ? c.regulation(config.regulation) : null,
            subs.length ? subs.join(', ') : null,
            countries.length ? t.legend.lists(countries.length) : subs.length ? null : t.legend.listsNothing,
          ].filter(Boolean);
          const active = isolated === id;
          return (
            <li key={id} class={`legend-item${active ? ' active' : ''}${isolated && !active ? ' muted' : ''}`}>
              <button
                type="button"
                class="legend-button"
                aria-pressed={active}
                title={t.legend.isolate}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(id)}
                onBlur={() => onHover(null)}
                onClick={() => onIsolate(active ? null : id)}
              >
                <span class={`swatch${offMap ? ' swatch-none' : ''}`} style={offMap ? undefined : { background: colorOf(colors, id) }} />
                <span class="legend-text">
                  <span class="legend-name">{config.name || config.title || id}</span>
                  <span class="legend-meta">{meta.join(' · ')}</span>
                  <span class="legend-wins">{wins}</span>
                </span>
                <span class="legend-badges">
                  {id === fallbackId && <span class="badge">{t.legend.fallback}</span>}
                  {never && <span class="badge badge-warn">{t.legend.neverShown}</span>}
                  {(config.partOfABTest || abIds.has(id)) && <span class="badge">{t.legend.abTest}</span>}
                </span>
              </button>
              {internal && project.projectId && (
                <a class="legend-admin" href={ADMIN_CONFIG_URL(project.projectId, id)} target="_blank" rel="noopener noreferrer" title={t.legend.admin}>
                  <Icon name="external" size={15} />
                  <span class="sr-only">{t.legend.admin}</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {colors.others.length > 0 && <p class="panel-note">{t.legend.otherBanners(colors.others.length)}</p>}
      <MapKey />
    </div>
  );
}

export function MapKey() {
  const { t } = useI18n();
  return (
    <div class="map-key">
      <h3>{t.map.keyTitle}</h3>
      <ul>
        <li>
          <span class="key-swatch key-solid" />
          {t.map.keySolid}
        </li>
        <li>
          <span class="key-swatch key-light" />
          {t.map.keyLight}
        </li>
        <li>
          <span class="key-swatch key-striped" />
          {t.map.keyStriped}
        </li>
        <li>
          <span class="key-swatch key-none" />
          {t.map.keyNone}
        </li>
        <li>
          <span class="key-pin" />
          {t.map.keyYou}
        </li>
      </ul>
    </div>
  );
}
