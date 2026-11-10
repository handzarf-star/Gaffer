// Turns a simulated match into pictures. Pure and deterministic: given the match result, the playback schedule and a
// time, it returns where all 22 players, the ball and every highlight are. No randomness besides seeded hashes, so
// both friends see exactly the same movie, and it can be unit-tested without a browser.
//
// Coordinates are metres on a 68 x 105 pitch. Team 0 defends the bottom goal and attacks UP; team 1 attacks DOWN.

import { FORMATIONS, type Role } from '../../shared/formations';
import { player, shortName } from '../../shared/players';
import { hashSeed } from '../../shared/rng';
import { traits } from '../../shared/playerstats';
import { isHighlight, type EventType, type MatchEvent, type MatchResult, type ScheduledEvent } from '../../shared/sim';
import type { Squad } from '../../shared/squad';

export const PW = 68;
export const PH = 105;
const CX = PW / 2;

export type TagKind = 'chance' | 'goal' | 'save' | 'miss' | 'post' | 'yellow' | 'red' | 'freekick' | 'penalty' | 'corner' | 'info';

export interface DotS {
  key: string;
  id: string;
  team: 0 | 1;
  x: number;
  y: number;
  gk: boolean;
  label: string;
  hot: boolean;
  booked: boolean;
  carded: 'yellow' | 'red' | null;
  down: boolean;
  scale: number;
}

export type FlowLabel = 'attack' | 'danger' | 'chance';

/** The big arrow that shows quiet play: who is attacking whom, and how dangerous it is. One entry per team. */
export interface Flow {
  /** how visible each team's arrow is, 0 to 1 (they swap smoothly, so the two add up to about 1) */
  show: [number, number];
  /** how dangerous the attack is, 0 to 1 */
  level: [number, number];
  /** sideways position of the arrow, metres */
  lane: [number, number];
  label: [FlowLabel, FlowLabel];
}

export interface Scene {
  /** the picture of quiet play: an arrow, no players and no ball. Null while a highlight or a banner is showing. */
  flow: Flow | null;
  /** how visible the players and the ball are, 0 to 1: they appear only for highlights */
  live: number;
  dots: DotS[];
  ball: { x: number; y: number; lift: number; hot: boolean };
  trail: Array<{ x: number; y: number }>;
  tag: { kind: TagKind; text: string; sub: string; team: 0 | 1 } | null;
  shot: { x1: number; y1: number; x2: number; y2: number; p: number } | null;
  pulse: { x: number; y: number; p: number; team: 0 | 1 } | null;
  ref: { x: number; y: number } | null;
  /** 0 = top goal, 1 = bottom goal: which net is rippling, and how far through */
  ripple: { goal: 0 | 1; p: number } | null;
  fast: boolean;
  shootout: boolean;
}

/* ───────────── helpers ───────────── */

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a), 0, 1);
const rnd = (key: string) => hashSeed(key) / 4294967296;
const pt = (x: number, y: number) => ({ x, y });
type Pt = { x: number; y: number };
const lerpPt = (a: Pt, b: Pt, u: number): Pt => ({ x: mix(a.x, b.x, u), y: mix(a.y, b.y, u) });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** how strongly each role's shape follows the ball up and down the pitch */
const FOLLOW: Record<Role, number> = {
  GK: 0.06, CB: 0.2, LB: 0.24, RB: 0.24, LWB: 0.28, RWB: 0.28, CDM: 0.27, CM: 0.31, LM: 0.32, RM: 0.32, CAM: 0.34, LW: 0.35, RW: 0.35, ST: 0.36,
};

export interface P {
  key: string;
  id: string;
  team: 0 | 1;
  role: Role;
  bx: number;
  by: number;
  gk: boolean;
  short: string;
  k: number;
}

export interface Layout {
  players: P[];
  byKey: Map<string, P>;
  teams: [P[], P[]];
  /** makes ambient play differ from match to match */
  salt: string;
}

export const dotKey = (team: 0 | 1, id: string) => `${team}:${id}`;

export function makeLayout(squads: [Squad, Squad], salt = ''): Layout {
  const players: P[] = [];
  const teams: [P[], P[]] = [[], []];
  ([0, 1] as const).forEach((team) => {
    const sq = squads[team];
    for (const s of FORMATIONS[sq.formation].slots) {
      const id = sq.slots[s.id];
      if (!id) continue;
      // formation y: 14 (striker) .. 92 (keeper); spread over the team's own two thirds of the pitch
      const yPct = 28 + (s.y - 14) * 0.846;
      let bx = (s.x / 100) * PW;
      let by = (yPct / 100) * PH;
      if (team === 1) {
        bx = PW - bx;
        by = PH - by;
      }
      const p: P = { key: dotKey(team, id), id, team, role: s.role, bx, by, gk: s.role === 'GK', short: shortName(player(id).name), k: FOLLOW[s.role] };
      players.push(p);
      teams[team].push(p);
    }
  });
  return { players, byKey: new Map(players.map((p) => [p.key, p])), teams, salt };
}

/** goal line the team attacks, and the direction that points back onto the pitch from it */
const goalY = (att: 0 | 1) => (att === 0 ? 0 : PH);
const into = (att: 0 | 1) => (att === 0 ? 1 : -1);
const other = (t: 0 | 1): 0 | 1 => (t === 0 ? 1 : 0);

/** shape: everyone drifts toward the ball; w = how hard each team is pushing up (0 to 1, fades after a turnover) */
function shapedW(p: P, ball: Pt, w: [number, number]): Pt {
  const push = !p.gk ? 2.6 * w[p.team] * (p.team === 0 ? -1 : 1) : 0;
  return {
    x: clamp(p.bx + (ball.x - CX) * 0.11 * (p.gk ? 0.4 : 1), 1.5, PW - 1.5),
    y: clamp(p.by + (ball.y - PH / 2) * p.k + push, p.gk ? (p.team === 0 ? PH - 6 : 1.5) : 2, p.gk ? (p.team === 0 ? PH - 1.5 : 6) : PH - 2),
  };
}
const PUSH_OF: Record<string, [number, number]> = { '0': [1, 0], '1': [0, 1], n: [0, 0] };
function shaped(p: P, ball: Pt, poss: 0 | 1 | null): Pt {
  return shapedW(p, ball, PUSH_OF[poss === null ? 'n' : String(poss)]!);
}

