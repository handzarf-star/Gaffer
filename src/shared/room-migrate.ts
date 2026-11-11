// Saved-state pipeline for a room (RoomState). See migrate.ts for the contract.
//
// Rooms are short-lived (a draft and a match), so the first version of this file only has to be safe, not clever:
//   v2 is the oldest shape we can read; a v1 room is dropped by the caller (the code frees up), a room from a NEWER build is
//   left untouched, and every room goes through normalise(), so a setting or table added later never reaches the
//   engine as `undefined` on a room that was saved before it existed.
//   v3 (League Night): `settings.pool` became the list `settings.pools`; seats gained a club and a badge; the room gained the
//   transfer window, the account binding and the pace settings. steps[2] renames the pool; normalise() defaults the rest.
// When RoomState changes shape: bump `current`, add `steps[<old>]`, extend normalise(), add a frozen fixture to tests/fixtures.

import { DEFAULT_SETTINGS, LIMIT_HOURS, MAX_SEATS, ROOM_CODE_RE, type DayState, type DraftState, type HubState, type Phase, type RoomState, type Seat, type Series, type Settings, type Signing, type WindowState } from './protocol';
import { validBadge } from './career/world';
import { POOLS } from './pools';
import { FORMATION_IDS } from './formations';
import { bool, boolMap, int, isRec, list, loadState, num, numOrNull, oneOf, rec, str, strMap, strs, unplayable, type Loaded, type Pipeline } from './migrate';
import type { CompState } from './competition';
import type { Squad } from './squad';

const PHASES: readonly Phase[] = ['lobby', 'draft', 'setup', 'match', 'hub', 'window', 'result'];

/** Known keys only, and only when the saved value has the same kind as the default. A key that did not exist yet takes its default. */
function settings(raw: unknown): Settings {
  const saved = rec(raw);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS, eras: [] };
  for (const [k, dflt] of Object.entries(DEFAULT_SETTINGS)) {
    const v = saved[k];
    if (Array.isArray(dflt)) { if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string'); }
    else if (typeof v === typeof dflt && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  const st = out as unknown as Settings;
  st.pools = st.pools.filter((x) => x in POOLS);
  if (st.pools.length === 0) st.pools = DEFAULT_SETTINGS.pools.slice();
  st.nations = st.nations.filter((x) => /^[A-Z]{3}$/.test(x));
  if (st.gate !== 'live' && st.gate !== 'limit') st.gate = DEFAULT_SETTINGS.gate;
  if (!(LIMIT_HOURS as readonly number[]).includes(st.limitHours)) st.limitHours = DEFAULT_SETTINGS.limitHours;
  if (st.steals !== 0 && st.steals !== 1 && st.steals !== 2) st.steals = DEFAULT_SETTINGS.steals;
  return st;
}

function seat(o: Record<string, unknown>): Seat | null {
  if (typeof o.id !== 'string' || !o.id) return null;
  const out: Seat = {
    id: o.id, name: str(o.name, 'Player'), hue: int(o.hue, 0), connected: bool(o.connected), droppedAt: num(o.droppedAt, 0),
    formation: oneOf(o.formation, FORMATION_IDS, '433'), bot: bool(o.bot),
  };
  // a seat from before clubs existed has none: the game then shows the manager's name
  if (typeof o.club === 'string' && o.club) out.club = o.club;
  if (validBadge(o.badge)) out.badge = o.badge;
  return out;
}

const signings = (x: unknown): Signing[] =>
  list(x, (o) => (typeof o.team === 'string' && typeof o.in === 'string' && typeof o.out === 'string' ? { team: o.team, in: o.in, out: o.out } : null));

function windowOf(x: unknown): WindowState | null {
  if (!isRec(x) || !isRec(x.seats)) return null;
  const order = strs(x.order).filter((id) => isRec((x.seats as Record<string, unknown>)[id]));
  const seats: WindowState['seats'] = {};
  for (const id of order) {
    const o = (x.seats as Record<string, Record<string, unknown>>)[id]!;
    const sg = signings([o.signed])[0] ?? null;
    seats[id] = { stage: oneOf(o.stage, ['choose', 'open', 'done'] as const, 'done'), board: strs(o.board), others: Array.isArray(o.others) ? o.others.map(strs) : [], signed: sg };
  }
  return { order, turn: Math.max(-1, int(x.turn, -1)), deadline: numOrNull(x.deadline), seats, signings: signings(x.signings) };
}

function draft(x: unknown): DraftState | null {
  if (!isRec(x)) return null;
  const boards: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rec(x.boards))) boards[k] = strs(v);
  const d: Record<string, unknown> = {
    ...x,
    round: int(x.round, 0), deadline: numOrNull(x.deadline), shared: bool(x.shared), board: strs(x.board), boards,
    order: strs(x.order), turn: int(x.turn, 0), picked: strs(x.picked), taken: strs(x.taken),
    log: list(x.log, (e) => (typeof e.seat === 'string' && typeof e.player === 'string' ? { round: int(e.round, 0), seat: e.seat, player: e.player, auto: bool(e.auto) } : null)),
  };
  if (x.turns !== undefined) d.turns = bool(x.turns);
  // a spotlight draft that lost its working data cannot be continued: without it the older formats' rules would silently take over
  if (x.spot !== undefined && !(isRec(x.spot) && Array.isArray(x.spot.queue) && Array.isArray(x.spot.packs))) unplayable('spotlight draft');
  return d as unknown as DraftState;
}

