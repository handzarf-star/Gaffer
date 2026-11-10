import type { BotLevel } from './bots';
import type { CompetitionKind, CompState } from './competition';
import type { DraftFormat, RatingsMode } from './draft';
import type { PackClue, PackOffer } from './packs';
import type { FormationId } from './formations';
import type { EraId, PoolId } from './pools';
import type { Pace } from './sim';
import type { Squad, StyleId } from './squad';

/** Humans per room. CPU teams are extra. */
export const MAX_SEATS = 4;
export const MIN_SEATS = 1;
export const MAX_TEAMS = 16;
export const ROOM_CODE_RE = /^[A-HJ-NP-Z]{4}$/;

export type Phase = 'lobby' | 'draft' | 'setup' | 'match' | 'hub' | 'result';

export interface Settings {
  format: DraftFormat;
  pool: PoolId;
  /** which eras of the pool to draft from; empty means all of them */
  eras: EraId[];
  ratings: RatingsMode;
  /** seconds per pick; 0 = no timer */
  pickSeconds: 0 | 15 | 25 | 40;
  competition: CompetitionKind;
  /** total teams including CPU teams */
  teams: number;
  botLevel: BotLevel;
  /** playback speed of live matches */
  pace: Pace;
  /** league only: play everyone once or twice */
  legs: 1 | 2;
}

export const DEFAULT_SETTINGS: Settings = {
  format: 'duel', pool: 'modern', eras: [], ratings: 'tier', pickSeconds: 25,
  competition: 'match', teams: 2, botLevel: 'normal', pace: 'normal', legs: 1,
};
export const PICK_SECONDS = [0, 15, 25, 40] as const;

export const SEAT_HUES = ['#ff5a3c', '#2f6bff', '#10a56a', '#a855f7'] as const;
/** colours for CPU teams, distinct from the human seat colours */
export const BOT_HUES = ['#64748b', '#0ea5a4', '#d97706', '#be185d', '#4d7c0f', '#7c3aed', '#0369a1', '#b45309'] as const;

export interface Seat {
  id: string;
  name: string;
  hue: number;
  connected: boolean;
  /** ms epoch when the seat last lost its connection (0 while connected) */
  droppedAt: number;
  formation: FormationId;
  /** a CPU team */
  bot: boolean;
}

export interface DraftLogEntry {
  round: number;
  seat: string;
  player: string;
  auto: boolean;
}

export interface DraftState {
  round: number;
  deadline: number | null;
  shared: boolean;
  /** Take-turns format: one human drafts all their rounds while the others watch; order[turn] is who is up. */
  turns?: boolean;
  board: string[];
  /** per seat: the cards of the pack they opened this round (empty until they open one) */
  boards: Record<string, string[]>;
  /** per seat: the three sealed packs on offer this round. Server only: until a pack is opened nobody sees what is in it. */
  offers?: Record<string, PackOffer[]>;
  /** per seat: which pack they opened this round */
  opened?: Record<string, number>;
  order: string[];
  turn: number;
  picked: string[];
  taken: string[];
  log: DraftLogEntry[];
}

/** The matchday that is being watched right now. */
export interface DayState {
  startedAt: number;
  /** humans who have finished with this matchday (humans without a fixture start as done) */
  seen: Record<string, boolean>;
  deadline: number;
}

/** Between matchdays: standings, results, tweak your lineup, then everyone is ready. */
export interface HubState {
  deadline: number;
  ready: Record<string, boolean>;
  /** indexes into comp.days that were played since the last hub (includes CPU-only rounds skipped over) */
  played: number[];
}

export interface SeriesEntry {
  game: number;
  winner: string | null;
  summary: string;
}

export interface Series {
  wins: Record<string, number>;
  games: number;
  log: SeriesEntry[];
}

/** Server-side truth. Never sent to clients as-is. */
export interface RoomState {
  v: 2;
  code: string;
  rev: number;
  createdAt: number;
  lastActive: number;
  phase: Phase;
  /** Set while a game is running and no human is connected: every timer is frozen until someone comes back. */
  pausedAt?: number | null;
  hostId: string;
  settings: Settings;
  seats: Seat[];
  secrets: Record<string, string>;
  game: number;
  seed: string;
  draft: DraftState | null;
  squads: Record<string, Squad>;
  setup: { deadline: number; ready: Record<string, boolean> } | null;
  comp: CompState | null;
  day: DayState | null;
  hub: HubState | null;
  series: Series;
  rematch: Record<string, boolean>;
}

/* ───────────── what a client is allowed to see ───────────── */

export interface DraftView {
  round: number;
  deadline: number | null;
  shared: boolean;
  turns?: boolean;
  /** the clues on the three sealed packs of whoever is choosing (never their contents) */
  packs?: PackClue[];
  /** which of those packs has been opened, if any */
  opened?: number | null;
  /** duel: the shared board. packs: your own pack. turns: the pack of whoever is up, for everyone to watch. */
  board: string[];
  order: string[];
  turn: number;
  picked: string[];
  log: DraftLogEntry[];
}

export interface RoomView {
  code: string;
  rev: number;
  now: number;
  you: string;
  phase: Phase;
  game: number;
  hostId: string;
  settings: Settings;
  seats: Seat[];
  draft: DraftView | null;
  /** drafted players per seat, always public */
  rosters: Record<string, string[]>;
  /** full squads you may see (yours always; everyone's once matches start) */
  squads: Record<string, Squad>;
  setup: { deadline: number; ready: Record<string, boolean> } | null;
  comp: CompState | null;
  day: DayState | null;
  hub: HubState | null;
  series: Series;
  rematch: Record<string, boolean>;
}

/* ───────────── wire messages ───────────── */

export type C2S =
  | { t: 'hello'; code: string; id?: string; secret?: string; name: string; /** the build of the app the client is running */ build?: string }
  | { t: 'name'; name: string }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'formation'; formation: FormationId }
  | { t: 'start' }
  | { t: 'pack'; round: number; index: number }
  | { t: 'pick'; round: number; card: string; slot: string }
  | { t: 'swap'; a: string; b: string }
  | { t: 'arrange' }
  | { t: 'style'; style: StyleId }
  | { t: 'ready'; ready: boolean }
  | { t: 'seen' }
  | { t: 'rematch'; want: boolean }
  | { t: 'lobby' }
  | { t: 'kick'; id: string }
  | { t: 'emote'; e: string };

export type ErrorCode =
  | 'bad_message'
  | 'no_room'
  | 'room_full'
  | 'in_progress'
  | 'bad_secret'
  | 'not_host'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'stale_round'
  | 'bad_card'
  | 'bad_slot'
  | 'need_players'
  | 'bad_settings'
  | 'rate_limited'
  | 'internal'
  | 'kicked';

export type S2C =
  | { t: 'welcome'; id: string; secret: string; now: number; /** the build the server is serving: a different one means the client is out of date */ build?: string }
  | { t: 'state'; s: RoomView; now: number }
  | { t: 'err'; code: ErrorCode; msg: string }
  | { t: 'fatal'; code: ErrorCode; msg: string }
  | { t: 'emote'; from: string; e: string };

export const EMOTES = ['🔥', '😂', '😭', '👏', '🤝', '💀', '🐐', '🫡'] as const;

export function seatName(v: { seats: Seat[] }, id: string): string {
  return v.seats.find((s) => s.id === id)?.name ?? '???';
}