/* ───────────── ambient play (nothing is happening) ───────────── */
// The ball always sits on a real player or travels between two of them at passing pace, and possession changes through
// short turnovers. The whole chain is generated from seeded hashes the first time it is needed and then only looked up,
// so it is identical for both friends and cheap to evaluate every frame. Nothing here depends on the playback speed:
// when a quiet stretch is fast-forwarded only the match clock speeds up, never the dots.

interface Hop { t0: number; hold: number; fly: number; from: string; to: string; team: 0 | 1 }
const PASS_SPEED = 13; // metres per second
const chains = new WeakMap<Layout, { poss0: number; hops: Hop[] }>();

function nextHop(layout: Layout, prev: Hop | null, n: number, poss0: number): Hop {
  const salt = `${layout.salt}hop${n}`;
  let holder: P;
  if (!prev) {
    const team: 0 | 1 = rnd(`${salt}t`) < poss0 ? 0 : 1;
    holder = layout.teams[team].filter((q) => !q.gk).sort((x, y) => Math.abs(x.by - PH / 2) - Math.abs(y.by - PH / 2))[0] ?? layout.teams[team][0]!;
  } else holder = layout.byKey.get(prev.to)!;
  const here = pt(holder.bx, holder.by);
  const share = holder.team === 0 ? poss0 : 1 - poss0;
  const pTurn = holder.gk ? 0 : clamp(0.2 * (0.5 / Math.max(0.25, share)), 0.08, 0.38);
  let to: P | undefined;
  if (rnd(`${salt}x`) < pTurn) {
    const near = nearest(layout.teams[other(holder.team)], here, 2, new Set());
    to = near[rnd(`${salt}o`) < 0.65 ? 0 : 1] ?? near[0];
  } else {
    const mates = layout.teams[holder.team].filter((q) => q.key !== holder.key && (holder.gk ? q.role === 'CB' || q.role === 'LB' || q.role === 'RB' : !q.gk || rnd(`${salt}gk`) < 0.04));
    let bestScore = -1e9;
    for (const q of mates) {
      const d = Math.hypot(q.bx - here.x, q.by - here.y);
      const fwd = holder.team === 0 ? here.y - q.by : q.by - here.y;
      const score = -Math.abs(d - 12) * 0.35 + fwd * 0.1 + rnd(`${salt}s${q.key}`) * 1.8;
      if (score > bestScore) { bestScore = score; to = q; }
    }
  }
  const dest = to ?? holder;
  const d = Math.hypot(dest.bx - here.x, dest.by - here.y);
  return {
    t0: prev ? prev.t0 + prev.hold + prev.fly : 0,
    hold: holder.gk ? 1100 : 380 + rnd(`${salt}h`) * 720,
    fly: clamp(d / PASS_SPEED, 0.5, 1.9) * 1000,
    from: holder.key, to: dest.key, team: holder.team,
  };
}

function hopsFor(layout: Layout, poss0: number, t: number): Hop[] {
  let c = chains.get(layout);
  if (!c || c.poss0 !== poss0) { c = { poss0, hops: [] }; chains.set(layout, c); }
  const hops = c.hops;
  for (let guard = 0; guard < 4000; guard++) {
    const last = hops[hops.length - 1];
    if (last && last.t0 + last.hold + last.fly >= t + 3000) break;
    hops.push(nextHop(layout, last ?? null, hops.length, poss0));
  }
  return hops;
}

