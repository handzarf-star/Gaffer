// Saved-state pipeline for a career league (CareerState). See ../migrate.ts for the contract.
//
// A league lives for months, so unlike a room it is NEVER deleted for being old: it is migrated, or (if this build cannot
// read it) left exactly as it is. How to change the shape of CareerState safely:
//   1. bump `v` in engine.ts and `current` below;
//   2. add `steps[<old version>]`: a small pure function that adds/renames/reshapes what changed;
//   3. extend normalise() so the NEW field also has a default when it is missing (a save written by a build in between,
//      or hand-repaired, must still load);
//   4. freeze a fixture of the old shape in tests/fixtures/ (never regenerate it) and run it through tests/migrate.test.ts.
// Sprint 3B's fields (energy, estimated ages, retirement, youth intake) go through exactly this door.

import { FORMATION_IDS } from '../formations';
import { STYLE_IDS } from '../squad';
import { bool, boolMap, int, isRec, list, loadState, num, numMap, numOrNull, oneOf, rec, str, strMap, strs, unplayable, type Loaded, type Pipeline } from '../migrate';
import { defaultBadge, validBadge } from './world';
import {
  DEFAULT_SETTINGS, type CareerState, type Club, type Draft, type Fixture, type HumanMatch, type League, type Member, type News, type NewsKind,
  type PlayerStats, type SeasonRecord, type Swap, type Window,
} from './engine';

const PHASES = ['lobby', 'draft', 'play', 'window'] as const;
const NEWS_KINDS: readonly NewsKind[] = [
  'joined', 'draft_start', 'draft_done', 'injury', 'suspension', 'red', 'window_open', 'window_done', 'swap', 'swap_failed', 'champion', 'promoted', 'relegated', 'season_start',
];

function settings(raw: unknown): CareerState['settings'] {
  const s = rec(raw);
  const hours = (v: unknown, d: number, hi: number) => Math.min(hi, Math.max(1, int(v, d)));
  return {
    pickHours: hours(s.pickHours, DEFAULT_SETTINGS.pickHours, 72),
    dayHours: hours(s.dayHours, DEFAULT_SETTINGS.dayHours, 168),
    windowHours: hours(s.windowHours, DEFAULT_SETTINGS.windowHours, 168),
    bot: oneOf(s.bot, ['easy', 'normal', 'hard'] as const, DEFAULT_SETTINGS.bot),
  };
}

function club(id: string, o: Record<string, unknown>): Club {
  const name = str(o.name, id);
  const newcomers: Club['newcomers'] = {};
  for (const [pid, v] of Object.entries(rec(o.newcomers))) if (isRec(v)) newcomers[pid] = { left: Math.max(0, int(v.left, 0)), heavy: bool(v.heavy) };
  const xi: Club['xi'] = {};
  for (const [slot, v] of Object.entries(rec(o.xi))) if (v === null || typeof v === 'string') xi[slot] = v;
  const sharp = rec(o.sharp);
  return {
    id,
    name,
    badge: validBadge(o.badge) ? o.badge : defaultBadge(name),
    league: o.league === 2 ? 2 : 1,
    real: bool(o.real),
    human: typeof o.human === 'string' ? o.human : null,
    roster: strs(o.roster),
    formation: oneOf(o.formation, FORMATION_IDS, '433'),
    style: oneOf(o.style, STYLE_IDS, 'possession'),
    xi,
    ready: bool(o.ready),
    newcomers,
    sharp: { left: Math.max(0, int(sharp.left, 0)), hit: Math.max(0, num(sharp.hit, 0)) },
  };
}

function fixture(o: Record<string, unknown>): Fixture | null {
  if (typeof o.a !== 'string' || typeof o.b !== 'string') return null;
  const f: Fixture = { a: o.a, b: o.b };
  if (Array.isArray(o.r) && o.r.length === 2 && o.r.every((n) => typeof n === 'number' && Number.isFinite(n))) f.r = [o.r[0] as number, o.r[1] as number];
  if (Array.isArray(o.g)) f.g = strs(o.g);
  if (typeof o.hum === 'boolean') f.hum = o.hum;
  return f;
}

function league(x: unknown): League {
  const l = rec(x);
  const days: Fixture[][] = Array.isArray(l.days) ? l.days.map((d) => list(d, fixture)) : [];
  return { clubs: strs(l.clubs), days };
}

