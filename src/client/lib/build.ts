import { useSyncExternalStore } from 'react';
import { BUILD_META, DEV_BUILD, isStale } from '../../shared/build';

/** The build this page was loaded from, read from the tag Vite wrote into index.html ("dev" when running unbuilt). */
export const MY_BUILD: string = (typeof document !== 'undefined' ? document.querySelector(`meta[name="${BUILD_META}"]`)?.getAttribute('content') : null) || DEV_BUILD;

let stale = false;
const subs = new Set<() => void>();

/** Called with whatever build id the server last showed us (health, socket welcome, x-build header). Once stale, always stale until reload. */
export function reportServerBuild(server: string | null | undefined): void {
  if (!stale && isStale(MY_BUILD, server)) {
    stale = true;
    subs.forEach((f) => f());
  }
}

export function useStaleBuild(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => stale, () => false);
}

let lastCheck = 0;
export async function checkBuildNow(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastCheck < 60_000) return;
  lastCheck = now;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const j = (await res.json()) as { build?: string };
    reportServerBuild(j.build ?? res.headers.get('x-build'));
  } catch {
    /* offline: nothing to learn */
  }
}

/** Look for a newer deploy when the app comes back to the foreground or the network returns, and every ten minutes while it stays open. */
export function watchBuild(): () => void {
  const onVisible = () => { if (!document.hidden) void checkBuildNow(); };
  const onOnline = () => void checkBuildNow(true);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => void checkBuildNow(true), 10 * 60_000);
  return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); window.clearInterval(timer); };
}
