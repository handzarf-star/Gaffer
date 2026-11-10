// Career mode: a long-lived league of real clubs, managed over seasons.
// Pure and clock-injected like RoomEngine: state in, state out, `now` always passed in. State is plain JSON.
//
// How "together" and "apart" share one rule (the matchday gate):
//   a matchday is played when every human has confirmed their line-up, or when its deadline passes, whichever is first.
//   Results are a function of seed + line-ups at that moment, so nobody waits for anybody to *watch*: you can watch your
//   match any time afterwards. Played together, everyone confirms at once and the day goes straight through. Played apart,
//   the day waits at most `dayHours` for the slowest manager and then plays with their saved line-up.

import { Rng, hashSeed } from '../rng';
import { FORMATIONS, FORMATION_IDS, assignBest, effectiveOvr, type FormationId } from '../formations';
import { STYLE_IDS, profile, type Squad, type StyleId } from '../squad';
import { simulateMatch, type MatchResult } from '../sim';
import { circleRounds } from '../competition';
import { withRatings } from '../players';
import { defaultBadge, validBadge, type Badge, type IndexedWorld, type Line, type WorldPlayer, lineOf } from './world';

/* ───────────── rules ───────────── */

export const ROSTER = 20;
export const BENCH = 7;
export const DAYS = 30;
export const WINDOW_AFTER = 15;
export const LEAGUE_SIZE = 16;
export const MIN_LINE: Record<Line, number> = { GK: 2, DF: 6, MF: 6, FW: 3 };
export const MAX_LINE: Record<Line, number> = { GK: 3, DF: 8, MF: 8, FW: 6 };
export const SWAPS = { mid: { free: 3, max: 8 }, end: { free: 8, max: 12 } } as const;
/** Newcomers are not at full pace at once; the heavier the reshuffle, the longer it takes (rating points lost, fading to zero).
 *  Measured on the match engine: every rating point lost on all ten outfield starters costs about 0.09 points a match, so
 *  a window of eight swaps (five over the allowance) costs roughly 3 points over the next six matches. A big reshuffle
 *  is a net loss, a few sensible changes are not. No points are ever deducted. */
export const SETTLE = { mild: { hit: 2, matches: 3 }, heavy: { hit: 5, matches: 6 } } as const;
export const SHARP = { perExtraSwap: 1.2, cap: 6, matches: 6 } as const;
export const DEFAULT_SETTINGS = { pickHours: 12, dayHours: 24, windowHours: 48, bot: 'normal' as 'easy' | 'normal' | 'hard' };

/* ───────────── state ───────────── */

export type Phase = 'lobby' | 'draft' | 'play' | 'window';
export type WindowKind = 'mid' | 'end';
export type Result = { ok: true } | { ok: false; code: string; msg: string };
const fail = (code: string, msg: string): Result => ({ ok: false, code, msg });
const OK: Result = { ok: true };

export interface Member { id: string; name: string; clubId: string; auto: boolean }

export interface Club {
  id: string;
  name: string;
  badge: Badge;
  league: 1 | 2;
  /** false = a club the manager invented */
  real: boolean;
  human: string | null;
  roster: string[];
  formation: FormationId;
  style: StyleId;
  /** the manager's saved slots (slot id -> player id); bots always pick fresh */
  xi: Record<string, string | null>;
  ready: boolean;
  /** player id -> settling-in */
  newcomers: Record<string, { left: number; heavy: boolean }>;
  /** whole-team sharpness lost after a big reshuffle */
  sharp: { left: number; hit: number };
}

export interface Fixture {
  a: string;
  b: string;
  /** score once played */
  r?: [number, number];
  /** scorer player ids, for the top-scorers table */
  g?: string[];
  /** a human club plays in this fixture (its story is kept for "watch") */
  hum?: boolean;
}

export interface League { clubs: string[]; days: Fixture[][] }

export interface PlayerStats { app: number; g: number; a: number; y: number; r: number }

export interface Draft {
  order: string[];
  i: number;
  picks: Array<[string, string]>;
  deadline: number | null;
}

export interface Swap { out: string; in: string }

export interface Window {
  kind: WindowKind;
  /** club ids, worst first: the order contested free agents are handed out */
  order: string[];
  free: number;
  max: number;
  deadline: number | null;
  plans: Record<string, Swap[]>;
  ready: Record<string, boolean>;
}

export type NewsKind =
  | 'joined' | 'draft_start' | 'draft_done' | 'injury' | 'suspension' | 'red' | 'window_open' | 'window_done' | 'swap'
  | 'swap_failed' | 'champion' | 'promoted' | 'relegated' | 'season_start';
export interface News { season: number; day: number; kind: NewsKind; club?: string; other?: string; player?: string; n?: number; text?: string }

export interface SeasonRecord {
  season: number;
  champion: Record<'1' | '2', string>;
  promoted: string[];
  relegated: string[];
  topScorer: { player: string; goals: number } | null;
  /** final position of each human club */
  humans: Record<string, { league: 1 | 2; pos: number }>;
}

export interface HumanMatch { league: 1 | 2; a: string; b: string; result: MatchResult; squads: [Squad, Squad] }

export interface CareerState {
  v: 1;
  code: string;
  seed: string;
  createdAt: number;
  settings: typeof DEFAULT_SETTINGS;
  phase: Phase;
  season: number;
  /** matchdays played this season */
  day: number;
  deadline: number | null;
  members: Member[];
  clubs: Record<string, Club>;
  leagues: Record<'1' | '2', League>;
  owner: Record<string, string>;
  draft: Draft | null;
  window: Window | null;
  ratings: Record<string, number>;
  ages: Record<string, number>;
  injuries: Record<string, { left: number; kind: string }>;
  susp: Record<string, number>;
  yel: Record<string, number>;
  stats: Record<string, PlayerStats>;
  lastDay: { season: number; day: number; matches: HumanMatch[] } | null;
  history: SeasonRecord[];
  news: News[];
  rev: number;
}

/* ───────────── helpers ───────────── */

