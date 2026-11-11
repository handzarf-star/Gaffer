import type { BotLevel } from './bots';
import type { Badge } from './career/world';
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

export type Phase = 'lobby' | 'draft' | 'setup' | 'match' | 'hub' | 'window' | 'result';

/** How a league moves on: everybody together with short timers, or each stage with a time limit so it can run over days. */
export type Gate = 'live' | 'limit';
export const LIMIT_HOURS = [12, 24, 48] as const;

export interface Settings {
  format: DraftFormat;
  /** which pools the draft takes its players from; several can be on */
  pools: PoolId[];
  /** countries the players may come from; empty means all of them */
  nations: string[];
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
  /** spotlight draft: how many times each manager may take a card out of a rival's opened pack */
  steals: 0 | 1 | 2;
  gate: Gate;
  /** on `limit`: how long each stage (line-ups, a matchday, the transfer window) may take */
  limitHours: (typeof LIMIT_HOURS)[number];
  /** leagues: a transfer window at half-season, one pack each, bottom of the table first */
  window: boolean;
}

/** What a new room starts with: League Night. */
export const DEFAULT_SETTINGS: Settings = {
  format: 'spotlight', pools: ['bl'], nations: [], eras: [], ratings: 'full', pickSeconds: 25,
  competition: 'league', teams: 8, botLevel: 'normal', pace: 'quick', legs: 1, steals: 1, gate: 'live', limitHours: 24, window: true,
};
/** The defaults the game had before League Night (a Duel draft for one match between two). The older draft styles are tested from here. */
export const CLASSIC_SETTINGS: Partial<Settings> = { format: 'duel', pools: ['modern'], ratings: 'tier', competition: 'match', window: false };
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
  /** the club this manager runs (a CPU team's `name` is already a club name). Tables, scoreboards and commentary use it. */
  club?: string;
  badge?: Badge;
}

/** The name of a seat's team: its club, or the manager's name for a seat from before clubs existed. */
export const teamName = (seat: Pick<Seat, 'name' | 'club'> | undefined): string => seat?.club || seat?.name || '???';

export interface DraftLogEntry {
  round: number;
  seat: string;
  player: string;
  auto: boolean;
  /** stolen out of this seat's opened pack */
  from?: string;
}

/** What the manager on the clock did not get: the rest of the pack they opened, and the two packs they left sealed. */
export interface Missed {
  seat: string;
  round: number;
  picked: string | null;
  left: string[];
  others: string[][];
}

/** Spotlight draft: one manager at a time, three packs that look the same, everybody watches. */
export interface SpotState {
  /** every pick of the draft in order (seat ids, snake by round) */
  queue: string[];
  i: number;
  stage: 'choose' | 'open';
  /** the three sealed packs of the manager on the clock. Server only: nobody is told what is in a sealed pack. */
  packs: string[][];
  opened: number | null;
  /** rivals may steal from the opened pack until this moment; the manager on the clock picks after it */
  stealUntil: number | null;
  stolen: { by: string; card: string } | null;
  /** steals each manager has left */
  steals: Record<string, number>;
  /** turns a manager will skip because a steal already filled them */
  owed: Record<string, number>;
  missed: Missed | null;
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
  spot?: SpotState;
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
  /** the season is over; the result waits here until every manager has watched their last match (or the time limit) */
  final?: boolean;
}

export interface Signing { team: string; in: string; out: string }

export interface WindowSeat {
  stage: 'choose' | 'open' | 'done';
  /** the pack this manager opened, for everyone to see on `live` */
  board: string[];
  /** the two packs they left sealed, shown once they have opened one */
  others: string[][];
  signed: Signing | null;
}

/** The mid-season transfer window: one pack each, bottom of the table first. */
export interface WindowState {
  /** human team ids, bottom of the table first */
  order: string[];
  /** `live`: index into `order` of the manager on the clock. `limit`: -1, everyone opens their pack in their own time. */
  turn: number;
  deadline: number | null;
  seats: Record<string, WindowSeat>;
  /** every completed signing, managers first, then CPU teams */
  signings: Signing[];
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
  v: 3;
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
  window: WindowState | null;
  /** this league's transfer window has been and gone */
  windowDone: boolean;
  /** what the last window changed, for the table screen after it */
  lastWindow: Signing[];
  /** seat id -> account id. Server only: it lets a signed-in visitor reclaim their seat without the stored seat secret. */
  accounts: Record<string, string>;
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
  /** spotlight draft */
  spot?: {
    /** the manager on the clock */
    seat: string;
    stage: 'choose' | 'open';
    /** how many identical sealed packs they are looking at (their contents are never sent) */
    packs: number;
    opened: number | null;
    stealUntil: number | null;
    stolen: { by: string; card: string } | null;
    steals: Record<string, number>;
    owed: Record<string, number>;
    /** may the viewer steal from the pack that is open right now? */
    canSteal: boolean;
    missed: Missed | null;
    /** picks made and picks in the whole draft, for the progress bar */
    done: number;
    total: number;
  };
}

export interface WindowView {
  order: string[];
  turn: number;
  deadline: number | null;
  /** per manager: where they are, and what they opened (on `live` everyone sees it; on `limit` only once they are done) */
  seats: Record<string, WindowSeat>;
  signings: Signing[];
  /** may the viewer act now? */
  yourMove: boolean;
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
  window: WindowView | null;
  lastWindow: Signing[];
  /** a played match of yours that you have not watched yet (outside a live matchday): which day and fixture of `comp` */
  replay: { day: number; fixture: string } | null;
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
  | { t: 'emote'; e: string }
  | { t: 'club'; name: string; badge?: Badge }
  | { t: 'steal'; round: number; card: string }
  /** transfer window: sign `card` into `slot` (the player there is released), or `card: null` to keep the squad */
  | { t: 'sign'; card: string | null; slot?: string };

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
