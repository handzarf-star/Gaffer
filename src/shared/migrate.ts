// Versioned saved state.
//
// A Durable Object's storage outlives every deploy, so the shape of what we saved last month is a promise we keep.
// Every load goes through one pipeline:
//
//   raw JSON  ->  steps[v] ... steps[current-1]  (one small, named upgrade per version bump)  ->  normalise()
//
// * A step turns a version-n save into a version-(n+1) save. It may rely on nothing but its input.
// * normalise() runs on EVERY load, even when no step ran. It fills what is missing and repairs what has the wrong type, so
//   a field added later (an energy table, an estimated age) can never reach the engine as `undefined` or `NaN` on an old save.
//   It is total for ordinary damage and throws only for a save that cannot be played at all (that becomes `broken`).
// * Nothing here ever deletes anything. The caller decides what to do with a save it cannot read (see `Loaded`).

export type Step = (old: Record<string, unknown>) => Record<string, unknown>;

export interface Pipeline<T extends { v: number }> {
  /** the version this build writes */
  current: number;
  /** the oldest version a chain of steps exists for; anything older is `too_old` */
  oldest: number;
  /** steps[n] upgrades a version-n save to version n+1 */
  steps: Readonly<Record<number, Step>>;
  normalise(raw: Record<string, unknown>): T;
}

export type Loaded<T> =
  | { ok: true; state: T; from: number; changed: boolean }
  | { ok: false; reason: 'not_state' | 'too_old' | 'too_new' | 'broken'; from?: number; detail?: string };

export function loadState<T extends { v: number }>(p: Pipeline<T>, raw: unknown): Loaded<T> {
  if (!isRec(raw) || !Number.isInteger(raw.v)) return { ok: false, reason: 'not_state' };
  const from = raw.v as number;
  // a newer build wrote this (a deploy was rolled back): leave it alone, it is not ours to read or to touch
  if (from > p.current) return { ok: false, reason: 'too_new', from };
  if (from < p.oldest) return { ok: false, reason: 'too_old', from };
  try {
    let s = structuredClone(raw) as Record<string, unknown>;
    for (let v = from; v < p.current; v++) {
      const step = p.steps[v];
      if (!step) return { ok: false, reason: 'broken', from, detail: `no migration from v${v}` };
      s = step(s);
      s.v = v + 1;
    }
    const state = p.normalise(s);
    return { ok: true, state, from, changed: from !== p.current || canon(state) !== canon(raw) };
  } catch (e) {
    return { ok: false, reason: 'broken', from, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** JSON with sorted keys, so "did normalise() change anything" ignores the order keys happen to be written in */
function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (isRec(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
}

/* ───────────── small, forgiving readers used by every normalise() ───────────── */

export class Unplayable extends Error {}
/** a save that cannot be repaired: loadState turns it into `broken` */
export const unplayable = (what: string): never => { throw new Unplayable(what); };

export const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export const num = (x: unknown, dflt: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : dflt);
export const int = (x: unknown, dflt: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : dflt);
export const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
export const str = (x: unknown, dflt = ''): string => (typeof x === 'string' ? x : dflt);
export const bool = (x: unknown, dflt = false): boolean => (typeof x === 'boolean' ? x : dflt);
export const oneOf = <T extends string>(x: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(x as T) ? (x as T) : dflt);
export const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
export const rec = (x: unknown): Record<string, unknown> => (isRec(x) ? x : {});

/** a record whose values are finite numbers; anything else is dropped */
export function numMap(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(x))) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}
export function boolMap(x: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rec(x))) if (typeof v === 'boolean') out[k] = v;
  return out;
}
export function strMap(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(x))) if (typeof v === 'string') out[k] = v;
  return out;
}
/** an array of objects, each passed through `fix`; entries that come back null are dropped */
export function list<T>(x: unknown, fix: (o: Record<string, unknown>) => T | null): T[] {
  const out: T[] = [];
  if (Array.isArray(x)) for (const o of x) if (isRec(o)) { const f = fix(o); if (f !== null) out.push(f); }
  return out;
}