const lg = (n: 1 | 2): '1' | '2' => (n === 1 ? '1' : '2');

export function ovrOf(w: IndexedWorld, st: CareerState, pid: string): number {
  return st.ratings[pid] ?? w.player(pid).ovr;
}
export function ageOf(w: IndexedWorld, st: CareerState, pid: string): number | null {
  return st.ages[pid] ?? w.player(pid).age;
}
export const isAvailable = (st: CareerState, pid: string): boolean => !st.injuries[pid] && !((st.susp[pid] ?? 0) > 0);

function lineCounts(w: IndexedWorld, ids: readonly string[]): Record<Line, number> {
  const c: Record<Line, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const id of ids) c[lineOf(w.player(id).pos)]++;
  return c;
}

/** Can a roster that holds `ids` still be completed into a legal squad of ROSTER players? */
export function legalAfter(w: IndexedWorld, ids: readonly string[]): boolean {
  const c = lineCounts(w, ids);
  const lines = Object.keys(MIN_LINE) as Line[];
  if (lines.some((l) => c[l] > MAX_LINE[l])) return false;
  const remaining = ROSTER - ids.length;
  if (remaining < 0) return false;
  const need = lines.reduce((a, l) => a + Math.max(0, MIN_LINE[l] - c[l]), 0);
  const room = lines.reduce((a, l) => a + Math.max(0, MAX_LINE[l] - c[l]), 0);
  return need <= remaining && remaining <= room;
}

function news(st: CareerState, n: Omit<News, 'season' | 'day'>): void {
  st.news.push({ season: st.season, day: st.day, ...n });
  if (st.news.length > 150) st.news.splice(0, st.news.length - 150);
}

const humanClubs = (st: CareerState): Club[] => st.members.map((m) => st.clubs[m.clubId]!).filter(Boolean);

export function emptyStats(): PlayerStats { return { app: 0, g: 0, a: 0, y: 0, r: 0 }; }

/* ───────────── create / join ───────────── */

export function createCareer(w: IndexedWorld, code: string, seed: string, now: number): CareerState {
  const st: CareerState = {
    v: 1, code, seed, createdAt: now, settings: { ...DEFAULT_SETTINGS }, phase: 'lobby', season: 1, day: 0, deadline: null,
    members: [], clubs: {}, leagues: { '1': { clubs: [], days: [] }, '2': { clubs: [], days: [] } }, owner: {}, draft: null, window: null,
    ratings: {}, ages: {}, injuries: {}, susp: {}, yel: {}, stats: {}, lastDay: null, history: [], news: [], rev: 0,
  };
  for (const c of w.clubs) {
    st.clubs[c.id] = newClub(c.id, c.name, c.league, true, defaultBadge(c.name, c.colors));
    st.leagues[lg(c.league)].clubs.push(c.id);
  }
  return st;
}

function newClub(id: string, name: string, league: 1 | 2, real: boolean, badge: Badge): Club {
  return { id, name, badge, league, real, human: null, roster: [], formation: '433', style: 'possession', xi: {}, ready: false, newcomers: {}, sharp: { left: 0, hit: 0 } };
}

export type ClubChoice = { kind: 'real'; id: string } | { kind: 'custom'; name: string };

const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,22}[\p{L}\p{N}.]$/u;
export function cleanClubName(raw: string): string | null {
  const n = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  return NAME_OK.test(n) && !/https?:|www\./i.test(n) ? n : null;
}

export function joinCareer(w: IndexedWorld, st: CareerState, input: { memberId: string; name: string; choice: ClubChoice; badge?: Badge }): Result {
  if (st.phase !== 'lobby') return fail('started', 'The league has already started.');
  if (st.members.some((m) => m.id === input.memberId)) return fail('joined', 'You are already in this league.');
  if (st.members.length >= 4) return fail('full', 'A league has room for four managers.');
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name) return fail('name', 'Enter your name.');
  if (input.badge !== undefined && !validBadge(input.badge)) return fail('badge', 'That badge is not valid.');
  let club: Club;
  if (input.choice.kind === 'real') {
    const c = st.clubs[input.choice.id];
    if (!c || !c.real) return fail('club', 'That club is not in this league.');
    if (c.league !== 1) return fail('club', 'Pick a First League club to start.');
    if (c.human) return fail('taken', 'Another manager already has that club.');
    club = c;
    if (input.badge) club.badge = input.badge;
  } else {
    const cn = cleanClubName(input.choice.name);
    if (!cn) return fail('club_name', 'Use 2 to 24 letters, numbers, spaces or . \' & -');
    if (Object.values(st.clubs).some((c) => c.name.toLowerCase() === cn.toLowerCase())) return fail('club_name', 'A club with that name already exists.');
    // an invented club takes the place of the weakest First League club nobody has chosen
    const victim = weakestFree(w, st);
    if (!victim) return fail('club', 'No First League place is free for a new club.');
    const lgs = st.leagues['1'];
    lgs.clubs = lgs.clubs.filter((id) => id !== victim.id);
    delete st.clubs[victim.id];
    club = newClub(`x-${input.memberId.slice(0, 8)}`, cn, 1, false, input.badge ?? defaultBadge(cn));
    st.clubs[club.id] = club;
    lgs.clubs.push(club.id);
  }
  club.human = input.memberId;
  st.members.push({ id: input.memberId, name, clubId: club.id, auto: false });
  news(st, { kind: 'joined', club: club.id, text: name });
  st.rev++;
  return OK;
}

