import type { Feature, Geometry } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { assignColors, colorOf, slotVar } from './app/colors';
import { loadCountry, loadWorld, type CountryFile, type CountryProps } from './app/geo';
import { clearRecent, fetchProject, readRecent, rememberProject, type LoadedProject, type LoadError, type RecentProject } from './app/project';
import { readUrlState, shareUrl, writeUrlState, type Tab, type UrlState } from './app/url';
import { EmptyState, Footer, GeoOffBanner, Header, LoadErrorMessage, Summary, type ThemeChoice } from './components/Chrome';
import { Diagnostics } from './components/Diagnostics';
import { Icon } from './components/Icon';
import { coverageOf, Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { RegionTable } from './components/RegionTable';
import { Simulator, type SimulatorState } from './components/Simulator';
import { diagnose, type Finding } from './engine/diagnostics';
import { countriesWithSubdivisions, defaultModeOf, evaluateProject, OTHER_LANGUAGE, type EvaluationMode } from './engine/evaluate';
import { selectConfig } from './engine/select';
import { buildCopyContext, detectUiLanguage, I18nContext, MESSAGES, type PlaceNames, type UiLanguage } from './i18n';
import { exportMapPng } from './lib/export-png';

const THEME_KEY = 'cookies-atlas:theme';

function readTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const browserLanguage = () => (typeof navigator !== 'undefined' && navigator.language) || 'en';

export function App() {
  const initial = useMemo(() => readUrlState(), []);
  const [ui, setUi] = useState<UiLanguage>(initial.ui ?? detectUiLanguage());
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [projectId, setProjectId] = useState(initial.project ?? '');
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>(readRecent);
  const [modeChoice, setModeChoice] = useState<EvaluationMode | undefined>(initial.mode);
  const [mapLanguage, setMapLanguage] = useState<string>(initial.lang ?? 'all');
  const [tab, setTab] = useState<Tab>(initial.tab ?? 'banners');
  const [isolated, setIsolated] = useState<string | null>(initial.focus ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [sim, setSim] = useState<SimulatorState>({
    region: initial.region,
    blang: initial.blang ?? browserLanguage(),
    hlang: initial.hlang ?? '',
    logic: initial.logic ?? 'browser',
    cv: initial.cv ?? '',
    page: initial.page ?? '',
  });
  const [world, setWorld] = useState<Array<Feature<Geometry, CountryProps>> | null>(null);
  const [splits, setSplits] = useState<CountryFile[]>([]);
  const [copied, setCopied] = useState<'map' | 'scenario' | null>(null);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const internal = initial.internal ?? false;

  const project = loaded?.project ?? null;
  const geolocationOn = Boolean(project?.client?.cookiesSettings?.geolocation);
  const defaultMode: EvaluationMode = project ? defaultModeOf(project) : 'actual';
  const mode: EvaluationMode = geolocationOn ? 'actual' : (modeChoice ?? defaultMode);

  // --- Effects -------------------------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* optional */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = ui === 'fr' ? 'fr-CA' : 'en';
  }, [ui]);

  useEffect(() => {
    loadWorld().then(setWorld).catch(() => setWorld([]));
  }, []);

  // Load the project whenever the ID changes.
  useEffect(() => {
    if (!projectId) {
      setLoaded(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchProject(projectId, controller.signal)
      .then((result) => {
        setLoaded(result);
        setRecent(rememberProject({ id: projectId, name: result.project.projectName ?? projectId }));
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setLoaded(null);
        setError(((err as { code?: LoadError }).code ?? 'network') as LoadError);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId]);

  // Subdivision files for the countries drawn split (CA, US, and any country a banner targets by region).
  useEffect(() => {
    if (!project) {
      setSplits([]);
      return;
    }
    let alive = true;
    Promise.all(countriesWithSubdivisions(project).map((cc) => loadCountry(cc).catch(() => null))).then((files) => {
      if (alive) setSplits(files.filter((f): f is CountryFile => f !== null));
    });
    return () => {
      alive = false;
    };
  }, [project]);

  useEffect(() => {
    document.title = project?.projectName ? `${project.projectName} · Cookies Atlas` : 'Cookies Atlas';
  }, [project]);

  // --- Derived data ----------------------------------------------------------------------------
  const now = loaded?.fetchedAt ?? Date.now();
  const evaluations = useMemo(() => {
    if (!project) return null;
    const actual = evaluateProject(project, { mode: 'actual', visitor: { now } });
    const preview = geolocationOn ? null : evaluateProject(project, { mode: 'preview', visitor: { now } });
    return { actual, preview };
  }, [project, geolocationOn, now]);

  const evaluation = evaluations ? (mode === 'preview' && evaluations.preview ? evaluations.preview : evaluations.actual) : null;
  const diagnosisEvaluation = evaluations ? (evaluations.preview ?? evaluations.actual) : null;
  const findings = useMemo(
    () => (project && diagnosisEvaluation ? diagnose(project, diagnosisEvaluation, now) : []),
    [project, diagnosisEvaluation, now],
  );
  const colors = useMemo(
    () =>
      project && evaluations
        ? assignColors(project, [evaluations.actual, evaluations.preview].filter((e): e is NonNullable<typeof e> => e !== null))
        : { slotOf: new Map<string, number | 'other'>(), others: [] },
    [project, evaluations],
  );

  const splitSet = useMemo(() => new Set(splits.map((s) => s.country)), [splits]);
  const names = useMemo<PlaceNames>(() => {
    const countries = new Map((world ?? []).map((f) => [f.properties.id, f.properties]));
    const regions = new Map<string, { en: string; fr: string }>();
    for (const file of splits) for (const r of file.regions) regions.set(`${file.country}-${r.code}`, r);
    return {
      country: (code, l) => countries.get(code)?.[l],
      region: (country, code, l) => regions.get(`${country}-${code}`)?.[l],
      isSplit: (country) => splitSet.has(country),
    };
  }, [world, splits, splitSet]);

  const i18n = useMemo(() => ({ ui, t: MESSAGES[ui], c: buildCopyContext(ui, project, names) }), [ui, project, names]);
  const { t, c } = i18n;

  const viewer = loaded?.viewer ?? null;
  const viewerKey = viewer?.country ? (viewer.region ? `${viewer.country}-${viewer.region}` : viewer.country) : undefined;
  const viewerSelection = useMemo(
    () =>
      project && viewer
        ? selectConfig(project, {
            countryCode: viewer.country ?? 'Unknown',
            subdivisionCode: viewer.region ?? 'Unknown',
            browserLanguage: browserLanguage(),
            now,
          })
        : null,
    [project, viewer, now],
  );

  const countryOptions = useMemo(
    () =>
      (world ?? [])
        .map((f) => ({ code: f.properties.id, name: ui === 'fr' ? f.properties.fr : f.properties.en }))
        .sort((a, b) => a.name.localeCompare(b.name, ui === 'fr' ? 'fr' : 'en')),
    [world, ui],
  );

  const simRegion = sim.region ?? viewerKey;
  const languages = evaluation?.languages ?? [];
  const effectiveLanguage = mapLanguage !== 'all' && !languages.includes(mapLanguage) ? OTHER_LANGUAGE : mapLanguage;

  // --- URL state -------------------------------------------------------------------------------
  const urlState: UrlState = {
    project: projectId || undefined,
    lang: mapLanguage === 'all' ? undefined : mapLanguage,
    region: sim.region,
    blang: sim.blang && sim.blang !== browserLanguage() ? sim.blang : undefined,
    hlang: sim.hlang ? sim.hlang : undefined,
    logic: sim.logic,
    cv: sim.cv || undefined,
    page: sim.page || undefined,
    mode: !geolocationOn && modeChoice ? modeChoice : undefined,
    ui: initial.ui || ui !== detectUiLanguage() ? ui : undefined,
    tab: tab === 'banners' ? undefined : tab,
    focus: isolated ?? undefined,
    internal,
  };
  useEffect(() => writeUrlState(urlState), [JSON.stringify(urlState)]);

  // --- Actions --------------------------------------------------------------------------------
  const openProject = (id: string) => {
    setIsolated(null);
    setActiveFinding(null);
    setModeChoice(undefined);
    setMapLanguage('all');
    if (id === projectId && error) {
      // Retry the same ID.
      setProjectId('');
      setTimeout(() => setProjectId(id), 0);
    } else setProjectId(id);
  };

  const flashCopied = (what: 'map' | 'scenario') => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const copyLink = async (scenario: boolean) => {
    const state: UrlState = scenario
      ? { ...urlState, tab: 'simulator', region: simRegion, blang: sim.blang || undefined, hlang: sim.hlang, logic: sim.logic }
      : urlState;
    const url = shareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers or blocked clipboard API: fall back to a hidden textarea.
      const area = document.createElement('textarea');
      area.value = url;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    flashCopied(scenario ? 'scenario' : 'map');
  };

  const selectRegion = (key: string) => {
    setSim((s) => ({ ...s, region: key }));
    setTab('simulator');
  };

  const isolate = (id: string | null) => {
    setIsolated(id);
    if (id) setActiveFinding(null);
  };

  const exportPng = async () => {
    if (!project || !evaluation || !svgRef.current) return;
    setExporting(true);
    try {
      const css = getComputedStyle(document.documentElement);
      const resolve = (cssVar: string) => css.getPropertyValue(cssVar.replace(/^var\((--[^)]+)\)$/, '$1')).trim() || '#999999';
      const legend = (project.cookies ?? [])
        .filter((cfg) => (evaluation.wins.get(cfg.identifier)?.size ?? 0) > 0)
        .map((cfg) => {
          const cov = coverageOf(evaluation, cfg.identifier);
          return { color: resolve(colorOf(colors, cfg.identifier)), label: cfg.name || cfg.identifier, detail: t.legend.wins(cov.countries, cov.regions) };
        });
      await exportMapPng({
        svg: svgRef.current,
        title: project.projectName || project.projectId || 'Cookies Atlas',
        subtitle: [
          mode === 'preview' ? t.map.previewBadge : geolocationOn ? t.summary.geoOn : t.map.todayBadge,
          `${t.map.language}: ${effectiveLanguage === 'all' ? t.map.allLanguages : c.language(effectiveLanguage)}`,
          isolated ? `${t.legend.isolate}: ${c.config(isolated)}` : null,
          tab === 'diagnostics' && activeFinding ? t.diagnostics.finding(activeFinding, c).title : null,
        ]
          .filter(Boolean)
          .join(' · '),
        legend,
        keyItems: [
          { color: resolve(slotVar(0)), label: t.map.keySolid },
          { color: resolve('var(--key-light)'), label: t.map.keyLight },
          { color: resolve('var(--no-banner)'), label: t.map.keyNone },
        ],
        footer: `Cookies Atlas · ${c.date(new Date().toISOString())} · ${shareUrl({ ...urlState, internal: false })}`,
        fileName: `cookies-atlas-${(project.projectName || project.projectId || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
  };

  const geoOffFinding = findings.find((f) => f.kind === 'geolocation-off');

  // --- Render ---------------------------------------------------------------------------------
  return (
    <I18nContext.Provider value={i18n}>
      <div class="app">
        <Header
          hasProject={Boolean(projectId)}
          projectId={projectId}
          recent={recent}
          loading={loading}
          ui={ui}
          theme={theme}
          onSubmit={openProject}
          onClearRecent={() => setRecent(clearRecent())}
          onUi={setUi}
          onTheme={setTheme}
          onHome={() => {
            setProjectId('');
            setSim((s) => ({ ...s, region: undefined }));
          }}
        />
        <main class="app-main">
          {!projectId && <EmptyState recent={recent} loading={loading} error={error} onSubmit={openProject} onClearRecent={() => setRecent(clearRecent())} />}

          {projectId && loading && !project && (
            <p class="loading" role="status">
              <span class="spinner" aria-hidden="true" /> {t.load.loading}
            </p>
          )}

          {projectId && error && !loading && (
            <section class="error-state">
              <LoadErrorMessage error={error} />
              {error === 'network' && (
                <button type="button" class="button" onClick={() => openProject(projectId)}>
                  {t.load.retry}
                </button>
              )}
            </section>
          )}

          {project && evaluation && (
            <div class={`workspace${loading ? ' refreshing' : ''}`}>
              <Summary project={project} colors={colors} viewer={viewer} viewerSelection={viewerSelection} internal={internal} />
              {!geolocationOn && (
                <GeoOffBanner
                  banner={c.config((geoOffFinding?.data.defaultConfig as string | null) ?? null)}
                  hasPageRules={Boolean(geoOffFinding?.data.hasPageRules)}
                  mode={mode}
                  onMode={setModeChoice}
                />
              )}
              <div class="layout">
                <figure class="map-card">
                  <div class="map-toolbar">
                    <div class="chips" role="group" aria-label={t.map.language}>
                      <span class="toolbar-label">{t.map.language}</span>
                      {['all', ...languages].map((l) => (
                        <button key={l} type="button" class="chip" aria-pressed={effectiveLanguage === l} onClick={() => setMapLanguage(l)}>
                          {l === 'all' ? t.map.allLanguages : l === OTHER_LANGUAGE ? t.map.otherLanguages : l.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <div class="toolbar-actions">
                      {!geolocationOn && <span class={`mode-badge mode-${mode}`}>{mode === 'preview' ? t.map.previewBadge : t.map.todayBadge}</span>}
                      <button type="button" class="button button-ghost" onClick={() => copyLink(false)}>
                        <Icon name={copied === 'map' ? 'check' : 'link'} size={16} /> {copied === 'map' ? t.map.linkCopied : t.map.copyLink}
                      </button>
                      <button type="button" class="button button-ghost" onClick={exportPng} disabled={exporting}>
                        <Icon name="download" size={16} /> {exporting ? t.map.exporting : t.map.export}
                      </button>
                    </div>
                  </div>
                  {world ? (
                    <MapView
                      world={world}
                      splits={splits}
                      evaluation={evaluation}
                      colors={colors}
                      language={effectiveLanguage}
                      focus={hovered ?? isolated}
                      highlight={tab === 'diagnostics' ? (activeFinding?.regions ?? null) : null}
                      selected={tab === 'simulator' ? (simRegion ?? null) : null}
                      viewer={viewer}
                      ariaLabel={t.map.ariaLabel(project.projectName ?? '')}
                      onSelect={selectRegion}
                      svgRef={svgRef}
                    />
                  ) : (
                    <div class="map-placeholder" role="status">
                      <span class="spinner" aria-hidden="true" />
                    </div>
                  )}
                  <figcaption class="sr-only">{t.map.ariaLabel(project.projectName ?? '')}</figcaption>
                </figure>

                <aside class="panel">
                  <div class="tabs" role="tablist">
                    {(['banners', 'simulator', 'diagnostics', 'table'] as Tab[]).map((name) => (
                      <button
                        key={name}
                        type="button"
                        role="tab"
                        id={`tab-${name}`}
                        aria-selected={tab === name}
                        aria-controls={`panel-${name}`}
                        onClick={() => setTab(name)}
                      >
                        {t.tabs[name]}
                        {name === 'diagnostics' && counts.error + counts.warning > 0 && (
                          <span class={`count ${counts.error ? 'count-error' : 'count-warning'}`}>{counts.error + counts.warning}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div class="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                    {tab === 'banners' && (
                      <Legend
                        project={project}
                        evaluation={evaluation}
                        colors={colors}
                        isolated={isolated}
                        internal={internal}
                        onHover={setHovered}
                        onIsolate={isolate}
                      />
                    )}
                    {tab === 'simulator' && (
                      <Simulator
                        project={project}
                        mode={mode}
                        colors={colors}
                        countries={countryOptions}
                        state={{ ...sim, region: simRegion }}
                        internal={internal}
                        onChange={(patch) => setSim((s) => ({ ...s, ...patch }))}
                        onCopyLink={() => copyLink(true)}
                        linkCopied={copied === 'scenario'}
                      />
                    )}
                    {tab === 'diagnostics' && (
                      <Diagnostics
                        project={project}
                        findings={findings}
                        colors={colors}
                        preview={!geolocationOn}
                        activeFinding={activeFinding?.id ?? null}
                        onShow={(f) => {
                          setActiveFinding(f);
                          if (f) setIsolated(null);
                        }}
                        onIsolate={(id) => {
                          isolate(id);
                          setTab('banners');
                        }}
                      />
                    )}
                    {tab === 'table' && (
                      <RegionTable project={project} evaluation={evaluation} colors={colors} language={effectiveLanguage} onSelect={selectRegion} />
                    )}
                  </div>
                </aside>
              </div>
            </div>
          )}
        </main>
        <Footer />
      </div>
    </I18nContext.Provider>
  );
}
