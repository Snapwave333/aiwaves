import { InjectionToken } from '@angular/core';

/**
 * Runtime configuration, read from the page URL so one build works everywhere:
 *   ?api=http://127.0.0.1:8787   backend base URL (default: same origin, i.e. the dev proxy or `aiwaves serve --static`)
 *   ?project=longing             project id (default: the first one the backend lists)
 *   ?audio=<url>                 audio to play in demo mode (default: demo/longing/audio/master.wav)
 *   ?mock=1                      force demo data even if the backend is up
 */
export interface AppConfig {
  apiBase: string;
  projectId: string | null;
  audioUrl: string | null;
  forceMock: boolean;
  demoBase: string;
}

export function readConfig(search: string): AppConfig {
  const q = new URLSearchParams(search);
  return {
    apiBase: (q.get('api') ?? '').replace(/\/+$/, ''),
    projectId: q.get('project'),
    audioUrl: q.get('audio'),
    forceMock: q.get('mock') === '1' || q.get('mock') === 'true',
    demoBase: 'demo/longing',
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => readConfig(typeof location === 'undefined' ? '' : location.search),
});
