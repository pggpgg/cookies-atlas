/** Shareable state: everything that matters lives in the query string. */
export type Tab = 'banners' | 'simulator' | 'diagnostics' | 'table';
export type LanguageLogic = 'browser' | 'html';

export interface UrlState {
  project?: string;
  /** Map language: a language key, or undefined for "all languages". */
  lang?: string;
  /** Simulated visitor region, e.g. "CA-ON" or "FR". */
  region?: string;
  blang?: string;
  hlang?: string;
  logic?: LanguageLogic;
  cv?: string;
  page?: string;
  mode?: 'actual' | 'preview';
  ui?: 'en' | 'fr';
  tab?: Tab;
  /** Isolated banner. */
  focus?: string;
  internal?: boolean;
}

const TABS: Tab[] = ['banners', 'simulator', 'diagnostics', 'table'];

export const PROJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function readUrlState(search: string = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const get = (key: string) => {
    const v = p.get(key);
    return v === null || v.trim() === '' ? undefined : v.trim();
  };
  const project = get('project')?.toLowerCase();
  const tab = get('tab') as Tab | undefined;
  const mode = get('mode');
  const ui = get('ui');
  const logic = get('logic');
  return {
    project: project && PROJECT_ID_RE.test(project) ? project : undefined,
    lang: get('lang')?.toLowerCase(),
    region: get('region')?.toUpperCase(),
    blang: get('blang'),
    hlang: p.has('hlang') ? (p.get('hlang') ?? '') : undefined,
    logic: logic === 'html' || logic === 'browser' ? logic : undefined,
    cv: get('cv'),
    page: get('page'),
    mode: mode === 'actual' || mode === 'preview' ? mode : undefined,
    ui: ui === 'fr' || ui === 'en' ? ui : undefined,
    tab: tab && TABS.includes(tab) ? tab : undefined,
    focus: get('focus'),
    internal: p.get('internal') === '1' || p.get('internal') === 'true',
  };
}

export function buildSearch(state: UrlState): string {
  const p = new URLSearchParams();
  const set = (key: string, value: string | undefined | false) => {
    if (value !== undefined && value !== false && value !== '') p.set(key, value);
  };
  set('project', state.project);
  set('lang', state.lang);
  set('region', state.region);
  set('blang', state.blang);
  if (state.hlang !== undefined) p.set('hlang', state.hlang);
  set('logic', state.logic === 'html' ? 'html' : undefined);
  set('cv', state.cv);
  set('page', state.page);
  set('mode', state.mode);
  set('ui', state.ui);
  set('tab', state.tab);
  set('focus', state.focus);
  if (state.internal) p.set('internal', '1');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function writeUrlState(state: UrlState) {
  const search = buildSearch(state);
  if (search !== window.location.search) {
    window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
  }
}

export const shareUrl = (state: UrlState) => `${window.location.origin}${window.location.pathname}${buildSearch(state)}`;
