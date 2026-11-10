import { useEffect, useState, useSyncExternalStore } from 'react';
import { lsGet, lsSet } from './storage';

/* ───────────── router (no library needed for four routes) ───────────── */

const ROUTE_EVENT = 'gaffer:route';

export function navigate(to: string, replace = false): void {
  if (location.pathname + location.search === to) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(ROUTE_EVENT));
  window.scrollTo(0, 0);
}

function subscribePath(fn: () => void) {
  window.addEventListener('popstate', fn);
  window.addEventListener(ROUTE_EVENT, fn);
  return () => {
    window.removeEventListener('popstate', fn);
    window.removeEventListener(ROUTE_EVENT, fn);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribePath, () => location.pathname, () => '/');
}

/** Jump to the top whenever `key` changes (e.g. the game moves from lobby to draft). */
export function useScrollTop(key: string): void {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [key]);
}

/* ───────────── time ───────────── */

/** Re-renders every `ms` while `active`. Returns Date.now(). */
export function useTicker(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}

/** requestAnimationFrame clock for smooth match playback. */
export function useFrameClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

/* ───────────── theme ───────────── */

export type ThemeChoice = 'system' | 'light' | 'dark';
const themeListeners = new Set<() => void>();
let theme: ThemeChoice = lsGet<ThemeChoice>('theme', 'system');

function applyTheme() {
  const el = document.documentElement;
  if (theme === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', theme);
}

export function setTheme(t: ThemeChoice): void {
  theme = t;
  lsSet('theme', t);
  applyTheme();
  for (const l of themeListeners) l();
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const t = useSyncExternalStore(
    (fn) => {
      themeListeners.add(fn);
      return () => themeListeners.delete(fn);
    },
    () => theme,
    () => 'system' as ThemeChoice,
  );
  return [t, setTheme];
}

/* ───────────── small helpers ───────────── */

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false));
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Announce something to screen readers without moving focus. */
export function announce(text: string): void {
  const el = document.getElementById('live-region');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => {
    el.textContent = text;
  }, 30);
}

/* ───────────── toasts ───────────── */

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'good';
}
let toasts: Toast[] = [];
let toastId = 1;
const toastListeners = new Set<() => void>();

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t: Toast = { id: toastId++, text, kind };
  toasts = [...toasts.slice(-2), t];
  for (const l of toastListeners) l();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    for (const l of toastListeners) l();
  }, kind === 'error' ? 5200 : 3200);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
    () => toasts,
  );
}
