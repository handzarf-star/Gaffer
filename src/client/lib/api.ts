// Thin client for /api. Every call includes the cookie; errors are returned as values, never thrown into render code.
import type { CareerView, News } from '../../shared/career/engine';
import type { MatchResult } from '../../shared/sim';
import type { Badge } from '../../shared/career/world';
import type { Squad } from '../../shared/squad';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ApiError = { code: string; msg: string; status: number };
export type Out<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Out<T>> {
  try {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty */ }
    const d = (data ?? {}) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: { code: String(d.code ?? d.error ?? res.status), msg: String(d.msg ?? ''), status: res.status } };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: { code: 'network', msg: '', status: 0 } };
  }
}

export interface Me { user: { name: string; kind: 'google' | 'guest' } | null; googleClientId: string | null }
export interface MyCareer { code: string; club: string; at: number }

export const api = {
  me: () => call<Me>('GET', '/api/me'),
  nonce: () => call<{ nonce: string }>('GET', '/api/auth/nonce'),
  google: (credential: string) => call<Me>('POST', '/api/auth/google', { credential }),
  guest: (name: string) => call<Me>('POST', '/api/auth/guest', { name }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout', {}),
  rename: (name: string) => call<Me>('POST', '/api/auth/name', { name }),
  mine: () => call<{ careers: MyCareer[] }>('GET', '/api/my/careers'),
  create: () => call<{ code: string }>('POST', '/api/career', {}),
  info: (code: string) => call<{ exists: boolean; phase?: string; managers?: number; joinable?: boolean }>('GET', `/api/career/${code}/info`),
  view: (code: string, since?: number) => call<{ rev: number; view?: CareerView; same?: boolean }>('GET', `/api/career/${code}${since !== undefined ? `?since=${since}` : ''}`),
  act: (code: string, msg: Record<string, unknown>) => call<{ ok: true; view: CareerView }>('POST', `/api/career/${code}/act`, msg),
  match: (code: string) => call<{ none?: true; league?: 1 | 2; a?: string; b?: string; result?: MatchResult; squads?: [Squad, Squad] }>('GET', `/api/career/${code}/match`),
};
export type { CareerView, News, Badge };

/** Poll a league. Fast while it matters (draft, matchday open), slow when hidden; the server answers "same" for unchanged state. */
export function useLeague(code: string) {
  const [view, setView] = useState<CareerView | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'offline'>('loading');
  const rev = useRef<number | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const r = await api.view(code, rev.current);
    if (!alive.current) return;
    if (r.ok) {
      setState('ok');
      if (r.data.view) { rev.current = r.data.rev; setView(r.data.view); }
    } else if (r.error.status === 404) setState('missing');
    else setState((s) => (s === 'loading' ? 'offline' : 'offline'));
  }, [code]);

  useEffect(() => {
    alive.current = true;
    const loop = async () => {
      await load();
      if (!alive.current) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      timer.current = window.setTimeout(loop, hidden ? 20_000 : 2_000);
    };
    void loop();
    const onVis = () => { if (!document.hidden) { window.clearTimeout(timer.current); void loop(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive.current = false; window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const apply = useCallback((v: CareerView) => { rev.current = v.rev; setView(v); }, []);
  return { view, state, apply, reload: load };
}
