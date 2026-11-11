import { FORMATIONS, assignBest, effectiveOvr, slotLinks, type FormationId, type Role } from './formations';
import { player } from './players';

export type StyleId = 'possession' | 'press' | 'wings' | 'fortress' | 'counter';

export interface Style {
  id: StyleId;
  name: string;
  blurb: string;
  /** Short, honest description of the trade-off. */
  tradeoff: string;
}

export const STYLES: Record<StyleId, Style> = {
  possession: { id: 'possession', name: 'Possession', blurb: 'Own the ball and the tempo.', tradeoff: '+3 midfield, -2 attack, -1.5 defence. Fewer, cleaner chances.' },
  press: { id: 'press', name: 'High Press', blurb: 'Suffocate them high up the pitch.', tradeoff: '+2 attack, +3 midfield, -5.5 defence. More cards, more chaos.' },
  wings: { id: 'wings', name: 'Wide Attack', blurb: 'Stretch them and get the ball out wide.', tradeoff: '+3 attack, -3.5 defence with two wide forwards (else +1 and -1).' },
  fortress: { id: 'fortress', name: 'Fortress', blurb: 'Low block. Frustrate them.', tradeoff: '+5 defence, +1 keeper, -3 attack, -2 midfield. Low-scoring games.' },
  counter: { id: 'counter', name: 'Counter', blurb: 'Absorb it, then hit them on the break.', tradeoff: '+3 attack, -3 midfield. Fewer cards.' },
};

/** What a style does to the squad's sectors (rating points) and to the pace of the game. */
export interface StyleMod { att: number; mid: number; def: number; gk: number; tempo: number; aggression: number }

/**
 * Every style is ZERO-SUM under the sector weights of `overall` (0.30 attack, 0.30 midfield, 0.25 defence, 0.15 keeper): choosing a
 * style moves strength between sectors, it never adds any. (Before, each style added 0.3 to 0.95 points of `overall` for free, and the
 * CPU, which picked the style with the highest `overall`, always chose Possession.) tests/squad.test.ts holds this to |change| <= 0.15,
 * and `npm run check:balance` holds the playing strength of all five to within 0.03 points a match of each other. Tempo and
 * aggression are not sectors, so they are tuned by that harness: aggression is a real cost (press 1.15: about -0.02 points a match from
 * the cards and free kicks it concedes; counter 0.9 is worth about +0.02), which the sector numbers above already allow for.
 */
export const STYLE_MOD: Record<StyleId, StyleMod> = {
  possession: { att: -2, mid: 3, def: -1.5, gk: 0, tempo: 0.9, aggression: 1 },
  press: { att: 2, mid: 3, def: -5.5, gk: 0, tempo: 1.1, aggression: 1.15 },
  wings: { att: 3, mid: 0, def: -3.5, gk: 0, tempo: 1.05, aggression: 1 },
  fortress: { att: -3, mid: -2, def: 5, gk: 1, tempo: 0.8, aggression: 1.05 },
  counter: { att: 3, mid: -3, def: 0, gk: 0, tempo: 0.95, aggression: 0.9 },
};
/** Wide Attack needs two wide forwards; with fewer the width is not there and the trade is smaller. */
const WINGS_NARROW: StyleMod = { ...STYLE_MOD.wings, att: 1, def: -1 };
export const styleMod = (style: StyleId, wide: number): StyleMod => (style === 'wings' && wide < 2 ? WINGS_NARROW : STYLE_MOD[style]);

/**
 * Rock, paper, scissors, from how the game is really played: a high press wins the ball back from a team that builds from the back;
 * a team on the ball takes a low block apart; a low block gives a counter-attack no space behind; and a counter-attack runs
 * straight past a high line. Wide Attack is the neutral style: it neither beats nor loses to anything.
 */
export const STYLE_BEATS: Record<StyleId, StyleId | null> = { press: 'possession', possession: 'fortress', fortress: 'counter', counter: 'press', wings: null };
/** +1 if style `a` beats style `b`, -1 if `b` beats `a`, otherwise 0. */
export const matchup = (a: StyleId, b: StyleId): -1 | 0 | 1 => (STYLE_BEATS[a] === b ? 1 : STYLE_BEATS[b] === a ? -1 : 0);
export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

export interface Squad {
  formation: FormationId;
  /** slot id -> player id */
  slots: Record<string, string | null>;
  style: StyleId;
}

export function emptySquad(formation: FormationId): Squad {
  const slots: Record<string, string | null> = {};
  for (const s of FORMATIONS[formation].slots) slots[s.id] = null;
  return { formation, slots, style: 'possession' };
}

export function squadPlayerIds(sq: Squad): string[] {
  return Object.values(sq.slots).filter((x): x is string => !!x);
}

export function isSquadComplete(sq: Squad): boolean {
  return FORMATIONS[sq.formation].slots.every((s) => !!sq.slots[s.id]);
}

