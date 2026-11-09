import type { DraftFormat, RatingsMode } from './draft';
import type { FormationId } from './formations';
import type { PoolId } from './players';
import type { MatchResult } from './sim';
import type { Squad, StyleId } from './squad';

export const MAX_SEATS = 4;
export const MIN_SEATS = 2;
export const ROOM_CODE_RE = /^[A-HJ-NP-Z]{4}$/;

export type Phase = 'lobby' | 'draft' | 'setup' | 'match' | 'result';

export interface Settings {
  format: DraftFormat;
  pool: PoolId;
  ratings: RatingsMode;
  /** seconds per pick; 0 = no timer */
  pickSeconds: 0 | 15 | 25 | 40;
}

export const DEFAULT_SETTINGS: Settings = { format: 'duel', pool: 'modern', ratings: 'tier', pickSeconds: 25 };
export const PICK_SECONDS = [0, 15, 25, 40] as const;

export const SEAT_HUES = ['#ff5a3c', '#2f6bff', '#10a56a', '#a855f7'] as const;

export interface Seat {
  id: string;
  name: string;
  hue: number;
  connected: boolean;
  /** ms epoch when the seat last lost its connection (0 while connected) */
  droppedAt: number;
  formation: FormationId;
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
  board: string[];
  boards: Record<string, string[]>;
  order: string[];
  turn: number;
  picked: string[];
  taken: string[];
  log: DraftLogEntry[];
}

export interface Fixture {
  a: string;
  b: string;
  names: [string, string];
  result: MatchResult;
}

export interface MatchPhase {
  startedAt: number;
  knockout: boolean;
  fixtures: Fixture[];
  seen: Record<string, boolean>;
  deadline: number;
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
  v: 1;
  code: string;
  rev: number;
  createdAt: number;
  lastActive: number;
  phase: Phase;
  hostId: string;
  settings: Settings;
  seats: Seat[];
  secrets: Record<string, string>;
  game: number;
  seed: string;
  draft: DraftState | null;
  squads: Record<string, Squad>;
  setup: { deadline: number; ready: Record<string, boolean> } | null;
  match: MatchPhase | null;
  series: Series;
  rematch: Record<string, boolean>;
}

/* ───────────── what a client is allowed to see ───────────── */

export interface DraftView {
  round: number;
  deadline: number | null;
  shared: boolean;
  /** duel: the shared board. packs: your own pack. */
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
  /** full squads you may see (yours always; everyone's once the match starts) */
  squads: Record<string, Squad>;
  setup: { deadline: number; ready: Record<string, boolean> } | null;
  match: MatchPhase | null;
  series: Series;
  rematch: Record<string, boolean>;
}

/* ───────────── wire messages ───────────── */

export type C2S =
  | { t: 'hello'; code: string; id?: string; secret?: string; name: string }
  | { t: 'name'; name: string }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'formation'; formation: FormationId }
  | { t: 'start' }
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
  | 'rate_limited'
  | 'kicked';

export type S2C =
  | { t: 'welcome'; id: string; secret: string; now: number }
  | { t: 'state'; s: RoomView; now: number }
  | { t: 'err'; code: ErrorCode; msg: string }
  | { t: 'fatal'; code: ErrorCode; msg: string }
  | { t: 'emote'; from: string; e: string };

export const EMOTES = ['🔥', '😂', '😭', '👏', '🤝', '💀', '🐐', '🫡'] as const;

export function seatName(v: { seats: Seat[] }, id: string): string {
  return v.seats.find((s) => s.id === id)?.name ?? '???';
}
