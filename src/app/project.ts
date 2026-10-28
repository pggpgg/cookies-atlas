import type { AxeptioProject } from '../engine/types';

export const PROJECT_URL = (id: string) => `https://client.axept.io/projectconfigurations/brands/${id}.json`;
export const ADMIN_PROJECT_URL = (projectId: string) => `https://admin.axeptio.eu/projects/${projectId}/cookies`;
export const ADMIN_CONFIG_URL = (projectId: string, configId: string) =>
  `https://admin.axeptio.eu/projects/${projectId}/cookies/${configId}`;

/** Where Axeptio's CDN places the viewer (same headers the SDK reads). */
export interface ViewerLocation {
  country: string | null;
  region: string | null;
}

export type LoadError = 'notFound' | 'network' | 'invalid' | 'empty';

export interface LoadedProject {
  project: AxeptioProject;
  viewer: ViewerLocation;
  fetchedAt: number;
}

const clean = (value: string | null) => {
  const v = value?.trim();
  return v && v.toLowerCase() !== 'unknown' ? v.toUpperCase() : null;
};

export async function fetchProject(id: string, signal?: AbortSignal): Promise<LoadedProject> {
  let res: Response;
  try {
    // No custom headers or cache mode: anything that triggers a CORS preflight could be refused by the CDN.
    res = await fetch(PROJECT_URL(id), { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw Object.assign(new Error('network'), { code: 'network' as LoadError });
  }
  if (res.status === 403 || res.status === 404) throw Object.assign(new Error('notFound'), { code: 'notFound' as LoadError });
  if (!res.ok) throw Object.assign(new Error('network'), { code: 'network' as LoadError });
  let project: AxeptioProject;
  try {
    project = (await res.json()) as AxeptioProject;
  } catch (err) {
    // Aborted while reading the body: not a broken file.
    if (signal?.aborted) throw err;
    throw Object.assign(new Error('invalid'), { code: 'invalid' as LoadError });
  }
  // Unknown or never-published IDs come back as 200 {"isEmpty": true}.
  if (project && typeof project === 'object' && (project as { isEmpty?: boolean }).isEmpty === true) {
    throw Object.assign(new Error('notFound'), { code: 'notFound' as LoadError });
  }
  if (!project || typeof project !== 'object' || !Array.isArray(project.cookies)) {
    throw Object.assign(new Error('invalid'), { code: 'invalid' as LoadError });
  }
  if (project.cookies.length === 0) throw Object.assign(new Error('empty'), { code: 'empty' as LoadError });
  return {
    project,
    viewer: { country: clean(res.headers.get('X-Viewer-Country')), region: clean(res.headers.get('X-Viewer-Country-Region')) },
    fetchedAt: Date.now(),
  };
}

// Recent projects (a per-browser convenience).
const RECENT_KEY = 'cookies-atlas:recent';
export interface RecentProject {
  id: string;
  name: string;
}

export function readRecent(): RecentProject[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberProject(entry: RecentProject): RecentProject[] {
  const next = [entry, ...readRecent().filter((r) => r.id !== entry.id)].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: recents are optional */
  }
  return next;
}

export function clearRecent(): RecentProject[] {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
  return [];
}