/** Change formation and re-seat the same players in the best possible arrangement. */
export function changeFormation(sq: Squad, next: FormationId): Squad {
  const ids = squadPlayerIds(sq);
  const nf = FORMATIONS[next];
  const placed = assignBest(ids, nf);
  const slots: Record<string, string | null> = {};
  for (const s of nf.slots) slots[s.id] = placed[s.id] ?? null;
  return { formation: next, slots, style: sq.style };
}

export function autoArrange(sq: Squad): Squad {
  return changeFormation(sq, sq.formation);
}

export function swapSlots(sq: Squad, a: string, b: string): Squad {
  if (!(a in sq.slots) || !(b in sq.slots) || a === b) return sq;
  return { ...sq, slots: { ...sq.slots, [a]: sq.slots[b] ?? null, [b]: sq.slots[a] ?? null } };
}

/* ───────────── ratings ───────────── */

const SECTOR_W: Record<Role, [number, number, number]> = {
  GK: [0, 0, 0],
  CB: [0, 0.05, 0.95],
  LB: [0.05, 0.2, 0.75],
  RB: [0.05, 0.2, 0.75],
  LWB: [0.15, 0.3, 0.55],
  RWB: [0.15, 0.3, 0.55],
  CDM: [0, 0.6, 0.4],
  CM: [0.1, 0.8, 0.1],
  LM: [0.35, 0.6, 0.05],
  RM: [0.35, 0.6, 0.05],
  CAM: [0.5, 0.5, 0],
  LW: [0.8, 0.2, 0],
  RW: [0.8, 0.2, 0],
  ST: [1, 0, 0],
};

const WIDE: Role[] = ['LW', 'RW', 'LM', 'RM'];

export interface Chemistry {
  /** pairs of slot ids that are adjacent AND share a nation */
  links: Array<[string, string]>;
  perSlot: Record<string, number>;
  /** 0..100 for the UI meter */
  score: number;
}

export function chemistry(sq: Squad): Chemistry {
  const f = FORMATIONS[sq.formation];
  const adj = slotLinks(f);
  const links: Array<[string, string]> = [];
  const perSlot: Record<string, number> = {};
  for (const [a, b] of adj) {
    const pa = sq.slots[a];
    const pb = sq.slots[b];
    if (!pa || !pb) continue;
    if (player(pa).nat === player(pb).nat) {
      links.push([a, b]);
      perSlot[a] = (perSlot[a] ?? 0) + 1;
      perSlot[b] = (perSlot[b] ?? 0) + 1;
    }
  }
  // 8 same-nation links is already an extreme squad; scale so ~5 links feels like "good chemistry"
  const score = Math.min(100, Math.round((links.length / 7) * 100));
  return { links, perSlot, score };
}

export interface Profile {
  att: number;
  mid: number;
  def: number;
  gk: number;
  overall: number;
  chem: Chemistry;
  /** raw sector values before the style modifier, for the "+x" deltas in the UI */
  base: { att: number; mid: number; def: number; gk: number };
  tempo: number;
  aggression: number;
  /** squad average of the 11 effective ratings */
  avg: number;
}

/** How much each sector counts towards a squad's headline `overall`. Exported so the balance harness measures against the same numbers. */
export const OVERALL_W = { att: 0.3, mid: 0.3, def: 0.25, gk: 0.15 } as const;

const r1 = (n: number) => Math.round(n * 10) / 10;

export function profile(sq: Squad): Profile {
  const f = FORMATIONS[sq.formation];
  const chem = chemistry(sq);
  let attS = 0, attW = 0, midS = 0, midW = 0, defS = 0, defW = 0;
  let gk = 55;
  let total = 0;
  let count = 0;
  let wide = 0;
  for (const s of f.slots) {
    const id = sq.slots[s.id];
    if (!id) continue;
    const bonus = Math.min(2, chem.perSlot[s.id] ?? 0);
    const eff = effectiveOvr(id, s.role) + bonus;
    total += eff;
    count++;
    if (s.role === 'GK') {
      gk = eff;
      continue;
    }
    if (WIDE.includes(s.role)) wide++;
    const [wa, wm, wd] = SECTOR_W[s.role];
    attS += eff * wa; attW += wa;
    midS += eff * wm; midW += wm;
    defS += eff * wd; defW += wd;
  }
  const base = {
    att: attW ? attS / attW : 50,
    mid: midW ? midS / midW : 50,
    def: defW ? defS / defW : 50,
    gk,
  };
  const mod = styleMod(sq.style, wide);
  const att = base.att + mod.att;
  const mid = base.mid + mod.mid;
  const def = base.def + mod.def;
  const gkv = base.gk + mod.gk;
  const { tempo, aggression } = mod;
  const overall = OVERALL_W.att * att + OVERALL_W.mid * mid + OVERALL_W.def * def + OVERALL_W.gk * gkv;
  return {
    att: r1(att),
    mid: r1(mid),
    def: r1(def),
    gk: r1(gkv),
    overall: r1(overall),
    chem,
    base: { att: r1(base.att), mid: r1(base.mid), def: r1(base.def), gk: r1(base.gk) },
    tempo,
    aggression,
    avg: count ? r1(total / count) : 0,
  };
}
