// Turns a simulated match into pictures. Pure and deterministic: given the match result, the playback schedule and a
// time, it returns where all 22 players, the ball and every highlight are. No randomness besides seeded hashes, so
// both friends see exactly the same movie, and it can be unit-tested without a browser.
//
// Coordinates are metres on a 68 x 105 pitch. Team 0 defends the bottom goal and attacks UP; team 1 attacks DOWN.

import { FORMATIONS, type Role } from '../../shared/formations';
import { player, shortName } from '../../shared/players';
import { hashSeed } from '../../shared/rng';
import { traits } from '../../shared/playerstats';
import type { MatchEvent, MatchResult, ScheduledEvent } from '../../shared/sim';
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

export interface Scene {
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

/** shape: everyone drifts toward the ball, the side with the ball pushes up */
function shaped(p: P, ball: Pt, poss: 0 | 1 | null): Pt {
  const push = poss === p.team && !p.gk ? 2.6 * (p.team === 0 ? -1 : 1) : 0;
  return {
    x: clamp(p.bx + (ball.x - CX) * 0.11 * (p.gk ? 0.4 : 1), 1.5, PW - 1.5),
    y: clamp(p.by + (ball.y - PH / 2) * p.k + push, p.gk ? (p.team === 0 ? PH - 6 : 1.5) : 2, p.gk ? (p.team === 0 ? PH - 1.5 : 6) : PH - 2),
  };
}

/* ───────────── ambient play (nothing is happening) ───────────── */

function ambient(layout: Layout, t: number, fast: boolean, poss0: number, redded: Set<string>): { ball: Pt; rough: Pt; poss: 0 | 1; positions: Map<string, Pt>; lift: number } {
  const cadence = fast ? 260 : 720;
  const i = Math.floor(t / cadence);
  const u = (t % cadence) / cadence;
  const possOf = (n: number): 0 | 1 => (rnd(`${layout.salt}poss${Math.floor(n / 4)}`) < poss0 ? 0 : 1);
  const poss = possOf(i);
  // slow drift of the whole shape toward the side that is attacking
  const tilt = (0.5 - poss0) * 20;
  const rough: Pt = { x: CX + 9 * Math.sin(t / 1900), y: PH / 2 + tilt + 10 * Math.sin(t / 2700 + 1) + (poss === 0 ? -5 : 5) };
  const positions = new Map<string, Pt>();
  for (const p of layout.players) if (!redded.has(p.key)) positions.set(p.key, shaped(p, rough, poss));
  const pick = (n: number): P => {
    const list = layout.teams[possOf(n)].filter((p) => !redded.has(p.key) && !p.gk);
    return list[Math.floor(rnd(`${layout.salt}pass${n}`) * list.length) % list.length]!;
  };
  const from = positions.get(pick(i).key)!;
  const to = positions.get(pick(i + 1).key)!;
  const e = ease(u);
  const ball = { x: mix(from.x, to.x, e), y: mix(from.y, to.y, e) - Math.sin(Math.PI * u) * 1.1 };
  return { ball, rough, poss, positions, lift: Math.sin(Math.PI * u) * 0.25 };
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

export function buildScene({ layout, result, items, quiet, t }: SceneArgs): Scene {
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
  const amb = ambient(layout, t, fast, poss0, redded);
  const base: Choreo = { ball: amb.ball, lift: amb.lift, poss: amb.poss, ballRough: amb.rough };
  let ch: Choreo = base;
  let positions = amb.positions;

  if (active) {
    const e = active.event;
    const p = clamp((t - active.at) / Math.max(1, active.dur), 0, 1);
    // blend in from wherever the ambient ball was when the moment began
    const startAmb = ambient(layout, active.at, false, poss0, redded);
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
    positions = new Map<string, Pt>();
    for (const q of layout.players) if (!redded.has(q.key)) positions.set(q.key, shaped(q, ch.ballRough ?? rough, ch.poss ?? null));
  } else if (inShootout) {
    positions = shootoutLayout(layout, redded);
    ch = { ball: pt(CX, 11), ballRough: pt(CX, 30) };
  }
  if (ch.over) for (const [key, pos] of ch.over) if (!redded.has(key)) positions.set(key, pos);

  // the player being sent off stays on the pitch until his card has been shown
  const dots: DotS[] = [];
  for (const q of layout.players) {
    const pos = positions.get(q.key);
    if (!pos) continue;
    dots.push({
      key: q.key, id: q.id, team: q.team, x: pos.x, y: pos.y, gk: q.gk, label: q.short,
      hot: !!ch.hot?.has(q.key),
      booked: booked.has(q.key),
      carded: ch.card?.key === q.key ? ch.card.color : null,
      down: !!ch.down?.has(q.key),
      scale: ch.scale?.get(q.key) ?? 1,
    });
  }
  // trail: where the ball was a moment ago
  const trail: Pt[] = [];
  return {
    dots,
    ball: { x: ch.ball.x, y: ch.ball.y, lift: ch.lift ?? 0, hot: !!ch.shot },
    trail,
    tag: ch.tag ?? null,
    shot: ch.shot ?? null,
    pulse: ch.pulse ?? null,
    ref: ch.ref ?? null,
    ripple: ch.ripple ?? null,
    fast,
    shootout: inShootout,
  };
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