function weakestFree(w: IndexedWorld, st: CareerState): Club | null {
  const strength = (id: string) => {
    const ps = [...(w.byClub.get(id) ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 14);
    return ps.reduce((a, p) => a + p.ovr, 0) / Math.max(1, ps.length);
  };
  const free = st.leagues['1'].clubs.map((id) => st.clubs[id]!).filter((c) => c.real && !c.human);
  free.sort((a, b) => strength(a.id) - strength(b.id));
  return free[0] ?? null;
}

export function setSettings(st: CareerState, patch: Partial<typeof DEFAULT_SETTINGS>): Result {
  if (st.phase !== 'lobby') return fail('started', 'Settings are fixed once the league starts.');
  const s = st.settings;
  const clampN = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  s.pickHours = clampN(patch.pickHours, 1, 72, s.pickHours);
  s.dayHours = clampN(patch.dayHours, 1, 168, s.dayHours);
  s.windowHours = clampN(patch.windowHours, 1, 168, s.windowHours);
  if (patch.bot === 'easy' || patch.bot === 'normal' || patch.bot === 'hard') s.bot = patch.bot;
  st.rev++;
  return OK;
}

/* ───────────── draft ───────────── */

/** Everybody's squad is drafted from the whole First League pool, humans and bots alike. */
export function draftPool(w: IndexedWorld, st: CareerState): WorldPlayer[] {
  const out: WorldPlayer[] = [];
  const seen = new Set<string>();
  for (const c of w.clubs) {
    if (c.league !== 1) continue;
    for (const p of w.byClub.get(c.id) ?? []) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
  }
  return out.filter((p) => !st.owner[p.id]);
}

export function startCareer(w: IndexedWorld, st: CareerState, now: number): Result {
  if (st.phase !== 'lobby') return fail('started', 'The league has already started.');
  if (st.members.length < 1) return fail('empty', 'At least one manager has to join first.');
  const l1 = st.leagues['1'].clubs;
  if (l1.length !== LEAGUE_SIZE) return fail('size', 'The First League is not full.');
  const pool = draftPool(w, st);
  if (pool.length < ROSTER * LEAGUE_SIZE) return fail('pool', 'There are not enough players to draft a full league.');
  const rng = new Rng(`${st.seed}/draft-order`);
  const first = rng.shuffle(l1);
  const order: string[] = [];
  for (let r = 0; r < ROSTER; r++) order.push(...(r % 2 === 0 ? first : [...first].reverse()));
  st.draft = { order, i: 0, picks: [], deadline: null };
  st.phase = 'draft';
  // the Second League clubs keep their real squads (best players first, at least two keepers)
  for (const id of st.leagues['2'].clubs) {
    const ps = [...(w.byClub.get(id) ?? [])].sort((a, b) => b.ovr - a.ovr);
    const gks = ps.filter((p) => p.pos === 'GK').slice(0, 2);
    const rest = ps.filter((p) => !gks.includes(p)).slice(0, ROSTER - gks.length);
    for (const p of [...gks, ...rest]) { st.clubs[id]!.roster.push(p.id); st.owner[p.id] = id; }
  }
  news(st, { kind: 'draft_start' });
  st.rev++;
  advanceDraft(w, st, now);
  return OK;
}

/** Is this pick legal for the club (position limits, and the squad can still be completed)? */
function canPick(w: IndexedWorld, st: CareerState, clubId: string, pid: string): Result {
  const club = st.clubs[clubId];
  if (!club) return fail('club', 'Unknown club.');
  if (st.owner[pid]) return fail('taken', 'That player has already been taken.');
  if (!w.has(pid)) return fail('player', 'Unknown player.');
  if (!legalAfter(w, [...club.roster, pid])) return fail('squad', 'Your squad needs a balance: at least 2 keepers, 6 defenders, 6 midfielders and 3 forwards.');
  return OK;
}

export function draftPick(w: IndexedWorld, st: CareerState, memberId: string, pid: string, now: number): Result {
  if (st.phase !== 'draft' || !st.draft) return fail('phase', 'There is no draft running.');
  const member = st.members.find((m) => m.id === memberId);
  if (!member) return fail('member', 'You are not in this league.');
  const onClock = st.draft.order[st.draft.i];
  if (onClock !== member.clubId) return fail('turn', 'It is not your pick yet.');
  const ok = canPick(w, st, member.clubId, pid);
  if (!ok.ok) return ok;
  takePick(st, member.clubId, pid);
  advanceDraft(w, st, now);
  return OK;
}

function takePick(st: CareerState, clubId: string, pid: string): void {
  const d = st.draft!;
  st.clubs[clubId]!.roster.push(pid);
  st.owner[pid] = clubId;
  d.picks.push([clubId, pid]);
  d.i++;
  d.deadline = null;
  st.rev++;
}

/** The best legal pick for a club: rating plus how badly the squad needs that position, with a bit of noise for weaker bots. */
export function suggestPick(w: IndexedWorld, st: CareerState, clubId: string, noise = 0, rng?: Rng): string | null {
  const club = st.clubs[clubId]!;
  const counts = lineCounts(w, club.roster);
  let best: { id: string; s: number } | null = null;
  for (const p of draftPool(w, st)) {
    if (!legalAfter(w, [...club.roster, p.id])) continue;
    const line = lineOf(p.pos);
    const need = Math.max(0, MIN_LINE[line] - counts[line]);
    const remaining = ROSTER - club.roster.length;
    const needAll = (Object.keys(MIN_LINE) as Line[]).reduce((a, l) => a + Math.max(0, MIN_LINE[l] - counts[l]), 0);
    // a keeper is worth less than an outfielder of the same rating until the squad is short of them
    const base = ovrOf(w, st, p.id) - (line === 'GK' && counts.GK >= 2 ? 6 : 0) + need * 3 + (needAll >= remaining ? need * 20 : 0);
    const s = base + (rng && noise ? rng.normal() * noise : 0);
    if (!best || s > best.s) best = { id: p.id, s };
  }
  return best?.id ?? null;
}

const BOT_NOISE = { easy: 5, normal: 2.4, hard: 1 } as const;

/** Run bot picks until a human is on the clock (or the draft is over); time out humans whose pick clock ran out. */
export function advanceDraft(w: IndexedWorld, st: CareerState, now: number): void {
  const d = st.draft;
  if (st.phase !== 'draft' || !d) return;
  for (let guard = 0; guard < 2000 && d.i < d.order.length; guard++) {
    const clubId = d.order[d.i]!;
    const club = st.clubs[clubId]!;
    const human = !!club.human && !st.members.find((m) => m.id === club.human)?.auto;
    if (human) {
      if (d.deadline === null) d.deadline = now + st.settings.pickHours * 3_600_000;
      if (now < d.deadline) return;
    }
    d.deadline = null;
    const pid = suggestPick(w, st, clubId, human ? 0 : BOT_NOISE[st.settings.bot], new Rng(`${st.seed}/pick/${d.i}`));
    if (!pid) { // cannot happen with a big enough pool; keep the league moving rather than deadlock
      d.i++;
      continue;
    }
    takePick(st, clubId, pid);
  }
  if (d.i >= d.order.length) finishDraft(w, st, now);
}

function finishDraft(w: IndexedWorld, st: CareerState, now: number): void {
  for (const c of Object.values(st.clubs)) autoFormation(w, st, c);
  st.draft = null;
  news(st, { kind: 'draft_done' });
  beginSeason(w, st, now);
}

/* ───────────── season set-up ───────────── */

function beginSeason(w: IndexedWorld, st: CareerState, now: number): void {
  for (const id of ['1', '2'] as const) {
    const L = st.leagues[id];
    const rng = new Rng(`${st.seed}/s${st.season}/fixtures/${id}`);
    const rounds = circleRounds(rng.shuffle(L.clubs));
    const second = rounds.map((r) => r.map(([a, b]) => [b, a] as [string, string]));
    const all = [...rounds, ...rng.shuffle(second)];
    L.days = all.map((pairs) => pairs.map(([a, b]) => ({ a, b, hum: !!(st.clubs[a]?.human || st.clubs[b]?.human) })));
  }
  st.day = 0;
  st.stats = {};
  st.yel = {};
  st.lastDay = null;
  st.phase = 'play';
  openMatchday(st, now);
  news(st, { kind: 'season_start', n: st.season });
  st.rev++;
}

function openMatchday(st: CareerState, now: number): void {
  for (const c of Object.values(st.clubs)) c.ready = false;
  st.deadline = now + st.settings.dayHours * 3_600_000;
}

/** Best formation, style and eleven for a club out of everyone fit to play. */
export function autoLineup(w: IndexedWorld, st: CareerState, club: Club): Squad {
  let pool = club.roster.filter((id) => isAvailable(st, id));
  if (pool.length < 11) pool = [...club.roster]; // never field fewer than eleven
  return withRatings(overlayFor(w, st, club), () => bestSquad(pool));
}

/** The best formation, style and eleven out of a pool of players, at the ratings currently in force (call inside withRatings for overrides). */
export function bestSquad(pool: readonly string[]): Squad {
  let best: Squad | null = null;
  let bestO = -1;
  for (const f of FORMATION_IDS) {
    const placed = assignBest([...pool], FORMATIONS[f]);
    const slots: Record<string, string | null> = {};
    for (const s of FORMATIONS[f].slots) slots[s.id] = placed[s.id] ?? null;
    const sq: Squad = { formation: f, slots, style: 'possession' };
    const o = profile(sq).overall;
    if (o > bestO) { best = sq; bestO = o; }
  }
  let style: StyleId = 'possession';
  let so = -1;
  for (const s of STYLE_IDS) {
    const o = profile({ ...best!, style: s }).overall;
    if (o > so) { so = o; style = s; }
  }
  return { ...best!, style };
}

function autoFormation(w: IndexedWorld, st: CareerState, club: Club): void {
  const sq = autoLineup(w, st, club);
  club.formation = sq.formation;
  club.style = sq.style;
  club.xi = { ...sq.slots };
}

/** The eleven that actually start: the manager's saved choice, repaired for anyone injured or suspended. */
export function lineupFor(w: IndexedWorld, st: CareerState, club: Club): Squad {
  if (!club.human) return autoLineup(w, st, club);
  const f = FORMATIONS[club.formation];
  const slots: Record<string, string | null> = {};
  const used = new Set<string>();
  const ok = (id: string | null | undefined): id is string => !!id && club.roster.includes(id) && isAvailable(st, id) && !used.has(id);
  for (const s of f.slots) { const id = club.xi[s.id]; if (ok(id)) { slots[s.id] = id; used.add(id); } else slots[s.id] = null; }
  const over = overlayFor(w, st, club);
  withRatings(over, () => {
    for (const s of f.slots) {
      if (slots[s.id]) continue;
      let best: string | null = null;
      let bo = -1;
      for (const id of club.roster) {
        if (used.has(id) || !isAvailable(st, id)) continue;
        const o = effectiveOvr(id, s.role);
        if (o > bo) { bo = o; best = id; }
      }
      if (!best) { // everyone fit is already in: take anyone not yet used
        best = club.roster.find((id) => !used.has(id)) ?? null;
      }
      if (best) { slots[s.id] = best; used.add(best); }
    }
  });
  return { formation: club.formation, slots, style: club.style };
}

/** Current rating of each player in the club, with settling-in and sharpness taken off. */
export function overlayFor(w: IndexedWorld, st: CareerState, club: Club): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of club.roster) {
    let o = ovrOf(w, st, id);
    const n = club.newcomers[id];
    if (n) {
      const cfg = n.heavy ? SETTLE.heavy : SETTLE.mild;
      o -= cfg.hit * (n.left / cfg.matches);
    }
    if (club.sharp.left > 0 && w.player(id).pos !== 'GK') o -= club.sharp.hit * (club.sharp.left / SHARP.matches);
    out[id] = Math.round(o * 10) / 10;
  }
  return out;
}

