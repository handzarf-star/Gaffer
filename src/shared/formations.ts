import type { Pos } from './players';
import { player } from './players';

export type Role = 'GK' | 'LB' | 'CB' | 'RB' | 'LWB' | 'RWB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST';
export type FormationId = '433' | '442' | '4231' | '352' | '343' | '532';

export interface Slot {
  id: string;
  role: Role;
  /** 0 = left touchline, 100 = right */
  x: number;
  /** 0 = opponent's goal (top of the pitch), 100 = own goal */
  y: number;
}

export interface Formation {
  id: FormationId;
  name: string;
  slots: Slot[];
}

const mk = (id: FormationId, name: string, rows: Array<[Role, number, number]>): Formation => ({
  id,
  name,
  slots: rows.map(([role, x, y], i) => ({ id: `s${i}`, role, x, y })),
});

export const FORMATIONS: Record<FormationId, Formation> = {
  '433': mk('433', '4-3-3', [
    ['GK', 50, 92], ['LB', 14, 72], ['CB', 37, 77], ['CB', 63, 77], ['RB', 86, 72],
    ['CM', 28, 50], ['CDM', 50, 58], ['CM', 72, 50], ['LW', 16, 22], ['ST', 50, 14], ['RW', 84, 22],
  ]),
  '442': mk('442', '4-4-2', [
    ['GK', 50, 92], ['LB', 14, 72], ['CB', 37, 77], ['CB', 63, 77], ['RB', 86, 72],
    ['LM', 12, 46], ['CM', 38, 52], ['CM', 62, 52], ['RM', 88, 46], ['ST', 37, 17], ['ST', 63, 17],
  ]),
  '4231': mk('4231', '4-2-3-1', [
    ['GK', 50, 92], ['LB', 14, 72], ['CB', 37, 77], ['CB', 63, 77], ['RB', 86, 72],
    ['CDM', 36, 58], ['CDM', 64, 58], ['LW', 17, 36], ['CAM', 50, 38], ['RW', 83, 36], ['ST', 50, 14],
  ]),
  '352': mk('352', '3-5-2', [
    ['GK', 50, 92], ['CB', 24, 76], ['CB', 50, 80], ['CB', 76, 76],
    ['LWB', 9, 50], ['CM', 31, 44], ['CDM', 50, 58], ['CM', 69, 44], ['RWB', 91, 50], ['ST', 37, 16], ['ST', 63, 16],
  ]),
  '343': mk('343', '3-4-3', [
    ['GK', 50, 92], ['CB', 24, 76], ['CB', 50, 80], ['CB', 76, 76],
    ['LM', 12, 50], ['CM', 38, 54], ['CM', 62, 54], ['RM', 88, 50], ['LW', 17, 22], ['ST', 50, 14], ['RW', 83, 22],
  ]),
  '532': mk('532', '5-3-2', [
    ['GK', 50, 92], ['LWB', 8, 62], ['CB', 28, 77], ['CB', 50, 81], ['CB', 72, 77], ['RWB', 92, 62],
    ['CM', 28, 46], ['CM', 50, 52], ['CM', 72, 46], ['ST', 38, 16], ['ST', 62, 16],
  ]),
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];
export const DEFAULT_FORMATION: FormationId = '433';

/* ───────────── position fit ───────────── */

/**
 * Which player position fills a slot role: the card the game DEALS for that role (a winger for a wide-midfield slot, a full-back for a
 * wing-back slot). There are no LM, RM, LWB or RWB players in the pool, so these roles can only ever be filled by those cards.
 */
export const ROLE_TO_POS: Record<Role, Pos> = {
  GK: 'GK', LB: 'LB', CB: 'CB', RB: 'RB', LWB: 'LB', RWB: 'RB', CDM: 'CDM', CM: 'CM', CAM: 'CAM',
  LM: 'LW', RM: 'RW', LW: 'LW', RW: 'RW', ST: 'ST',
};


