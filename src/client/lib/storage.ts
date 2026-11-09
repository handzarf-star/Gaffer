// Every storage call is wrapped: private windows, blocked cookies and full quotas must never break the game.

const PREFIX = 'gaffer:';

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function lsDel(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export interface Identity {
  id: string;
  secret: string;
  name: string;
  at: number;
}

export const getIdentity = (code: string): Identity | null => lsGet<Identity | null>(`room:${code}`, null);
export const setIdentity = (code: string, i: Identity) => {
  lsSet(`room:${code}`, i);
  lsSet('lastRoom', { code, at: i.at });
};
export const clearIdentity = (code: string) => {
  lsDel(`room:${code}`);
  const last = lsGet<{ code: string } | null>('lastRoom', null);
  if (last?.code === code) lsDel('lastRoom');
};

export const getName = (): string => lsGet<string>('name', '');
export const setName = (n: string) => lsSet('name', n);

export function lastRoom(): { code: string; at: number } | null {
  const last = lsGet<{ code: string; at: number } | null>('lastRoom', null);
  if (!last) return null;
  if (Date.now() - last.at > 6 * 3600_000) return null;
  return last;
}