/* ───────────── manager actions ───────────── */

export function setLineup(w: IndexedWorld, st: CareerState, memberId: string, input: { formation: FormationId; style: StyleId; slots: Record<string, string | null> }): Result {
  const m = st.members.find((x) => x.id === memberId);
  if (!m) return fail('member', 'You are not in this league.');
  const club = st.clubs[m.clubId]!;
  if (!FORMATIONS[input.formation]) return fail('formation', 'Unknown formation.');
  if (!STYLE_IDS.includes(input.style)) return fail('style', 'Unknown style.');
  const f = FORMATIONS[input.formation];
  const seen = new Set<string>();
  const slots: Record<string, string | null> = {};
  for (const s of f.slots) {
    const id = input.slots[s.id] ?? null;
    if (id) {
      if (!club.roster.includes(id)) return fail('player', 'That player is not in your squad.');
      if (seen.has(id)) return fail('dup', 'A player cannot play twice.');
      seen.add(id);
    }
    slots[s.id] = id;
  }
  void w;
  club.formation = input.formation;
  club.style = input.style;
  club.xi = slots;
  st.rev++;
  return OK;
}

export function setReady(w: IndexedWorld, st: CareerState, memberId: string, ready: boolean, now: number): Result {
  const m = st.members.find((x) => x.id === memberId);
  if (!m) return fail('member', 'You are not in this league.');
  if (st.phase !== 'play') return fail('phase', 'There is no matchday open.');
  st.clubs[m.clubId]!.ready = ready;
  st.rev++;
  tick(w, st, now);
  return OK;
}

