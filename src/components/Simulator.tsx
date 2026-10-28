import { useEffect, useMemo, useState } from 'preact/hooks';
import { colorOf, type ColorAssignment } from '../app/colors';
import { loadCountry, type RegionInfo } from '../app/geo';
import { ADMIN_CONFIG_URL } from '../app/project';
import type { LanguageLogic } from '../app/url';
import { languagesOf, OTHER_LANGUAGE, type EvaluationMode } from '../engine/evaluate';
import { selectConfig, type TraceEntry } from '../engine/select';
import type { AxeptioProject } from '../engine/types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

export interface SimulatorState {
  region: string | undefined;
  blang: string;
  hlang: string;
  logic: LanguageLogic;
  cv: string;
  page: string;
}

interface SimulatorProps {
  project: AxeptioProject;
  mode: EvaluationMode;
  colors: ColorAssignment;
  countries: Array<{ code: string; name: string }>;
  state: SimulatorState;
  internal: boolean;
  onChange: (patch: Partial<SimulatorState>) => void;
  onCopyLink: () => void;
  linkCopied: boolean;
}

const COMMON_LANGUAGES = ['en-US', 'en-GB', 'en-CA', 'fr-CA', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'nl-NL', 'pt-PT', 'pt-BR'];

export function Simulator({ project, mode, colors, countries, state, internal, onChange, onCopyLink, linkCopied }: SimulatorProps) {
  const { t, c, ui } = useI18n();
  const [country, sub] = (state.region ?? '').split('-');
  const [regions, setRegions] = useState<RegionInfo[] | null>(null);
  const [loadingRegions, setLoadingRegions] = useState(false);

  useEffect(() => {
    let alive = true;
    setRegions(null);
    if (!country) return;
    setLoadingRegions(true);
    loadCountry(country)
      .then((file) => alive && setRegions(file?.regions ?? []))
      .catch(() => alive && setRegions([]))
      .finally(() => alive && setLoadingRegions(false));
    return () => {
      alive = false;
    };
  }, [country]);

  const selection = useMemo(() => {
    if (!country) return null;
    return selectConfig(
      project,
      {
        countryCode: country === 'UNKNOWN' ? 'Unknown' : country,
        subdivisionCode: sub ?? 'Unknown',
        browserLanguage: state.blang || null,
        documentLanguage: state.hlang,
        useDocumentLang: state.logic === 'html',
        cookiesVersion: state.cv || null,
        pagePath: state.page || '/',
      },
      { forceGeolocation: mode === 'preview' },
    );
  }, [project, mode, country, sub, state.blang, state.hlang, state.logic, state.cv, state.page]);

  const configLanguages = languagesOf(project).filter((l) => l !== OTHER_LANGUAGE);
  const languageOptions = [...new Set([...configLanguages, ...COMMON_LANGUAGES])];
  const placeLabel = country ? (country === 'UNKNOWN' ? t.simulator.unknownCountry : c.place(state.region!)) : '';

  // The trace names the place inside sentences ("The United States falls under CCPA").
  const placeInText = country && country !== 'UNKNOWN' ? c.placeIn(state.region!) : placeLabel;
  const lines = selection ? traceLines(selection.trace, placeInText) : [];

  function traceLines(trace: TraceEntry[], place: string): Array<{ text: string; decisive: boolean }> {
    return trace.map((entry) => {
      switch (entry.kind) {
        case 'language':
          return { text: t.trace.language(entry.source, entry.raw, entry.key), decisive: false };
        case 'regulation':
          return { text: t.trace.regulation(place, entry.regulation, c), decisive: false };
        case 'visibility':
          return { text: t.trace.visibility(entry.allowed, entry.passed, c), decisive: !entry.passed };
        case 'geolocation':
          return { text: t.trace.geolocation(entry.enabled, entry.forced), decisive: false };
        case 'candidates':
          return { text: t.trace.candidates(entry, selection?.regulation, c), decisive: Boolean(entry.winner) };
        case 'stop':
          return { text: t.trace.stop, decisive: false };
        case 'fallback':
          return { text: t.trace.fallback(entry.configId, entry.found, c), decisive: entry.found };
        case 'nonGeo':
          return { text: t.trace.nonGeo(entry, c), decisive: Boolean(entry.winner) };
        case 'abTest':
          return { text: t.trace.abTest(entry.testId, entry.variants, c), decisive: false };
      }
    });
  }

  const config = selection?.config ?? null;

  return (
    <div class="simulator">
      <p class="panel-intro">{t.simulator.intro}</p>
      <div class="form-grid">
        <label class="field">
          <span>{t.simulator.country}</span>
          <select
            value={country || ''}
            onChange={(e) => onChange({ region: (e.currentTarget as HTMLSelectElement).value || undefined })}
          >
            <option value="">{t.simulator.pickRegion}</option>
            <option value="UNKNOWN">{t.simulator.unknownCountry}</option>
            {countries.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>{t.simulator.subregion}</span>
          <select
            value={sub ?? ''}
            disabled={!country || country === 'UNKNOWN' || !regions || regions.length === 0}
            onChange={(e) => {
              const value = (e.currentTarget as HTMLSelectElement).value;
              onChange({ region: value ? `${country}-${value}` : country });
            }}
          >
            <option value="">{loadingRegions ? t.simulator.loadingRegions : t.simulator.anyRegion}</option>
            {(regions ?? []).map((r) => (
              <option key={r.code} value={r.code}>
                {ui === 'fr' ? r.fr : r.en} ({r.code})
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>{t.simulator.browserLanguage}</span>
          <input
            type="text"
            list="sim-languages"
            value={state.blang}
            spellcheck={false}
            onInput={(e) => onChange({ blang: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label class="field">
          <span>{t.simulator.pageLanguage}</span>
          <input
            type="text"
            list="sim-languages"
            value={state.hlang}
            spellcheck={false}
            onInput={(e) => onChange({ hlang: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <datalist id="sim-languages">
          {languageOptions.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>

      <fieldset class="segmented">
        <legend>{t.simulator.logic}</legend>
        <label>
          <input type="radio" name="logic" checked={state.logic === 'browser'} onChange={() => onChange({ logic: 'browser' })} />
          <span>{t.simulator.logicBrowser}</span>
        </label>
        <label>
          <input type="radio" name="logic" checked={state.logic === 'html'} onChange={() => onChange({ logic: 'html' })} />
          <span>{t.simulator.logicHtml}</span>
        </label>
      </fieldset>
      <p class="field-hint">{t.simulator.logicHint}</p>

      <details class="site-settings" open={Boolean(state.cv || state.page)}>
        <summary>{t.simulator.siteSettings}</summary>
        <div class="form-grid">
          <label class="field">
            <span>{t.simulator.cookiesVersion}</span>
            <select value={state.cv} onChange={(e) => onChange({ cv: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="">–</option>
              {(project.cookies ?? []).map((cfg) => (
                <option key={cfg.identifier} value={cfg.name ?? ''}>
                  {cfg.name}
                </option>
              ))}
            </select>
            <small>{t.simulator.cookiesVersionHint}</small>
          </label>
          <label class="field">
            <span>{t.simulator.pagePath}</span>
            <input
              type="text"
              value={state.page}
              placeholder="/"
              spellcheck={false}
              onInput={(e) => onChange({ page: (e.currentTarget as HTMLInputElement).value })}
            />
            <small>{t.simulator.pagePathHint}</small>
          </label>
        </div>
      </details>

      {selection && (
        <section class="sim-result" aria-live="polite">
          <h3>{t.simulator.result}</h3>
          <div class="sim-winner">
            <span class="swatch swatch-lg" style={{ background: colorOf(colors, config?.identifier) }} />
            <div>
              <strong>{config ? config.name || config.title || config.identifier : selection.step === 'visibility' ? t.simulator.resultHidden : t.simulator.resultNone}</strong>
              <span class="sim-meta">
                {[
                  config?.language ? c.language(config.language.substring(0, 2).toLowerCase()) : null,
                  config?.regulation ? c.regulation(config.regulation) : null,
                  t.steps[selection.step],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {internal && config && project.projectId && (
              <a class="icon-link" href={ADMIN_CONFIG_URL(project.projectId, config.identifier)} target="_blank" rel="noopener noreferrer" title={t.legend.admin}>
                <Icon name="external" size={16} />
                <span class="sr-only">{t.legend.admin}</span>
              </a>
            )}
          </div>
          <h4>{t.simulator.why}</h4>
          <ol class="trace">
            {lines.map((line, i) => (
              <li key={i} class={line.decisive ? 'decisive' : undefined}>
                {line.text}
              </li>
            ))}
          </ol>
          <button type="button" class="button button-ghost" onClick={onCopyLink}>
            <Icon name={linkCopied ? 'check' : 'link'} size={16} /> {linkCopied ? t.map.linkCopied : t.simulator.copyScenario}
          </button>
        </section>
      )}
      {!selection && <p class="panel-note">{t.simulator.pickRegion}</p>}
    </div>
  );
}
