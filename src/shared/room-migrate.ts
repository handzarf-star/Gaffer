// Saved-state pipeline for a room (RoomState). See migrate.ts for the contract.
//
// Rooms are short-lived (a draft and a match), so the first version of this file only has to be safe, not clever:
//   v2 is the oldest shape we can read; a v1 room is dropped by the caller (the code frees up), a room from a NEWER build is
//   left untouched, and every v2 room goes through normalise(), so a setting or table added later never reaches the
//   engine as `undefined` on a room that was saved before it existed.
// When RoomState changes shape: bump `current`, add `steps[<old>]`, extend normalise(), add a frozen fixture to tests/fixtures.

import { DEFAULT_SETTINGS, MAX_SEATS, ROOM_CODE_RE, type DayState, type DraftState, type HubState, type Phase, type RoomState, type Seat, type Series, type Settings } from './protocol';
import { FORMATION_IDS } from './formations';
import { bool, boolMap, int, isRec, list, loadState, num, numOrNull, oneOf, rec, str, strMap, strs, unplayable, type Loaded, type Pipeline } from './migrate';
import type { CompState } from './competition';
import type { Squad } from './squad';

const PHASES: readonly Phase[] = ['lobby', 'draft', 'setup', 'match', 'hub', 'result'];

/** Known keys only, and only when the saved value has the same kind as the default. A key that did not exist yet takes its default. */
function settings(raw: unknown): Settings {
  const saved = rec(raw);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS, eras: [] };
  for (const [k, dflt] of Object.entries(DEFAULT_SETTINGS)) {
    const v = saved[k];
    if (Array.isArray(dflt)) { if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string'); }
    else if (typeof v === typeof dflt && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  return out as unknown as Settings;
}

function seat(o: Record<string, unknown>): Seat | null {
  if (typeof o.id !== 'string' || !o.id) return null;
  return {
    id: o.id, name: str(o.name, 'Player'), hue: int(o.hue, 0), connected: bool(o.connected), droppedAt: num(o.droppedAt, 0),
    formation: oneOf(o.formation, FORMATION_IDS, '433'), bot: bool(o.bot),
  };
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
  const out: RoomState = {
    v: 2,
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
  };
  return out;
}

export const roomPipeline: Pipeline<RoomState> = { current: 2, oldest: 2, steps: {}, normalise: normaliseRoom };

export const loadRoom = (raw: unknown): Loaded<RoomState> => loadState(roomPipeline, raw);