function draft(x: unknown): Draft | null {
  if (!isRec(x)) return null;
  const picks: Array<[string, string]> = [];
  if (Array.isArray(x.picks)) for (const p of x.picks) if (Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string') picks.push([p[0], p[1]]);
  return { order: strs(x.order), i: Math.max(0, int(x.i, 0)), picks, deadline: numOrNull(x.deadline) };
}

function swaps(x: unknown): Swap[] {
  return list(x, (o) => (typeof o.out === 'string' && typeof o.in === 'string' ? { out: o.out, in: o.in } : null));
}

function window(x: unknown): Window | null {
  if (!isRec(x)) return null;
  const plans: Window['plans'] = {};
  for (const [k, v] of Object.entries(rec(x.plans))) plans[k] = swaps(v);
  return {
    kind: x.kind === 'end' ? 'end' : 'mid', order: strs(x.order), free: Math.max(0, int(x.free, 0)), max: Math.max(0, int(x.max, 0)),
    deadline: numOrNull(x.deadline), plans, ready: boolMap(x.ready),
  };
}

function stats(x: unknown): Record<string, PlayerStats> {
  const out: Record<string, PlayerStats> = {};
  for (const [pid, v] of Object.entries(rec(x))) {
    if (!isRec(v)) continue;
    out[pid] = { app: Math.max(0, int(v.app, 0)), g: Math.max(0, int(v.g, 0)), a: Math.max(0, int(v.a, 0)), y: Math.max(0, int(v.y, 0)), r: Math.max(0, int(v.r, 0)) };
  }
  return out;
}

function injuries(x: unknown): CareerState['injuries'] {
  const out: CareerState['injuries'] = {};
  for (const [pid, v] of Object.entries(rec(x))) if (isRec(v) && num(v.left, 0) > 0) out[pid] = { left: int(v.left, 1), kind: str(v.kind, 'knock') };
  return out;
}

/** The story of a human match is only used for "watch"; if it cannot be read it is dropped, never the league. */
function lastDay(x: unknown): CareerState['lastDay'] {
  if (!isRec(x) || !Array.isArray(x.matches)) return null;
  const matches = x.matches.filter((m): m is HumanMatch => isRec(m) && isRec(m.result) && Array.isArray(m.squads) && m.squads.length === 2 && typeof m.a === 'string' && typeof m.b === 'string');
  return { season: int(x.season, 1), day: int(x.day, 0), matches };
}

function history(x: unknown): SeasonRecord[] {
  return list(x, (o) => {
    if (typeof o.season !== 'number' || !Number.isFinite(o.season)) return null;
    const champ = rec(o.champion);
    const humans: SeasonRecord['humans'] = {};
    for (const [k, v] of Object.entries(rec(o.humans))) if (isRec(v)) humans[k] = { league: v.league === 2 ? 2 : 1, pos: Math.max(1, int(v.pos, 1)) };
    const ts = isRec(o.topScorer) && typeof o.topScorer.player === 'string' ? { player: o.topScorer.player, goals: Math.max(0, int(o.topScorer.goals, 0)) } : null;
    return { season: Math.trunc(o.season), champion: { '1': str(champ['1']), '2': str(champ['2']) }, promoted: strs(o.promoted), relegated: strs(o.relegated), topScorer: ts, humans };
  });
}

function newsList(x: unknown): News[] {
  const out = list(x, (o): News | null => {
    if (!NEWS_KINDS.includes(o.kind as NewsKind)) return null;
    const n: News = { season: int(o.season, 1), day: int(o.day, 0), kind: o.kind as NewsKind };
    if (typeof o.club === 'string') n.club = o.club;
    if (typeof o.other === 'string') n.other = o.other;
    if (typeof o.player === 'string') n.player = o.player;
    if (typeof o.n === 'number' && Number.isFinite(o.n)) n.n = o.n;
    if (typeof o.text === 'string') n.text = o.text;
    return n;
  });
  return out.slice(-150);
}

export function normaliseCareer(s: Record<string, unknown>): CareerState {
  if (typeof s.code !== 'string' || !s.code) unplayable('league code');
  const rawClubs = rec(s.clubs);
  const rawLeagues = rec(s.leagues);
  if (Object.keys(rawClubs).length === 0) unplayable('clubs');
  if (!isRec(rawLeagues['1']) || !isRec(rawLeagues['2'])) unplayable('leagues');
  const phase = oneOf(s.phase, PHASES, 'lobby');
  if (s.phase !== phase) unplayable('phase');

  const clubs: Record<string, Club> = {};
  for (const [id, v] of Object.entries(rawClubs)) if (isRec(v)) clubs[id] = club(id, v);
  const members = list(s.members, (o): Member | null => (typeof o.id === 'string' && typeof o.clubId === 'string' && clubs[o.clubId] ? { id: o.id, name: str(o.name, 'Manager'), clubId: o.clubId, auto: bool(o.auto) } : null));

  const st: CareerState = {
    v: 1,
    code: s.code as string,
    seed: str(s.seed),
    createdAt: num(s.createdAt, 0),
    settings: settings(s.settings),
    phase,
    season: Math.max(1, int(s.season, 1)),
    day: Math.max(0, int(s.day, 0)),
    deadline: numOrNull(s.deadline),
    members,
    clubs,
    leagues: { '1': league(rawLeagues['1']), '2': league(rawLeagues['2']) },
    owner: strMap(s.owner),
    draft: draft(s.draft),
    window: window(s.window),
    ratings: numMap(s.ratings),
    ages: numMap(s.ages),
    injuries: injuries(s.injuries),
    susp: numMap(s.susp),
    yel: numMap(s.yel),
    stats: stats(s.stats),
    lastDay: lastDay(s.lastDay),
    history: history(s.history),
    news: newsList(s.news),
    rev: Math.max(0, int(s.rev, 0)),
  };
  // a phase whose working data is gone cannot be played; refuse rather than guess
  if (st.phase === 'draft' && !st.draft) unplayable('draft');
  if (st.phase === 'window' && !st.window) unplayable('transfer window');
  return st;
}

export const careerPipeline: Pipeline<CareerState> = { current: 1, oldest: 1, steps: {}, normalise: normaliseCareer };

export const loadCareer = (raw: unknown): Loaded<CareerState> => loadState(careerPipeline, raw);