export function setAuto(st: CareerState, memberId: string, auto: boolean): Result {
  const m = st.members.find((x) => x.id === memberId);
  if (!m) return fail('member', 'You are not in this league.');
  m.auto = auto;
  st.rev++;
  return OK;
}

/* ───────────── matchday ───────────── */

const humanPending = (st: CareerState): boolean => st.members.some((m) => !m.auto && !st.clubs[m.clubId]!.ready);

/** Move anything that is due forward. Returns true if the state changed. Call after every action and from the alarm. */
export function tick(w: IndexedWorld, st: CareerState, now: number): boolean {
  const before = st.rev;
  const season0 = st.season;
  for (let guard = 0; guard < 400; guard++) {
    const rev = st.rev;
    if (st.phase === 'draft') advanceDraft(w, st, now);
    else if (st.phase === 'play') {
      const due = !humanPending(st) || (st.deadline !== null && now >= st.deadline);
      if (due) runDay(w, st, now);
    } else if (st.phase === 'window' && st.window) {
      const win = st.window;
      // auto-play plays a manager's matches; it does not make his squad decisions, so a window still waits for him (or the deadline)
      const allReady = st.members.every((m) => win.ready[m.id]);
      if (allReady || (win.deadline !== null && now >= win.deadline)) closeWindow(w, st, now);
    }
    if (st.rev === rev || (st.season !== season0 && st.phase === 'play')) break;
  }
  return st.rev !== before;
}

export function nextWake(st: CareerState): number | null {
  if (st.phase === 'draft') return st.draft?.deadline ?? null;
  if (st.phase === 'play') return st.deadline;
  if (st.phase === 'window') return st.window?.deadline ?? null;
  return null;
}

export interface Row { id: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }

