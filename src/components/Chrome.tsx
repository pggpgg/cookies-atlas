/** App chrome: header with the project form, summary strip, geolocation-off banner, empty state, footer. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorOf, type ColorAssignment } from '../app/colors';
import { ADMIN_PROJECT_URL, type LoadError, type RecentProject, type ViewerLocation } from '../app/project';
import { PROJECT_ID_RE } from '../app/url';
import type { EvaluationMode } from '../engine/evaluate';
import type { Selection } from '../engine/select';
import type { AxeptioProject } from '../engine/types';
import { useI18n, type UiLanguage } from '../i18n';
import { appUrl, bookmarkletCode } from '../lib/bookmarklet';
import { Icon, Logo } from './Icon';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const EXAMPLE_PROJECT = '624d5e22e4776e1f019014e2';
/** When src/engine/regions.ts and the selection logic were last checked against sdk.js. */
export const SDK_SNAPSHOT_DATE = '2026-10-28T12:00:00Z';

export function ProjectForm(props: {
  initial: string;
  recent: RecentProject[];
  loading: boolean;
  compact?: boolean;
  onSubmit: (id: string) => void;
  onClearRecent: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(props.initial);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setValue(props.initial), [props.initial]);

  const submit = (e: Event) => {
    e.preventDefault();
    // Accept a pasted URL or JSON path too: keep the first 24-hex run.
    const match = value.match(/[a-f0-9]{24}/i);
    const id = match ? match[0].toLowerCase() : value.trim();
    if (!PROJECT_ID_RE.test(id)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setValue(id);
    props.onSubmit(id);
  };

  return (
    <form class={`project-form${props.compact ? ' compact' : ''}`} onSubmit={submit} role="search">
      <label class="sr-only" for="project-id">
        {t.input.label}
      </label>
      <div class="input-row">
        <Icon name="search" size={18} />
        <input
          id="project-id"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellcheck={false}
          placeholder={t.input.placeholder}
          value={value}
          list="recent-projects"
          aria-invalid={invalid}
          aria-describedby={invalid ? 'project-id-error' : undefined}
          onInput={(e) => {
            setValue((e.currentTarget as HTMLInputElement).value);
            setInvalid(false);
          }}
        />
        <button type="submit" class="button button-primary" disabled={props.loading}>
          {t.input.submit}
        </button>
      </div>
      <datalist id="recent-projects">
        {props.recent.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </datalist>
      {invalid && (
        <p class="form-error" id="project-id-error" role="alert">
          {t.input.invalid}
        </p>
      )}
    </form>
  );
}

export function Header(props: {
  hasProject: boolean;
  projectId: string;
  recent: RecentProject[];
  loading: boolean;
  ui: UiLanguage;
  theme: ThemeChoice;
  onSubmit: (id: string) => void;
  onClearRecent: () => void;
  onUi: (ui: UiLanguage) => void;
  onTheme: (theme: ThemeChoice) => void;
  onHome: () => void;
}) {
  const { t } = useI18n();
  const nextTheme: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
  const themeIcon = { system: 'monitor', light: 'sun', dark: 'moon' }[props.theme];
  return (
    <header class="app-header">
      <a
        class="brand"
        href={appUrl()}
        onClick={(e) => {
          e.preventDefault();
          props.onHome();
        }}
      >
        <Logo />
        <span>{t.app.title}</span>
      </a>
      {props.hasProject && (
        <ProjectForm
          compact
          initial={props.projectId}
          recent={props.recent}
          loading={props.loading}
          onSubmit={props.onSubmit}
          onClearRecent={props.onClearRecent}
        />
      )}
      <div class="header-tools">
        <div class="segmented-mini" role="group" aria-label={t.uiLanguage}>
          {(['fr', 'en'] as UiLanguage[]).map((l) => (
            <button key={l} type="button" aria-pressed={props.ui === l} onClick={() => props.onUi(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="icon-button"
          onClick={() => props.onTheme(nextTheme[props.theme])}
          title={`${t.theme.label}: ${t.theme[props.theme]}`}
          aria-label={`${t.theme.label}: ${t.theme[props.theme]}`}
        >
          <Icon name={themeIcon} />
        </button>
      </div>
    </header>
  );
}

export function Summary(props: {
  project: AxeptioProject;
  colors: ColorAssignment;
  viewer: ViewerLocation | null;
  viewerSelection: Selection | null;
  internal: boolean;
}) {
  const { t, c } = useI18n();
  const [copied, setCopied] = useState(false);
  const settings = props.project.client?.cookiesSettings;
  const geo = Boolean(settings?.geolocation);
  const fallbackId = settings?.geolocationFallbackConfigId ?? null;
  const allowed = settings?.isBannerVisibilityEnabled ? (settings.allowedCountries ?? []) : null;
  const id = props.project.projectId ?? '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const viewerPlace = props.viewer?.country
    ? c.place(props.viewer.region ? `${props.viewer.country}-${props.viewer.region}` : props.viewer.country)
    : null;
  const viewerConfig = props.viewerSelection?.config ?? null;

  return (
    <section class="summary" aria-label={props.project.projectName}>
      <div class="summary-main">
        <h1>{props.project.projectName || id}</h1>
        <div class="summary-id">
          <code>{id}</code>
          <button type="button" class="icon-button small" onClick={copy} title={t.summary.copyId} aria-label={t.summary.copyId}>
            <Icon name={copied ? 'check' : 'copy'} size={15} />
          </button>
          {props.internal && id && (
            <a class="icon-button small" href={ADMIN_PROJECT_URL(id)} target="_blank" rel="noopener noreferrer" title={t.summary.openAdmin}>
              <Icon name="external" size={15} />
              <span class="sr-only">{t.summary.openAdmin}</span>
            </a>
          )}
        </div>
      </div>
      <ul class="summary-facts">
        <li class={`fact ${geo ? 'fact-good' : 'fact-warn'}`}>
          <Icon name={geo ? 'check' : 'warning'} size={15} />
          {geo ? t.summary.geoOn : t.summary.geoOff}
        </li>
        {geo && <li class="fact">{fallbackId ? t.summary.fallback(c.config(fallbackId)) : t.summary.noFallback}</li>}
        <li class="fact">{t.summary.banners(props.project.cookies?.length ?? 0)}</li>
        {allowed && <li class="fact fact-warn">{t.summary.visibility(allowed.length)}</li>}
        {props.project.publishedAt && <li class="fact">{t.summary.published(c.date(props.project.publishedAt))}</li>}
      </ul>
      <p class="summary-viewer">
        <span class="key-pin" aria-hidden="true" />
        {viewerPlace ? (
          viewerConfig ? (
            <>
              {t.summary.youGet(viewerPlace, c.config(viewerConfig.identifier))}
              <span class="chip-swatch" style={{ background: colorOf(props.colors, viewerConfig.identifier) }} />
            </>
          ) : (
            t.summary.youNoBanner(viewerPlace)
          )
        ) : (
          t.summary.youUnknown
        )}
      </p>
    </section>
  );
}

export function GeoOffBanner(props: { banner: string; hasPageRules: boolean; mode: EvaluationMode; onMode: (mode: EvaluationMode) => void }) {
  const { t } = useI18n();
  return (
    <section class="geo-off" role="status">
      <div class="geo-off-text">
        <h2>
          <Icon name="warning" size={18} /> {t.geoOff.title}
        </h2>
        <p>{t.geoOff.body(props.banner, props.hasPageRules)}</p>
        <p class="muted">{t.geoOff.fix}</p>
      </div>
      <div class="segmented-mini large" role="group">
        <button type="button" aria-pressed={props.mode === 'preview'} onClick={() => props.onMode('preview')}>
          {t.geoOff.preview}
        </button>
        <button type="button" aria-pressed={props.mode === 'actual'} onClick={() => props.onMode('actual')}>
          {t.geoOff.today}
        </button>
      </div>
    </section>
  );
}

export function Bookmarklet() {
  const { t } = useI18n();
  const ref = useRef<HTMLAnchorElement>(null);
  // Set through the DOM: frameworks may refuse javascript: URLs in JSX.
  useEffect(() => {
    ref.current?.setAttribute('href', bookmarkletCode(appUrl(), t.bookmarklet.notFound));
  }, [t]);
  return (
    <div class="bookmarklet">
      <a ref={ref} class="bookmarklet-link" onClick={(e) => e.preventDefault()} draggable>
        <Icon name="bookmark" size={16} /> {t.bookmarklet.linkLabel}
      </a>
      <p>{t.bookmarklet.body}</p>
    </div>
  );
}

export function EmptyState(props: { recent: RecentProject[]; loading: boolean; error: LoadError | null; onSubmit: (id: string) => void; onClearRecent: () => void }) {
  const { t } = useI18n();
  return (
    <section class="empty">
      <div class="empty-hero">
        <Logo size={56} />
        <h1>{t.empty.title}</h1>
        <p class="lead">{t.empty.body}</p>
        <ProjectForm initial="" recent={props.recent} loading={props.loading} onSubmit={props.onSubmit} onClearRecent={props.onClearRecent} />
        {props.error && <LoadErrorMessage error={props.error} />}
        <div class="empty-links">
          <button type="button" class="text-button" onClick={() => props.onSubmit(EXAMPLE_PROJECT)}>
            {t.input.example}
          </button>
          {props.recent.length > 0 && (
            <div class="recent">
              <span>{t.input.recent}</span>
              {props.recent.map((r) => (
                <button key={r.id} type="button" class="chip" onClick={() => props.onSubmit(r.id)}>
                  {r.name || r.id}
                </button>
              ))}
              <button type="button" class="text-button small" onClick={props.onClearRecent}>
                {t.input.clearRecent}
              </button>
            </div>
          )}
        </div>
      </div>
      <ol class="empty-steps">
        {t.empty.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <Bookmarklet />
    </section>
  );
}

export function LoadErrorMessage({ error }: { error: LoadError }) {
  const { t } = useI18n();
  return (
    <p class="load-error" role="alert">
      <Icon name="error" size={16} /> {t.load[error]}
    </p>
  );
}

export function Footer() {
  const { t, c } = useI18n();
  return (
    <footer class="app-footer">
      <p>
        {t.app.sourceNote} {t.app.sdkDate(c.date(SDK_SNAPSHOT_DATE))} {t.footer.disclaimer}
      </p>
      <p>
        <a href="https://github.com/pggpgg/cookies-atlas" target="_blank" rel="noopener noreferrer">
          {t.app.repo}
        </a>
      </p>
    </footer>
  );
}