function squads(x: unknown): Record<string, Squad> {
  const out: Record<string, Squad> = {};
  for (const [k, v] of Object.entries(rec(x))) if (isRec(v) && isRec(v.slots)) out[k] = v as unknown as Squad;
  return out;
}

function comp(x: unknown): CompState | null {
  return isRec(x) && Array.isArray(x.teams) && Array.isArray(x.days) ? (x as unknown as CompState) : null;
}

export function normaliseRoom(s: Record<string, unknown>): RoomState {
  if (typeof s.code !== 'string' || !ROOM_CODE_RE.test(s.code)) unplayable('room code');
  const phase = oneOf(s.phase, PHASES, 'lobby');
  if (s.phase !== phase) unplayable('phase');
  const seats = list(s.seats, seat).slice(0, MAX_SEATS + 16);
  const setup = isRec(s.setup) ? { deadline: num(s.setup.deadline, 0), ready: boolMap(s.setup.ready) } : null;
  const day: DayState | null = isRec(s.day) ? { startedAt: num(s.day.startedAt, 0), seen: boolMap(s.day.seen), deadline: num(s.day.deadline, 0) } : null;
  const hub: HubState | null = isRec(s.hub)
    ? { deadline: num(s.hub.deadline, 0), ready: boolMap(s.hub.ready), played: Array.isArray(s.hub.played) ? s.hub.played.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [] }
    : null;
  const sr = rec(s.series);
  const series: Series = {
    wins: Object.fromEntries(Object.entries(rec(sr.wins)).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>,
    games: int(sr.games, 0),
    log: list(sr.log, (e) => ({ game: int(e.game, 0), winner: typeof e.winner === 'string' ? e.winner : null, summary: str(e.summary) })),
  };
  const window = windowOf(s.window);
  if (phase === 'window' && !window) unplayable('transfer window');
  const out: RoomState = {
    v: 3,
    code: s.code as string,
    rev: int(s.rev, 0),
    createdAt: num(s.createdAt, 0),
    lastActive: num(s.lastActive, num(s.createdAt, 0)),
    phase,
    pausedAt: numOrNull(s.pausedAt),
    hostId: str(s.hostId),
    settings: settings(s.settings),
    seats,
    secrets: strMap(s.secrets),
    game: int(s.game, 0),
    seed: str(s.seed),
    draft: draft(s.draft),
    squads: squads(s.squads),
    setup,
    comp: comp(s.comp),
    day,
    hub,
    series,
    rematch: boolMap(s.rematch),
    window,
    windowDone: bool(s.windowDone),
    lastWindow: signings(s.lastWindow),
    accounts: strMap(s.accounts),
  };
  return out;
}

/** v2 -> v3: one pool became a list of pools. Everything else v3 added has a default in normalise(). */
function v2to3(old: Record<string, unknown>): Record<string, unknown> {
  const st = { ...rec(old.settings) };
  if (!Array.isArray(st.pools)) st.pools = typeof st.pool === 'string' ? [st.pool] : ['modern'];
  delete st.pool;
  // a room saved before the transfer window existed carries on as it was started: without one
  if (typeof st.window !== 'boolean') st.window = false;
  return { ...old, settings: st };
}

export const roomPipeline: Pipeline<RoomState> = { current: 3, oldest: 2, steps: { 2: v2to3 }, normalise: normaliseRoom };

export const loadRoom = (raw: unknown): Loaded<RoomState> => loadState(roomPipeline, raw);