function hopIndex(hops: Hop[], t: number): number {
  let lo = 0, hi = hops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (hops[mid]!.t0 <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** half-time and full-time are just a banner on an empty pitch */
const BANNER = new Set<EventType>(['half', 'full', 'et', 'etend']);
/** moments a team builds up to, so the arrow can warn about them */
const BUILDS_UP = new Set<EventType>(['goal', 'save', 'miss', 'post', 'freekick', 'penalty', 'corner']);
const FADE_IN = 700;
const FADE_OUT = 600;
const LEAD_MS = 3200;

/** how big the chance is, as the arrow shows it: from the engine's own chance quality, so it never overstates */
function chanceLevel(e: MatchEvent): number {
  if (e.src === 'penalty' || e.type === 'penalty') return 1;
  if (e.type === 'freekick' || e.type === 'corner') return 0.5;
  const p = e.xg ?? 0.08; // the chance of scoring, as the engine rolled it
  if (p < 0.08) return 0.2 + (p / 0.08) * 0.13; // a speculative effort
  if (p < 0.25) return 0.36 + ((p - 0.08) / 0.17) * 0.24; // a good chance
  return 0.66 + Math.min(1, (p - 0.25) / 0.4) * 0.32; // a clear-cut chance
}
const labelOf = (level: number): FlowLabel => (level < 0.34 ? 'attack' : level < 0.62 ? 'danger' : 'chance');

/** an attack that is about to become a highlight: for the last few seconds the team pushes up and the arrow warns */
interface Lead { team: 0 | 1; w: number; level: number; focus: Pt }
function leadFor(items: ScheduledEvent[], t: number): Lead | null {
  for (const it of items) {
    if (it.at < t - 1) continue;
    if (it.at - t > LEAD_MS) return null;
    const e = it.event;
    if (!BUILDS_UP.has(e.type)) continue;
    const set = e.type === 'freekick' || e.type === 'penalty' || e.type === 'corner' || (!!e.src && e.src !== 'play');
    return { team: e.team, w: ease(1 - (it.at - t) / LEAD_MS), level: chanceLevel(e), focus: pt(CX, goalY(e.team) + into(e.team) * (set ? 20 : 25)) };
  }
  return null;
}

interface Ambient { ball: Pt; /** the ball on the formation grid, before the team leans toward it */ base: Pt; rough: Pt; poss: 0 | 1; w: [number, number]; positions: Map<string, Pt>; lift: number }

function ambient(layout: Layout, tt: number, poss0: number, redded: Set<string>, lead: Lead | null = null): Ambient {
  const t = Math.max(0, tt);
  const hops = hopsFor(layout, poss0, t);
  const idx = hopIndex(hops, t);
  const h = hops[idx]!;
  const local = t - h.t0;
  const holding = local < h.hold;
  const u = holding ? 0 : clamp((local - h.hold) / h.fly, 0, 1);
  const A = layout.byKey.get(h.from)!;
  const B = layout.byKey.get(h.to)!;
  // the ball on the formation grid drives where the whole team leans
  const flight = holding ? pt(A.bx, A.by) : lerpPt(pt(A.bx, A.by), pt(B.bx, B.by), ease(u));
  let rough = pt(
    CX + (flight.x - CX) * 0.5 + 2.5 * Math.sin(t / 2300),
    PH / 2 + (flight.y - PH / 2) * 0.55 + (0.5 - poss0) * 14 + 2 * Math.sin(t / 3100 + 1),
  );
  // a chance is coming: the whole team leans toward where it will happen, so nobody has far to run when the camera cuts in
  if (lead) rough = lerpPt(rough, lead.focus, lead.w * 0.9);
  // the side with the ball pushes up; after a turnover the push fades over from one side to the other
  let j = idx;
  while (j > 0 && hops[j - 1]!.team === hops[j]!.team) j--;
  const wCur = j === 0 ? 1 : ease((t - hops[j]!.t0) / 1400);
  const w: [number, number] = [0, 0];
  w[h.team] = wCur;
  w[other(h.team)] = 1 - wCur;
  if (lead) {
    const lw = Math.min(1, lead.w * 1.35);
    w[lead.team] = Math.max(w[lead.team], lw);
    w[other(lead.team)] = Math.min(w[other(lead.team)], 1 - lw);
  }
  const positions = new Map<string, Pt>();
  for (const q of layout.players) if (!redded.has(q.key)) positions.set(q.key, shapedW(q, rough, w));
  const pa = positions.get(h.from);
  const pb = positions.get(h.to);
  const on = holding ? (pa ?? flight) : pa && pb ? lerpPt(pa, pb, ease(u)) : flight;
  const arc = holding ? 0 : Math.sin(Math.PI * u);
  return { ball: pt(on.x, on.y - arc * 0.9), base: flight, rough, poss: h.team, w, positions, lift: arc * 0.25 };
}

/* ───────────── event choreography ───────────── */

interface Choreo {
  ball: Pt;
  lift?: number;
  hot?: Set<string>;
  tag?: Scene['tag'];
  shot?: Scene['shot'];
  pulse?: Scene['pulse'];
  ref?: Pt | null;
  ripple?: Scene['ripple'];
  over?: Map<string, Pt>;
  down?: Set<string>;
  scale?: Map<string, number>;
  card?: { key: string; color: 'yellow' | 'red' } | null;
  poss?: 0 | 1 | null;
  ballRough?: Pt;
}

const TAG_TEXT: Record<string, string> = {
  goal: 'GOAL!', save: 'SAVED', miss: 'OFF TARGET', post: 'OFF THE POST', yellow: 'YELLOW CARD', red: 'RED CARD',
  freekick: 'FREE KICK', penalty: 'PENALTY', corner: 'CORNER', chance: 'CHANCE',
};

function nearest(list: P[], at: Pt, n: number, skip: Set<string>): P[] {
  return list
    .filter((p) => !skip.has(p.key) && !p.gk)
    .map((p) => ({ p, d: Math.hypot(p.bx - at.x, p.by - at.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.p);
}

function keeperOf(layout: Layout, team: 0 | 1, redded: Set<string>): P | undefined {
  return layout.teams[team].find((p) => p.gk && !redded.has(p.key));
}

/** where a shot ends up and where the keeper goes */
function shotEnd(e: MatchEvent, att: 0 | 1, k: string): { end: Pt; keeper: Pt; after: Pt | null } {
  const gy = goalY(att);
  const dir = into(att);
  const side = rnd(`${k}:side`) < 0.5 ? -1 : 1;
  const half = 3.66; // half the width of a goal
  if (e.type === 'goal') {
    const gx = CX + side * (1.6 + rnd(`${k}:gx`) * 1.6);
    const keeperSide = rnd(`${k}:ks`) < 0.75 ? -side : side; // usually wrong-footed
    return { end: pt(gx, gy - dir * 1.4), keeper: pt(CX + keeperSide * 2.6, gy + dir * 0.8), after: null };
  }
  if (e.type === 'save') {
    const gx = CX + side * (1.2 + rnd(`${k}:gx`) * 1.8);
    return { end: pt(gx, gy + dir * 1.2), keeper: pt(gx, gy + dir * 0.9), after: pt(gx + side * (6 + rnd(`${k}:rb`) * 6), gy + dir * (8 + rnd(`${k}:rb2`) * 5)) };
  }
  if (e.type === 'post') {
    const px = CX + side * half;
    return { end: pt(px, gy), keeper: pt(CX + side * 1.8, gy + dir * 0.8), after: pt(px - side * 2.4, gy + dir * 6) };
  }
  // miss: wide or over
  const wide = CX + side * (half + 1.8 + rnd(`${k}:w`) * 5);
  return { end: pt(wide, gy - dir * 3.5), keeper: pt(CX + side * 1.4, gy + dir * 0.8), after: null };
}

function playChoreo(layout: Layout, e: MatchEvent, p: number, redded: Set<string>, rough: Pt, startBall: Pt): Choreo {
  const att = e.team;
  const def = other(att);
  const k = `${e.t}:${e.p}:${e.type}`;
  const gy = goalY(att);
  const dir = into(att);
  const shooter = layout.byKey.get(dotKey(att, e.p!));
  const kind = e.type === 'goal' || e.type === 'save' || e.type === 'miss' || e.type === 'post' ? e.type : 'miss';
  if (!shooter) return { ball: rough };
  const spot = pt(clamp(CX + (rnd(`${k}:sx`) * 2 - 1) * 11, 22, PW - 22), gy + dir * (13 + rnd(`${k}:sy`) * 6));
  const assist = e.a ? layout.byKey.get(dotKey(att, e.a)) : undefined;
  const creator = assist ?? layout.teams[att].filter((q) => !q.gk && !redded.has(q.key) && q.id !== shooter.id && q.role !== 'ST')[Math.floor(rnd(`${k}:cr`) * 5) % 5];
  const sShape = shaped(shooter, rough, att);
  const cShape = creator ? shaped(creator, rough, att) : pt(CX, PH / 2);
  const w1 = pt(mix(cShape.x, spot.x, 0.3), mix(cShape.y, spot.y, 0.35));
  const { end, keeper, after } = shotEnd(e, att, k);
  const gk = keeperOf(layout, def, redded);
  const over = new Map<string, Pt>();
  const hot = new Set<string>();

  // ball path: pick up from where play was, pass, pass, settle, shoot, outcome
  const w0 = lerpPt(startBall, cShape, 0.0);
  let ball: Pt;
  let lift = 0;
  if (p < 0.2) ball = lerpPt(w0, cShape, ease(p / 0.2));
  else if (p < 0.42) { ball = lerpPt(cShape, spot, ease(seg(p, 0.2, 0.42))); lift = Math.sin(Math.PI * seg(p, 0.2, 0.42)) * 0.4; }
  else if (p < 0.6) ball = pt(spot.x + Math.sin(seg(p, 0.42, 0.6) * Math.PI * 2) * 0.35, spot.y);
  else if (p < 0.8) ball = lerpPt(spot, end, ease(seg(p, 0.6, 0.8)));
  else if (after) ball = lerpPt(end, after, ease(seg(p, 0.8, 1)));
  else ball = end;

  // runners
  const run = ease(seg(p, 0.12, 0.55));
  over.set(shooter.key, lerpPt(sShape, spot, run));
  if (creator) over.set(creator.key, lerpPt(cShape, pt(mix(cShape.x, spot.x, 0.35), mix(cShape.y, spot.y, 0.3)), ease(seg(p, 0.05, 0.4))));
  const support = layout.teams[att].filter((q) => !q.gk && q.key !== shooter.key && q.key !== creator?.key && !redded.has(q.key) && (q.role === 'LW' || q.role === 'RW' || q.role === 'ST' || q.role === 'CAM')).slice(0, 2);
  support.forEach((q, i) => over.set(q.key, lerpPt(shaped(q, rough, att), pt(CX + (i ? 1 : -1) * 11, gy + dir * 10), ease(seg(p, 0.15, 0.6)))));
  // defenders squeeze toward the shooter, the keeper commits
  for (const d of nearest(layout.teams[def], spot, 3, redded)) over.set(d.key, lerpPt(shaped(d, rough, att), pt(mix(d.bx, spot.x, 0.6), mix(d.by, spot.y, 0.6)), ease(seg(p, 0.25, 0.65))));
  if (gk) over.set(gk.key, lerpPt(shaped(gk, rough, att), keeper, ease(seg(p, 0.6, 0.82))));
  if (e.type === 'goal') {
    for (const q of nearest(layout.teams[att], end, 3, redded)) if (q.key !== shooter.key) over.set(q.key, lerpPt(over.get(q.key) ?? shaped(q, rough, att), pt(spot.x + (q.bx > spot.x ? 3 : -3), spot.y - dir * 3), ease(seg(p, 0.85, 1))));
  }

  if (p > 0.1) hot.add(shooter.key);
  if (assist && p < 0.45) hot.add(assist.key);
  if (p > 0.6 && gk) hot.add(gk.key);
  const outcome = p >= 0.62;
  const kindTag: TagKind = outcome ? kind : 'chance';
  const scale = new Map<string, number>();
  if (e.type === 'goal' && p > 0.82) scale.set(shooter.key, 1 + 0.45 * Math.sin(seg(p, 0.82, 1) * Math.PI));
  return {
    ball, lift,
    hot,
    tag: p > 0.16 ? { kind: kindTag, text: TAG_TEXT[kindTag]!, sub: shooter.short, team: att } : null,
    shot: p >= 0.58 && p < 0.86 ? { x1: spot.x, y1: spot.y, x2: end.x, y2: end.y, p: seg(p, 0.6, 0.8) } : null,
    pulse: p > 0.16 && p < 0.7 ? { x: spot.x, y: spot.y, p: (p * 5) % 1, team: att } : null,
    ripple: e.type === 'goal' && p > 0.78 ? { goal: att === 0 ? 0 : 1, p: seg(p, 0.78, 1) } : null,
    over, scale,
    poss: att,
    ballRough: rough,
  };
}

interface SetPiece { spot: Pt; wall: P[]; wallPts: Pt[]; box: Map<string, Pt>; taker: P | undefined; takerStart: Pt }

/** deterministic setup for a free kick / penalty / corner, identical in the award event and in the shot that follows */
function setPiece(layout: Layout, e: MatchEvent, redded: Set<string>): SetPiece {
  const att = e.team;
  const def = other(att);
  const gy = goalY(att);
  const dir = into(att);
  // a corner is taken by a set-piece specialist, not by the player who heads it
  const taker = e.src === 'corner'
    ? layout.teams[att].filter((q) => !q.gk && q.id !== e.p && !redded.has(q.key)).sort((a, b) => traits(b.id).fk - traits(a.id).fk)[0]
    : layout.byKey.get(dotKey(att, e.p!));
  const k = `${e.t}:${e.p}:sp`;
  let spot: Pt;
  if (e.src === 'penalty') spot = pt(CX, gy + dir * 11);
  else if (e.src === 'corner') spot = pt(rnd(`${k}:cs`) < 0.5 ? 0.8 : PW - 0.8, gy + dir * 0.8);
  else spot = pt(clamp(CX + (rnd(`${k}:fx`) * 2 - 1) * 14, 18, PW - 18), gy + dir * (22 + rnd(`${k}:fy`) * 6));
  const box = new Map<string, Pt>();
  const wall: P[] = [];
  const wallPts: Pt[] = [];
  const attackers = layout.teams[att].filter((q) => !q.gk && q.key !== taker?.key && !redded.has(q.key));
  const defenders = layout.teams[def].filter((q) => !redded.has(q.key));
  const defOutfield = defenders.filter((q) => !q.gk);
  if (e.src === 'freekick') {
    const goalC = pt(CX, gy);
    const ux = (goalC.x - spot.x) / Math.max(1, dist(goalC, spot));
    const uy = (goalC.y - spot.y) / Math.max(1, dist(goalC, spot));
    const c = pt(spot.x + ux * 9.15, spot.y + uy * 9.15);
    const near = defOutfield.slice().sort((a, b) => Math.hypot(a.bx - c.x, a.by - c.y) - Math.hypot(b.bx - c.x, b.by - c.y)).slice(0, 4);
    near.forEach((q, i) => {
      const off = (i - 1.5) * 1.55;
      const w = pt(c.x - uy * off, c.y + ux * off);
      wall.push(q);
      wallPts.push(w);
      box.set(q.key, w);
    });
    const inBox = attackers.filter((q) => q.role === 'ST' || q.role === 'CB' || q.role === 'CAM' || q.role === 'LW' || q.role === 'RW').slice(0, 3);
    inBox.forEach((q, i) => box.set(q.key, pt(CX + (i - 1) * 9, gy + dir * 9)));
    defOutfield.filter((q) => !wall.includes(q)).slice(0, 3).forEach((q, i) => box.set(q.key, pt(CX + (i - 1) * 8, gy + dir * 7)));
  } else if (e.src === 'penalty') {
    const ring = [...attackers, ...defOutfield];
    ring.forEach((q, i) => box.set(q.key, pt(CX + ((i % 9) - 4) * 5.2, gy + dir * (22 + (i > 8 ? 2 : 0)))));
  } else if (e.src === 'corner') {
    attackers.filter((q) => q.role === 'ST' || q.role === 'CB' || q.role === 'CAM' || q.role === 'CM' || q.role === 'LW' || q.role === 'RW').slice(0, 5).forEach((q, i) => box.set(q.key, pt(CX + (i - 2) * 5.5, gy + dir * (8 + (i % 2) * 4))));
    defOutfield.slice(0, 6).forEach((q, i) => box.set(q.key, pt(CX + (i - 2.5) * 4.6, gy + dir * (6 + (i % 2) * 3))));
  }
  const takerStart = e.src === 'corner' ? pt(spot.x + (spot.x < CX ? 2 : -2), spot.y + dir * 2.5) : pt(spot.x, spot.y - dir * 3.2);
  return { spot, wall, wallPts, box, taker, takerStart };
}

function awardChoreo(layout: Layout, e: MatchEvent, p: number, redded: Set<string>, rough: Pt, startBall: Pt): Choreo {
  const sp = setPiece(layout, e, redded);
  const att = e.team;
  const def = other(att);
  const over = new Map<string, Pt>();
  const settle = ease(seg(p, 0.05, 0.7));
  for (const [key, target] of sp.box) {
    const q = layout.byKey.get(key);
    if (q) over.set(key, lerpPt(shaped(q, rough, att), target, settle));
  }
  if (sp.taker) over.set(sp.taker.key, lerpPt(shaped(sp.taker, rough, att), sp.takerStart, settle));
  const gk = keeperOf(layout, def, redded);
  const gy = goalY(att);
  const dir = into(att);
  if (gk) over.set(gk.key, lerpPt(shaped(gk, rough, att), pt(CX + (e.src === 'penalty' ? 0 : 1.5), gy + dir * 1.2), settle));
  const ball = lerpPt(startBall, sp.spot, ease(seg(p, 0, 0.45)));
  const hot = new Set<string>();
  if (sp.taker) hot.add(sp.taker.key);
  const victim = e.v ? layout.byKey.get(dotKey(att, e.v)) : undefined;
  const kind: TagKind = e.type === 'penalty' ? 'penalty' : e.type === 'freekick' ? 'freekick' : 'corner';
  return {
    ball, hot,
    tag: p > 0.05 ? { kind, text: TAG_TEXT[kind]!, sub: sp.taker?.short ?? '', team: att } : null,
    over, down: victim ? new Set([victim.key]) : undefined,
    poss: att, ballRough: rough,
  };
}

function setPieceShotChoreo(layout: Layout, e: MatchEvent, p: number, redded: Set<string>, rough: Pt): Choreo {
  const sp = setPiece(layout, e, redded);
  const att = e.team;
  const def = other(att);
  const gy = goalY(att);
  const dir = into(att);
  const k = `${e.t}:${e.p}:${e.type}:sp`;
  const { end, keeper, after } = shotEnd(e, att, k);
  const over = new Map<string, Pt>();
  for (const [key, target] of sp.box) over.set(key, target);
  const gk = keeperOf(layout, def, redded);
  let ball: Pt;
  let lift = 0;
  const hot = new Set<string>();
  if (sp.taker) hot.add(sp.taker.key);

  if (e.src === 'corner') {
    const head = pt(CX + (rnd(`${k}:h`) * 2 - 1) * 6, gy + dir * (8 + rnd(`${k}:hy`) * 3));
    if (p < 0.4) { ball = lerpPt(sp.spot, head, ease(seg(p, 0.05, 0.4))); lift = Math.sin(Math.PI * seg(p, 0.05, 0.4)) * 0.7; }
    else if (p < 0.78) ball = lerpPt(head, end, ease(seg(p, 0.45, 0.78)));
    else ball = after ? lerpPt(end, after, ease(seg(p, 0.78, 1))) : end;
    const header = layout.byKey.get(dotKey(att, e.p!));
    if (header) { over.set(header.key, head); hot.add(header.key); }
    if (sp.taker) over.set(sp.taker.key, sp.takerStart);
  } else {
    // free kick or penalty: run-up, strike, outcome
    const run = ease(seg(p, 0.0, 0.34));
    if (sp.taker) over.set(sp.taker.key, lerpPt(sp.takerStart, pt(sp.spot.x, sp.spot.y - dir * 0.8), run));
    const strike = e.src === 'penalty' ? 0.4 : 0.38;
    if (p < strike) ball = sp.spot;
    else if (p < 0.8) {
      const u = ease(seg(p, strike, 0.8));
      ball = lerpPt(sp.spot, end, u);
      lift = e.src === 'freekick' ? Math.sin(Math.PI * u) * 1.2 : 0.1;
    } else ball = after ? lerpPt(end, after, ease(seg(p, 0.8, 1))) : end;
  }
  if (gk) over.set(gk.key, lerpPt(pt(CX, gy + dir * 1.2), keeper, ease(seg(p, 0.5, 0.82))));
  if (gk && p > 0.5) hot.add(gk.key);
  const outcome = p >= 0.55;
  const kindTag: TagKind = outcome ? (e.type as TagKind) : e.src === 'penalty' ? 'penalty' : e.src === 'freekick' ? 'freekick' : 'corner';
  const sub = sp.taker?.short ?? layout.byKey.get(dotKey(att, e.p!))?.short ?? '';
  return {
    ball, lift, hot, over,
    tag: { kind: kindTag, text: TAG_TEXT[kindTag] ?? '', sub, team: att },
    shot: p >= 0.36 && p < 0.84 ? { x1: sp.spot.x, y1: sp.spot.y, x2: end.x, y2: end.y, p: seg(p, 0.4, 0.8) } : null,
    ripple: e.type === 'goal' && p > 0.78 ? { goal: att === 0 ? 0 : 1, p: seg(p, 0.78, 1) } : null,
    scale: e.type === 'goal' && p > 0.82 && sp.taker ? new Map([[sp.taker.key, 1 + 0.4 * Math.sin(seg(p, 0.82, 1) * Math.PI)]]) : undefined,
    poss: att, ballRough: rough,
  };
}

function cardChoreo(layout: Layout, e: MatchEvent, p: number, redded: Set<string>, rough: Pt, startBall: Pt): Choreo {
  const q = layout.byKey.get(dotKey(e.team, e.p!));
  if (!q) return { ball: rough };
  const at = shaped(q, rough, other(e.team));
  const victim = e.v ? layout.byKey.get(dotKey(other(e.team), e.v)) : undefined;
  const over = new Map<string, Pt>();
  const down = new Set<string>();
  if (victim) {
    over.set(victim.key, pt(at.x + 1.8, at.y - 1.4));
    down.add(victim.key);
  }
  const color = e.type === 'red' ? 'red' : 'yellow';
  const hot = new Set([q.key]);
  const refPos = lerpPt(pt(CX, PH / 2), pt(at.x + 2.8, at.y + 2.2), ease(seg(p, 0.0, 0.4)));
  return {
    ball: lerpPt(startBall, pt(at.x + 0.9, at.y - 0.6), ease(seg(p, 0, 0.3))),
    hot, over, down,
    tag: p > 0.1 ? { kind: color, text: TAG_TEXT[color]!, sub: q.short, team: e.team } : null,
    ref: refPos,
    card: p > 0.38 ? { key: q.key, color } : null,
    poss: other(e.team), ballRough: rough,
  };
}

/** the shoot-out: everyone else on the centre circle, one kick at a time at the top goal */
function shootoutLayout(layout: Layout, redded: Set<string>): Map<string, Pt> {
  const m = new Map<string, Pt>();
  ([0, 1] as const).forEach((team) => {
    const list = layout.teams[team].filter((q) => !redded.has(q.key));
    list.forEach((q, i) => m.set(q.key, pt(team === 0 ? 22 + Math.floor(i / 5) * 3 : PW - 22 - Math.floor(i / 5) * 3, 46 + (i % 5) * 3.6)));
  });
  return m;
}

function shootoutChoreo(layout: Layout, e: MatchEvent, p: number, redded: Set<string>): Choreo {
  const lineup = shootoutLayout(layout, redded);
  const spot = pt(CX, 11);
  const taker = layout.byKey.get(dotKey(e.team, e.p!));
  const kGk = layout.teams[other(e.team)].find((q) => q.gk);
  const k = `${e.t}:${e.p}:so`;
  const scored = e.type === 'pen_goal';
  const side = rnd(`${k}:s`) < 0.5 ? -1 : 1;
  const end = scored ? pt(CX + side * 2.4, -1.2) : rnd(`${k}:m`) < 0.5 ? pt(CX + side * 2.3, 0.8) : pt(CX + side * 6.4, -2.6);
  const saved = !scored && end.y > 0;
  const keeper = scored ? pt(CX - side * 2.5, 0.8) : saved ? pt(end.x, 0.9) : pt(CX + side * 1.5, 0.8);
  const over = new Map(lineup);
  if (taker) over.set(taker.key, lerpPt(pt(CX, 19), pt(spot.x, spot.y + 0.9), ease(seg(p, 0, 0.34))));
  if (kGk) over.set(kGk.key, lerpPt(pt(CX, 0.8), keeper, ease(seg(p, 0.42, 0.7))));
  let ball: Pt = spot;
  let lift = 0;
  if (p >= 0.4 && p < 0.7) ball = lerpPt(spot, end, ease(seg(p, 0.4, 0.7)));
  else if (p >= 0.7) ball = saved ? lerpPt(end, pt(end.x + side * 5, 7), ease(seg(p, 0.7, 1))) : end;
  const hot = new Set<string>();
  if (taker) hot.add(taker.key);
  if (kGk && p > 0.4) hot.add(kGk.key);
  return {
    ball, lift, hot, over,
    tag: { kind: scored ? 'goal' : saved ? 'save' : 'miss', text: scored ? 'SCORES' : saved ? 'SAVED' : 'MISSED', sub: taker?.short ?? '', team: e.team },
    shot: p >= 0.38 && p < 0.72 ? { x1: spot.x, y1: spot.y, x2: end.x, y2: end.y, p: seg(p, 0.4, 0.7) } : null,
    ripple: scored && p > 0.68 ? { goal: 0, p: seg(p, 0.68, 1) } : null,
    scale: scored && taker && p > 0.74 ? new Map([[taker.key, 1 + 0.4 * Math.sin(seg(p, 0.74, 1) * Math.PI)]]) : undefined,
    ballRough: pt(CX, 30),
  };
}

/* ───────────── the scene ───────────── */

export interface SceneArgs {
  layout: Layout;
  result: MatchResult;
  items: ScheduledEvent[];
  quiet: Array<[number, number]>;
  /** ms since kick-off */
  t: number;
}

const DEAD_MARK: Partial<Record<MatchEvent['type'], string>> = { kickoff: 'KICK-OFF', half: 'HALF-TIME', full: 'FULL-TIME', et: 'EXTRA TIME', etend: 'END OF EXTRA TIME', shootout: 'PENALTIES' };

/** What the picture WANTS at time t: the ambient flow of play, or the active moment's choreography. Not yet speed-limited. */
function desiredScene({ layout, result, items, quiet, t }: SceneArgs): Scene {
  // what has already happened (cards, sendings off) and what is happening right now
  const redded = new Set<string>();
  const booked = new Set<string>();
  let active: ScheduledEvent | null = null;
  let inShootout = false;
  for (const it of items) {
    if (it.at > t) break;
    const e = it.event;
    const done = it.at + it.dur <= t;
    if (e.type === 'shootout') inShootout = true;
    if (!done && t >= it.at) active = it;
    if (done) {
      if (e.type === 'red' && e.p) redded.add(dotKey(e.team, e.p));
      if (e.type === 'yellow' && e.p) booked.add(dotKey(e.team, e.p));
    }
  }
  const fast = !active && quiet.some(([a, b]) => t >= a && t < b);
  const poss0 = result.stats.possession[0] / 100;
  const lead = leadFor(items, t);
  const amb = ambient(layout, t, poss0, redded, lead);
  let ch: Choreo | null = null;
  const positions = new Map<string, Pt>(amb.positions);
  let ball: Pt = amb.ball;
  let lift = amb.lift;

  if (active && !isHighlight(active.event) && !BANNER.has(active.event.type)) {
    // a minor moment (a yellow card, a speculative shot, a routine free kick or corner): a label over the arrow, nothing moves
    const e = active.event;
    const who = e.p ? layout.byKey.get(dotKey(e.team, e.p))?.short ?? '' : '';
    const kind: TagKind = e.type === 'yellow' ? 'yellow' : e.type === 'save' ? 'save' : e.type === 'post' ? 'post' : e.type === 'miss' ? 'miss' : e.type === 'freekick' ? 'freekick' : 'corner';
    ch = { ball: amb.ball, tag: { kind, text: TAG_TEXT[kind]!, sub: who, team: e.team }, poss: amb.poss };
  } else if (active) {
    const e = active.event;
    const p = clamp((t - active.at) / Math.max(1, active.dur), 0, 1);
    // every moment starts from where the flow of play was when it began
    const startAmb = ambient(layout, active.at, poss0, redded, leadFor(items, active.at));
    const rough = startAmb.rough;
    const startBall = startAmb.ball;
    if (e.type === 'goal' || e.type === 'save' || e.type === 'miss' || e.type === 'post') {
      ch = e.src && e.src !== 'play' ? setPieceShotChoreo(layout, e, p, redded, rough) : playChoreo(layout, e, p, redded, rough, startBall);
    } else if (e.type === 'freekick' || e.type === 'penalty' || e.type === 'corner') ch = awardChoreo(layout, e, p, redded, rough, startBall);
    else if (e.type === 'yellow' || e.type === 'red') ch = cardChoreo(layout, e, p, redded, rough, startBall);
    else if (e.type === 'pen_goal' || e.type === 'pen_miss') ch = shootoutChoreo(layout, e, p, redded);
    else {
      const mark = DEAD_MARK[e.type];
      ch = { ball: e.type === 'shootout' ? pt(CX, 52.5) : lerpPt(startBall, pt(CX, PH / 2), ease(p * 2)), tag: mark ? { kind: 'info', text: mark, sub: '', team: 0 } : null, ballRough: pt(CX, PH / 2), poss: null };
    }
    const lay = inShootout ? shootoutLayout(layout, redded) : null;
    for (const q of layout.players) {
      if (redded.has(q.key)) continue;
      positions.set(q.key, ch.over?.get(q.key) ?? lay?.get(q.key) ?? shaped(q, ch.ballRough ?? rough, ch.poss ?? null));
    }
    ball = ch.ball;
    lift = ch.lift ?? 0;
  } else if (inShootout) {
    for (const [k, v] of shootoutLayout(layout, redded)) positions.set(k, v);
    ball = pt(CX, 11);
    lift = 0;
  }

  // the camera cuts to highlights only: players and ball fade in just before one and out just after it. Banners (half-time,
  // full-time) are shown on an empty pitch. Everything else is the arrow.
  let live = 0;
  let banner = false;
  for (const it of items) {
    if (it.at - FADE_IN > t) break;
    const end = it.at + it.dur;
    if (t > end + FADE_OUT) continue;
    const e = it.event;
    if (BANNER.has(e.type)) { if (t >= it.at && t <= end) banner = true; continue; }
    if (!isHighlight(e)) continue;
    const a = t < it.at ? ease((t - (it.at - FADE_IN)) / FADE_IN) : t <= end ? 1 : 1 - ease((t - end) / FADE_OUT);
    live = Math.max(live, a);
  }
  if (inShootout) live = 1;
  // before kick-off the players stand in formation; there is no attack to show an arrow for yet
  if (items.length && t < items[0]!.at) live = 1;
  const calm = banner || inShootout ? 0 : 1 - live;
  let flow: Flow | null = null;
  if (calm > 0.01) {
    // how far up the pitch the (unseen) attack has got decides how dangerous it looks; a coming chance overrides it
    const adv: [number, number] = [clamp((PH - amb.base.y) / PH, 0, 1), clamp(amb.base.y / PH, 0, 1)];
    const level: [number, number] = [0, 1].map((k) => clamp(0.1 + 0.5 * Math.pow(adv[k]!, 1.6) + 0.05 * Math.sin(t / 1700 + k * 2), 0.06, 0.6)) as [number, number];
    if (lead) level[lead.team] = mix(level[lead.team], lead.level, lead.w);
    const lane = clamp(amb.rough.x, 14, PW - 14);
    flow = { show: [amb.w[0] * calm, amb.w[1] * calm], level, lane: [lane, lane], label: [labelOf(level[0]), labelOf(level[1])] };
  }

  const dots: DotS[] = [];
  for (const q of layout.players) {
    const pos = positions.get(q.key);
    if (!pos || redded.has(q.key)) continue;
    dots.push({
      key: q.key, id: q.id, team: q.team, x: pos.x, y: pos.y, gk: q.gk, label: q.short,
      hot: !!ch?.hot?.has(q.key),
      booked: booked.has(q.key),
      carded: ch?.card?.key === q.key ? ch.card.color : null,
      down: !!ch?.down?.has(q.key),
      scale: ch?.scale?.get(q.key) ?? 1,
    });
  }
  return {
    flow,
    live,
    dots,
    ball: { x: ball.x, y: ball.y, lift, hot: !!ch?.shot },
    trail: [],
    tag: ch?.tag ?? null,
    shot: ch?.shot ?? null,
    pulse: ch?.pulse ?? null,
    ref: ch?.ref ?? null,
    ripple: ch?.ripple ?? null,
    fast,
    shootout: inShootout,
  };
}

/* ───────────── movement: everything follows its target at a believable speed ───────────── */
// The picture above says where things SHOULD be; this makes them get there like real people and a real ball. Each dot and
// the ball chase their target with a short lag and a speed limit, simulated once per match at 30 frames a second and
// cached. A pure function of time cannot remember where a dot was, so without this two moments in a row (free kick,
// card, shot) would swap formations instantly: that was the "puf". Now nothing can move faster than the limits, by
// construction, and both friends still see exactly the same movie.

const STEP_MS = 1000 / 30;
const DOT_SPEED = 9.5; // metres per second: a hard sprint
const DOT_LAG = 0.22; // seconds
const BALL_SPEED = 36; // a driven shot
const BALL_LAG = 0.03;

interface Track { dots: Array<Map<string, Pt>>; ball: Pt[] }
const tracks = new WeakMap<ScheduledEvent[], WeakMap<Layout, Track>>();

function chase(cur: Pt, want: Pt, lag: number, speed: number): Pt {
  const k = 1 - Math.exp(-STEP_MS / 1000 / lag);
  let dx = (want.x - cur.x) * k;
  let dy = (want.y - cur.y) * k;
  const m = Math.hypot(dx, dy);
  const cap = (speed * STEP_MS) / 1000;
  if (m > cap) { dx *= cap / m; dy *= cap / m; }
  return { x: cur.x + dx, y: cur.y + dy };
}

function trackFor(args: SceneArgs): Track {
  let perLayout = tracks.get(args.items);
  if (!perLayout) { perLayout = new WeakMap(); tracks.set(args.items, perLayout); }
  const have = perLayout.get(args.layout);
  if (have) return have;
  const end = args.items.reduce((m, it) => Math.max(m, it.at + it.dur), 0) + 6000;
  const track: Track = { dots: [], ball: [] };
  let dots = new Map<string, Pt>();
  let ball: Pt | null = null;
  for (let t = 0; t <= end; t += STEP_MS) {
    const want = desiredScene({ ...args, t });
    const next = new Map<string, Pt>();
    for (const d of want.dots) {
      const cur = dots.get(d.key);
      next.set(d.key, cur ? chase(cur, d, DOT_LAG, DOT_SPEED) : { x: d.x, y: d.y });
    }
    ball = ball ? chase(ball, want.ball, BALL_LAG, BALL_SPEED) : { x: want.ball.x, y: want.ball.y };
    dots = next;
    track.dots.push(next);
    track.ball.push(ball);
  }
  perLayout.set(args.layout, track);
  return track;
}

export function buildScene(args: SceneArgs): Scene {
  const want = desiredScene(args);
  const track = trackFor(args);
  const f = Math.max(0, args.t) / STEP_MS;
  const i = Math.min(track.dots.length - 1, Math.floor(f));
  const j = Math.min(track.dots.length - 1, i + 1);
  const u = clamp(f - i, 0, 1);
  const dots: DotS[] = [];
  for (const d of want.dots) {
    const a = track.dots[i]!.get(d.key);
    const b = track.dots[j]!.get(d.key) ?? a;
    const pos = a && b ? lerpPt(a, b, u) : { x: d.x, y: d.y };
    dots.push({ ...d, x: pos.x, y: pos.y });
  }
  const bp = lerpPt(track.ball[i]!, track.ball[j]!, u);
  return { ...want, dots, ball: { ...want.ball, x: bp.x, y: bp.y } };
}

/** the scene a few frames ago, for the ball's trail */
export function ballTrail(args: SceneArgs, steps = 5, gap = 45): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = steps; i >= 1; i--) {
    const s = buildScene({ ...args, t: Math.max(0, args.t - i * gap) });
    out.push({ x: s.ball.x, y: s.ball.y });
  }
  return out;
}