// [lateral -1..1, depth 0 (defence) .. 1 (attack)]
const COORD: Record<Role, [number, number]> = {
  GK: [0, -0.2],
  CB: [0, 0.1],
  LB: [-1, 0.2],
  RB: [1, 0.2],
  LWB: [-1, 0.34],
  RWB: [1, 0.34],
  CDM: [0, 0.34],
  CM: [0, 0.5],
  LM: [-1, 0.52],
  RM: [1, 0.52],
  CAM: [0, 0.68],
  LW: [-1, 0.78],
  RW: [1, 0.78],
  ST: [0, 0.94],
};

const OVERRIDE: Array<[Role, Role, number]> = [
  ['LB', 'RB', 0.8],
  ['LWB', 'RWB', 0.8],
  ['LM', 'RM', 0.86],
  ['LW', 'RW', 0.86],
  ['LB', 'RWB', 0.76],
  ['RB', 'LWB', 0.76],
];

/**
 * 1 = natural. Lower = more out of position.
 * The card dealt for a role is natural for it. Before, the game dealt a winger for a wide-midfield slot and then took 6 rating points
 * off him, and took 3 off a full-back at wing-back: 4-4-2 and 3-4-3 started every match 12 points down, 3-5-2 and 5-3-2 six, and
 * 4-3-3 and 4-2-3-1 (whose roles have natural players) none. That, not the maths of the sim, was the whole formation gap
 * (docs/balance.md, 2.4).
 */
export function fit(pos: Pos, role: Role): number {
  if (pos === role || ROLE_TO_POS[role] === pos) return 1;
  if (pos === 'GK' || role === 'GK') return 0.12;
  for (const [a, b, v] of OVERRIDE) if ((pos === a && role === b) || (pos === b && role === a)) return v;
  const [lx, ld] = COORD[pos];
  const [rx, rd] = COORD[role];
  const dx = Math.abs(lx - rx) * 0.35;
  const dy = Math.abs(ld - rd);
  return Math.max(0.2, 1 - 0.8 * Math.sqrt(dx * dx + dy * dy));
}

/** Rating points lost for playing out of position. */
export function penalty(pos: Pos, role: Role): number {
  return Math.round((1 - fit(pos, role)) * 30);
}

export type FitKind = 'natural' | 'close' | 'stretch' | 'poor';

export function fitKind(pos: Pos, role: Role): FitKind {
  const f = fit(pos, role);
  if (f >= 0.999) return 'natural';
  if (f >= 0.82) return 'close';
  if (f >= 0.6) return 'stretch';
  return 'poor';
}

export function effectiveOvr(playerId: string, role: Role): number {
  const p = player(playerId);
  return p.ovr - penalty(p.pos, role);
}

/* ───────────── chemistry links ───────────── */

/** Each player is linked to his 3 nearest teammates on the pitch (union, so links are mutual). */
const LINK_NEIGHBOURS = 3;

export function slotLinks(formation: Formation): Array<[string, string]> {
  const s = formation.slots;
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (let i = 0; i < s.length; i++) {
    const a = s[i]!;
    const near = s
      .map((b, j) => ({ j, d: Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05) }))
      .filter((o) => o.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, LINK_NEIGHBOURS);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(i < j ? [a.id, s[j]!.id] : [s[j]!.id, a.id]);
    }
  }
  return out;
}

/* ───────────── optimal assignment (Hungarian) ───────────── */

/** Place exactly `ids.length` players into the formation's slots maximising total effective rating. */
export function assignBest(ids: string[], formation: Formation): Record<string, string> {
  const slots = formation.slots;
  const n = Math.max(ids.length, slots.length);
  // cost matrix (minimise): negative effective rating; pad with zeros
  const cost: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const id = ids[i];
      const slot = slots[j];
      row.push(id && slot ? -effectiveOvr(id, slot.role) : 0);
    }
    cost.push(row);
  }
  const INF = 1e9;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const result: Record<string, string> = {};
  for (let j = 1; j <= n; j++) {
    const i = p[j]!;
    const id = ids[i - 1];
    const slot = slots[j - 1];
    if (id && slot) result[slot.id] = id;
  }
  return result;
}