export function table(st: CareerState, league: 1 | 2): Row[] {
  const L = st.leagues[lg(league)];
  const rows = new Map<string, Row>(L.clubs.map((id) => [id, { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const day of L.days) for (const f of day) {
    if (!f.r) continue;
    const a = rows.get(f.a), b = rows.get(f.b);
    if (!a || !b) continue;
    const [x, y] = f.r;
    a.p++; b.p++; a.gf += x; a.ga += y; b.gf += y; b.ga += x;
    if (x > y) { a.w++; b.l++; a.pts += 3; } else if (x < y) { b.w++; a.l++; b.pts += 3; } else { a.d++; b.d++; a.pts++; b.pts++; }
  }
  return [...rows.values()].sort((p, q) => q.pts - p.pts || (q.gf - q.ga) - (p.gf - p.ga) || q.gf - p.gf || hashSeed(`${st.seed}/${st.season}/${p.id}`) - hashSeed(`${st.seed}/${st.season}/${q.id}`));
}

const INJURY_KINDS: Array<[number, number, number, string]> = [
  [0.42, 1, 2, 'knock'], [0.75, 3, 6, 'muscle'], [0.93, 7, 14, 'sprain'], [0.985, 15, 26, 'fracture'], [1, 27, 40, 'cruciate'],
];
/** per player per match; about 0.25 injuries per team per match, in line with published injury rates for top-flight football */
const INJURY_RATE = 0.0225;

export function runDay(w: IndexedWorld, st: CareerState, now: number): void {
  if (st.phase !== 'play') return;
  const day = st.day;
  const humanMatches: HumanMatch[] = [];
  // who is unavailable *today* is fixed before anything is played
  const servingSusp = Object.keys(st.susp).filter((id) => (st.susp[id] ?? 0) > 0);
  const servingInj = Object.keys(st.injuries);
  const played = new Set<string>();
  const pending: Pending[] = [];

  for (const lid of [1, 2] as const) {
    const L = st.leagues[lg(lid)];
    const fixtures = L.days[day] ?? [];
    for (const [fi, f] of fixtures.entries()) {
      const A = st.clubs[f.a]!, B = st.clubs[f.b]!;
      const seed = `${st.seed}/s${st.season}/d${day}/l${lid}/${fi}`;
      const res = withRatings({ ...overlayFor(w, st, A), ...overlayFor(w, st, B) }, () => {
        const sa = lineupFor(w, st, A), sb = lineupFor(w, st, B);
        const r = simulateMatch(sa, sb, [A.name, B.name], seed, { knockout: false });
        return { r, sa, sb };
      });
      f.r = [res.r.score[0], res.r.score[1]];
      f.g = res.r.events.filter((e) => e.type === 'goal' && e.p).map((e) => e.p!);
      if (f.hum) humanMatches.push({ league: lid, a: f.a, b: f.b, result: res.r, squads: [res.sa, res.sb] });
      applyMatch(w, st, res.r, res.sa, res.sb, seed, played, pending);
    }
  }

  // time served: tick down only what was already running at kick-off, then add what happened today
  for (const id of servingSusp) { st.susp[id] = (st.susp[id] ?? 1) - 1; if ((st.susp[id] ?? 0) <= 0) delete st.susp[id]; }
  for (const id of servingInj) { const i = st.injuries[id]!; i.left--; if (i.left <= 0) delete st.injuries[id]; }
  for (const c of Object.values(st.clubs)) {
    for (const id of Object.keys(c.newcomers)) { const n = c.newcomers[id]!; n.left--; if (n.left <= 0) delete c.newcomers[id]; }
    if (c.sharp.left > 0) c.sharp.left--;
  }
  // new bans and injuries from today (stored on the shared maps after the time-served step above)
  for (const m of pending) {
    if (m.kind === 'susp') st.susp[m.id] = Math.max(st.susp[m.id] ?? 0, m.n);
    else if (!st.injuries[m.id]) st.injuries[m.id] = { left: m.n, kind: m.label };
    if (m.news) news(st, m.news);
  }

  st.lastDay = { season: st.season, day: day + 1, matches: humanMatches };
  st.day = day + 1;
  st.rev++;
  if (st.day === WINDOW_AFTER) openWindow(w, st, 'mid', now);
  else if (st.day >= DAYS) endSeason(w, st, now);
  else openMatchday(st, now);
}

interface Pending { kind: 'susp' | 'inj'; id: string; n: number; label: string; news?: Omit<News, 'season' | 'day'> }
function applyMatch(w: IndexedWorld, st: CareerState, r: MatchResult, sa: Squad, sb: Squad, seed: string, played: Set<string>, pending: Pending[]): void {
  const teams = [sa, sb];
  const clubOf = (pid: string): Club | undefined => st.clubs[st.owner[pid] ?? ''];
  for (const sq of teams) for (const id of Object.values(sq.slots)) {
    if (!id) continue;
    (st.stats[id] ??= emptyStats()).app++;
    played.add(id);
  }
  const rng = new Rng(`${seed}/health`);
  for (const e of r.events) {
    if (e.type === 'goal' && e.p) {
      (st.stats[e.p] ??= emptyStats()).g++;
      if (e.a) (st.stats[e.a] ??= emptyStats()).a++;
    } else if (e.type === 'yellow' && e.p) {
      (st.stats[e.p] ??= emptyStats()).y++;
      st.yel[e.p] = (st.yel[e.p] ?? 0) + 1;
      if ((st.yel[e.p] ?? 0) >= 5) {
        st.yel[e.p] = 0;
        pending.push({ kind: 'susp', id: e.p, n: 1, label: 'yellows', news: { kind: 'suspension', club: clubOf(e.p)?.id, player: e.p, n: 1 } });
      }
    } else if (e.type === 'red' && e.p) {
      (st.stats[e.p] ??= emptyStats()).r++;
      const n = 1 + (rng.chance(0.25) ? 1 : 0);
      pending.push({ kind: 'susp', id: e.p, n, label: 'red', news: { kind: 'red', club: clubOf(e.p)?.id, player: e.p, n } });
    }
  }
  for (const sq of teams) for (const id of Object.values(sq.slots)) {
    if (!id) continue;
    const age = ageOf(w, st, id);
    const p = INJURY_RATE * (age !== null && age >= 32 ? 1.4 : 1);
    if (!rng.chance(p)) continue;
    const roll = rng.next();
    const kind = INJURY_KINDS.find(([cut]) => roll < cut) ?? INJURY_KINDS[INJURY_KINDS.length - 1]!;
    const n = kind[1] + rng.int(kind[2] - kind[1] + 1);
    const c = clubOf(id);
    pending.push({ kind: 'inj', id, n, label: kind[3], news: c?.human ? { kind: 'injury', club: c.id, player: id, n, text: kind[3] } : undefined });
  }
}

/* ───────────── transfer windows ───────────── */

export function freePool(w: IndexedWorld, st: CareerState): WorldPlayer[] {
  const out: WorldPlayer[] = [];
  const seen = new Set<string>();
  for (const c of w.clubs) for (const p of w.byClub.get(c.id) ?? []) if (!seen.has(p.id)) { seen.add(p.id); if (!st.owner[p.id]) out.push(p); }
  return out;
}

function windowOrder(st: CareerState): string[] {
  const key = new Map<string, number>();
  // First League clubs by table position (worst first), then Second League clubs
  table(st, 1).forEach((r, i) => key.set(r.id, i));
  table(st, 2).forEach((r, i) => key.set(r.id, -100 + i));
  return Object.keys(st.clubs).sort((a, b) => (key.get(b) ?? 0) - (key.get(a) ?? 0));
}

function openWindow(w: IndexedWorld, st: CareerState, kind: WindowKind, now: number, order: string[] = windowOrder(st)): void {
  void w;
  const cfg = SWAPS[kind];
  st.window = { kind, order, free: cfg.free, max: cfg.max, deadline: now + st.settings.windowHours * 3_600_000, plans: {}, ready: {} };
  st.phase = 'window';
  st.deadline = null;
  news(st, { kind: 'window_open', text: kind });
  st.rev++;
}

export function windowPlan(w: IndexedWorld, st: CareerState, memberId: string, swaps: Swap[]): Result {
  if (st.phase !== 'window' || !st.window) return fail('phase', 'The transfer window is not open.');
  const m = st.members.find((x) => x.id === memberId);
  if (!m) return fail('member', 'You are not in this league.');
  const win = st.window;
  if (swaps.length > win.max) return fail('max', `You can change at most ${win.max} players in this window.`);
  const club = st.clubs[m.clubId]!;
  const roster = new Set(club.roster);
  const ins = new Set<string>();
  const outs = new Set<string>();
  for (const s of swaps) {
    if (!roster.has(s.out)) return fail('out', 'You can only release a player from your own squad.');
    if (outs.has(s.out)) return fail('dup', 'A player can only be released once.');
    if (!w.has(s.in) || st.owner[s.in]) return fail('in', 'That player is not available.');
    if (ins.has(s.in)) return fail('dup', 'A player can only be signed once.');
    outs.add(s.out); ins.add(s.in);
  }
  const after = [...club.roster.filter((id) => !outs.has(id)), ...ins];
  if (after.length !== ROSTER || !legalAfter(w, after)) return fail('squad', 'Your squad needs a balance: at least 2 keepers, 6 defenders, 6 midfielders and 3 forwards.');
  win.plans[memberId] = swaps.map((s) => ({ out: s.out, in: s.in }));
  win.ready[memberId] = false;
  st.rev++;
  return OK;
}

export function windowReady(w: IndexedWorld, st: CareerState, memberId: string, ready: boolean, now: number): Result {
  if (st.phase !== 'window' || !st.window) return fail('phase', 'The transfer window is not open.');
  if (!st.members.some((x) => x.id === memberId)) return fail('member', 'You are not in this league.');
  st.window.ready[memberId] = ready;
  st.rev++;
  tick(w, st, now);
  return OK;
}

/** Bots tidy up a little: swap in a clearly better free player for their weakest at the same position. */
function botSwaps(w: IndexedWorld, st: CareerState, club: Club, taken: Set<string>): Swap[] {
  const swaps: Swap[] = [];
  const free = freePool(w, st).filter((p) => !taken.has(p.id)).sort((a, b) => ovrOf(w, st, b.id) - ovrOf(w, st, a.id));
  const roster = [...club.roster].sort((a, b) => ovrOf(w, st, a) - ovrOf(w, st, b));
  for (const out of roster) {
    if (swaps.length >= 2) break;
    const line = lineOf(w.player(out).pos);
    const cand = free.find((p) => lineOf(p.pos) === line && !taken.has(p.id) && ovrOf(w, st, p.id) >= ovrOf(w, st, out) + 3);
    if (!cand) continue;
    const after = [...club.roster.filter((id) => id !== out && !swaps.some((s) => s.out === id)), ...swaps.map((s) => s.in), cand.id];
    if (after.length !== ROSTER || !legalAfter(w, after)) continue;
    swaps.push({ out, in: cand.id });
    taken.add(cand.id);
  }
  return swaps;
}

function closeWindow(w: IndexedWorld, st: CareerState, now: number): void {
  const win = st.window!;
  // the club lowest in the table gets first choice of contested free agents
  const order = win.order.map((id) => st.clubs[id]).filter((c): c is Club => !!c);
  const taken = new Set<string>();
  for (const club of order) {
    const m = club.human ? st.members.find((x) => x.id === club.human) : undefined;
    const plan = m ? win.plans[m.id] ?? [] : club.human ? [] : botSwaps(w, st, club, taken);
    let done = 0;
    for (const s of plan) {
      if (!club.roster.includes(s.out) || st.owner[s.in]) {
        if (club.human) news(st, { kind: 'swap_failed', club: club.id, player: s.in });
        continue;
      }
      const after = [...club.roster.filter((id) => id !== s.out), s.in];
      if (!legalAfter(w, after)) continue;
      club.roster = after;
      delete st.owner[s.out];
      st.owner[s.in] = club.id;
      for (const k of Object.keys(club.xi)) if (club.xi[k] === s.out) club.xi[k] = null;
      done++;
      if (club.human) {
        const heavy = done > win.free;
        club.newcomers[s.in] = { left: (heavy ? SETTLE.heavy : SETTLE.mild).matches, heavy };
        news(st, { kind: 'swap', club: club.id, player: s.in, other: s.out });
      }
    }
    if (club.human && done > win.free) {
      const extra = done - win.free;
      club.sharp = { left: SHARP.matches, hit: Math.min(SHARP.cap, SHARP.perExtraSwap * extra) };
    }
    if (club.human) autoFillXi(w, st, club);
  }
  news(st, { kind: 'window_done', text: win.kind });
  const kind = win.kind;
  st.window = null;
  st.rev++;
  if (kind === 'mid') {
    st.phase = 'play';
    openMatchday(st, now);
  } else {
    st.season++;
    beginSeason(w, st, now);
  }
}

/** After a transfer the manager's saved eleven may have holes: fill them from the squad. */
function autoFillXi(w: IndexedWorld, st: CareerState, club: Club): void {
  const sq = lineupFor(w, st, club);
  club.xi = { ...sq.slots };
}

/* ───────────── end of season ───────────── */

/** Develop a player for one more year. Known age matters; for unknown ages the change is gentler (we do not know which way it goes). */
export function develop(ovr: number, age: number | null, rng: Rng): number {
  const a = age ?? 26;
  let mu: number, sd: number;
  if (a <= 19) { mu = 2.2; sd = 1.6; }
  else if (a <= 21) { mu = 1.6; sd = 1.4; }
  else if (a <= 23) { mu = 0.8; sd = 1.2; }
  else if (a <= 27) { mu = 0.2; sd = 1.0; }
  else if (a <= 29) { mu = -0.2; sd = 1.0; }
  else if (a <= 31) { mu = -0.9; sd = 1.1; }
  else if (a <= 33) { mu = -1.8; sd = 1.3; }
  else { mu = -2.8; sd = 1.5; }
  if (age === null) { mu *= 0.4; sd *= 0.8; }
  return Math.min(90, Math.max(40, Math.round((ovr + mu + rng.normal() * sd) * 10) / 10));
}

function endSeason(w: IndexedWorld, st: CareerState, now: number): void {
  const t1 = table(st, 1), t2 = table(st, 2);
  const order = windowOrder(st);
  const humans: SeasonRecord['humans'] = {};
  for (const [lid, t] of [[1, t1], [2, t2]] as const) t.forEach((r, i) => { if (st.clubs[r.id]?.human) humans[r.id] = { league: lid, pos: i + 1 }; });
  const scorers = Object.entries(st.stats).map(([player, s]) => ({ player, goals: s.g })).sort((a, b) => b.goals - a.goals);
  const down = t1.slice(-2).map((r) => r.id);
  const up = t2.slice(0, 2).map((r) => r.id);
  st.history.push({ season: st.season, champion: { '1': t1[0]!.id, '2': t2[0]!.id }, promoted: up, relegated: down, topScorer: scorers[0] && scorers[0].goals > 0 ? scorers[0] : null, humans });
  news(st, { kind: 'champion', club: t1[0]!.id });
  for (const id of down) news(st, { kind: 'relegated', club: id });
  for (const id of up) news(st, { kind: 'promoted', club: id });
  // promotion and relegation
  const L1 = st.leagues['1'], L2 = st.leagues['2'];
  L1.clubs = [...L1.clubs.filter((id) => !down.includes(id)), ...up];
  L2.clubs = [...L2.clubs.filter((id) => !up.includes(id)), ...down];
  for (const id of up) st.clubs[id]!.league = 1;
  for (const id of down) st.clubs[id]!.league = 2;
  // everyone is a year older; ratings move with age
  const rng = new Rng(`${st.seed}/s${st.season}/develop`);
  const everyone = new Set<string>([...Object.keys(st.owner), ...freePool(w, st).map((p) => p.id)]);
  for (const id of [...everyone].sort()) {
    const age = ageOf(w, st, id);
    st.ratings[id] = develop(ovrOf(w, st, id), age, rng);
    if (age !== null) st.ages[id] = age + 1;
  }
  // the summer heals most things
  st.injuries = {};
  st.susp = {};
  st.yel = {};
  for (const c of Object.values(st.clubs)) { c.newcomers = {}; c.sharp = { left: 0, hit: 0 }; if (!c.human) autoFormation(w, st, c); }
  st.lastDay = null;
  openWindow(w, st, 'end', now, order);
}

/* ───────────── what a manager sees ───────────── */

export interface CareerView {
  rev: number;
  code: string;
  phase: Phase;
  season: number;
  day: number;
  deadline: number | null;
  settings: CareerState['settings'];
  me: { memberId: string; clubId: string; ready: boolean; auto: boolean } | null;
  members: Array<{ id: string; name: string; clubId: string; ready: boolean; auto: boolean }>;
  clubs: Record<string, { id: string; name: string; badge: Badge; league: 1 | 2; real: boolean; human: string | null }>;
  leagues: Record<'1' | '2', { clubs: string[]; table: Row[]; next: Fixture[]; last: Fixture[] }>;
  mine: null | {
    roster: string[]; formation: FormationId; style: StyleId; xi: Record<string, string | null>;
    newcomers: Club['newcomers']; sharp: Club['sharp'];
  };
  draft: null | { order: string[]; i: number; deadline: number | null; onClock: string | null; picks: Array<[string, string]>; available: string[] };
  window: null | { kind: WindowKind; free: number; max: number; deadline: number | null; plan: Swap[]; ready: boolean; others: Record<string, boolean>; pool: string[] };
  injuries: Record<string, { left: number; kind: string }>;
  susp: Record<string, number>;
  yel: Record<string, number>;
  /** this season: best scorers, and the stats of the viewer's own players */
  scorers: Array<{ player: string; club: string; goals: number }>;
  stats: Record<string, PlayerStats>;
  ratings: Record<string, number>;
  ages: Record<string, number>;
  lastMatches: Array<{ league: 1 | 2; a: string; b: string }>;
  history: SeasonRecord[];
  news: News[];
}

export function viewFor(w: IndexedWorld, st: CareerState, memberId: string | null): CareerView {
  const m = memberId ? st.members.find((x) => x.id === memberId) ?? null : null;
  const mine = m ? st.clubs[m.clubId]! : null;
  const day = st.day;
  const leagueView = (id: 1 | 2) => {
    const L = st.leagues[lg(id)];
    return { clubs: L.clubs, table: table(st, id), next: st.phase === 'play' ? L.days[day] ?? [] : [], last: day > 0 ? L.days[day - 1] ?? [] : [] };
  };
  const clubs: CareerView['clubs'] = {};
  for (const c of Object.values(st.clubs)) clubs[c.id] = { id: c.id, name: c.name, badge: c.badge, league: c.league, real: c.real, human: c.human };
  const d = st.draft;
  return {
    rev: st.rev, code: st.code, phase: st.phase, season: st.season, day, deadline: st.deadline, settings: st.settings,
    me: m && mine ? { memberId: m.id, clubId: mine.id, ready: mine.ready, auto: m.auto } : null,
    members: st.members.map((x) => ({ ...x, ready: st.clubs[x.clubId]!.ready })),
    clubs,
    leagues: { '1': leagueView(1), '2': leagueView(2) },
    mine: mine ? { roster: mine.roster, formation: mine.formation, style: mine.style, xi: mine.xi, newcomers: mine.newcomers, sharp: mine.sharp } : null,
    draft: d ? { order: d.order, i: d.i, deadline: d.deadline, onClock: d.order[d.i] ?? null, picks: d.picks, available: draftPool(w, st).map((p) => p.id) } : null,
    window: st.window && st.phase === 'window' ? {
      kind: st.window.kind, free: st.window.free, max: st.window.max, deadline: st.window.deadline,
      plan: m ? st.window.plans[m.id] ?? [] : [], ready: m ? !!st.window.ready[m.id] : false,
      others: Object.fromEntries(st.members.map((x) => [x.id, !!st.window!.ready[x.id]])),
      pool: freePool(w, st).map((p) => p.id),
    } : null,
    injuries: st.injuries, susp: st.susp, yel: st.yel,
    scorers: Object.entries(st.stats).filter(([, x]) => x.g > 0).map(([player, x]) => ({ player, club: st.owner[player] ?? '', goals: x.g })).sort((a, b) => b.goals - a.goals).slice(0, 10),
    stats: mine ? Object.fromEntries(mine.roster.map((id) => [id, st.stats[id] ?? emptyStats()])) : {},
    ratings: st.ratings, ages: st.ages,
    lastMatches: (st.lastDay?.matches ?? []).map((x) => ({ league: x.league, a: x.a, b: x.b })),
    history: st.history,
    news: st.news.slice(-60),
  };
}

/** The story of the human matches played on the last matchday (for the watch screen). */
export function lastMatch(st: CareerState, memberId: string): HumanMatch | null {
  const m = st.members.find((x) => x.id === memberId);
  if (!m || !st.lastDay) return null;
  return st.lastDay.matches.find((x) => x.a === m.clubId || x.b === m.clubId) ?? null;
}

