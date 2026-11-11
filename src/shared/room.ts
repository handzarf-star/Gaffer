// The whole multiplayer game as a pure state machine with an injected clock.
// The Cloudflare Durable Object and the Node dev server are thin adapters around this class,
// so every rule (turns, timers, AFK, reconnect, tournaments, CPU teams) is unit-testable without any network.

import { BOT_LEVELS, botNames, buildBotSquad } from './bots';
import { defaultBadge, validBadge } from './career/world';
import { COMPETITIONS, completeDay, createCompetition, defaultTeams, litefy, tables, validTeams, type CompState, type CompetitionKind, type Matchday } from './competition';
import { ROUNDS, autoPick, boardSize, dealBoard, openRoles, placePlayer, suggestSlot } from './draft';
import { FORMATIONS, FORMATION_IDS, effectiveOvr, type FormationId, type Role } from './formations';
import { PACKS_PER_ROUND, dealPacks } from './packs';
import { ERAS, POOLS, poolHasStars, poolHealth, poolKey, type EraId, type PoolId, type PoolKey } from './pools';
import { Rng, hashSeed, randomSeed, randomToken } from './rng';
import { playbackSchedule, simulateMatch } from './sim';
import { STYLES, autoArrange, changeFormation, emptySquad, swapSlots } from './squad';
import {
  DEFAULT_SETTINGS,
  LIMIT_HOURS,
  MAX_SEATS,
  PICK_SECONDS,
  SEAT_HUES,
  teamName,
  type C2S,
  type DraftState,
  type ErrorCode,
  type RoomState,
  type RoomView,
  type Seat,
  type Settings,
  type WindowSeat,
  type WindowView,
} from './protocol';

/** Picks that arrive this late after the timer still count (network latency). */
export const GRACE_MS = 700;
/** A dropped player gets this long to come back before the room auto-picks for them. */
export const AFK_GRACE_MS = 8000;
export const SETUP_SECONDS = 75;
/** Time to read the table and tweak a lineup between matchdays before the next one starts anyway. */
export const HUB_SECONDS = 120;
/**
 * A human who drops out of a lineup, match or table screen holds the others up for this long before the room carries on
 * without them. Locking a phone or switching apps kills the socket, so zero grace would skip their match.
 */
export const DROP_GRACE_MS = 45_000;
export const HOST_MIGRATE_MS = 20_000;
export const LOBBY_GHOST_MS = 120_000;
/** Nobody connected for this long: the room is garbage. */
export const ROOM_ABANDONED_MS = 45 * 60_000;
/** Hard cap on room lifetime regardless of activity. */
export const ROOM_MAX_AGE_MS = 12 * 3600_000;
/** A league on a time limit is meant to be left alone for days. */
export const SLOW_ABANDONED_MS = 14 * 86_400_000;
export const SLOW_MAX_AGE_MS = 60 * 86_400_000;
/** Spotlight draft: how long rivals have to steal from a pack that has just been opened. */
export const STEAL_MS = 3500;
/** Transfer window, played live: how long each manager has for their pack. */
export const WINDOW_SECONDS = 45;

export interface Deps {
  seed: () => string;
  token: () => string;
}
export const defaultDeps: Deps = { seed: randomSeed, token: randomToken };

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode; msg: string };
const fail = (code: ErrorCode, msg: string): { ok: false; code: ErrorCode; msg: string } => ({ ok: false, code, msg });
const OK = { ok: true } as const;

const CLUB_OK = /^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,22}[\p{L}\p{N}.]$/u;
/** A club name a manager typed: 2 to 24 letters, numbers, spaces or . ' & -; null if it is not one. */
export function cleanClub(raw: string): string | null {
  const n = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return CLUB_OK.test(n) && !/https?:|www\./i.test(n) ? n : null;
}

export function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || 'Player';
}

/** Make competition and team count consistent with how many humans are in the room. */
export function fitSettings(settings: Settings, humans: number): Settings {
  const next = { ...settings };
  const opts = COMPETITIONS[next.competition].teamOptions;
  if (humans > opts[opts.length - 1]!) {
    // e.g. three friends in a "single match": a mini-league is the natural thing
    next.competition = 'league';
  }
  if (!validTeams(next.competition, next.teams) || next.teams < humans) next.teams = defaultTeams(next.competition, humans);
  return next;
}

export class RoomEngine {
  s: RoomState;
  private deps: Deps;

  constructor(state: RoomState, deps: Deps = defaultDeps) {
    this.s = state;
    this.deps = deps;
  }

  static create(code: string, now: number, deps: Deps = defaultDeps): RoomEngine {
    return new RoomEngine(
      {
        v: 3,
        code,
        rev: 0,
        createdAt: now,
        lastActive: now,
        phase: 'lobby',
        pausedAt: null,
        hostId: '',
        settings: { ...DEFAULT_SETTINGS },
        seats: [],
        secrets: {},
        game: 0,
        seed: '',
        draft: null,
        squads: {},
        setup: null,
        comp: null,
        day: null,
        hub: null,
        series: { wins: {}, games: 0, log: [] },
        rematch: {},
        window: null,
        windowDone: false,
        lastWindow: [],
        accounts: {},
      },
      deps,
    );
  }

  private humans(): Seat[] {
    return this.s.seats.filter((x) => !x.bot);
  }
  private nameOf(id: string): string {
    return this.s.seats.find((x) => x.id === id)?.name ?? '???';
  }
  /** the club a seat plays as (tables, scoreboards, commentary) */
  private teamOf(id: string): string {
    return teamName(this.s.seats.find((x) => x.id === id));
  }
  private slow(): boolean {
    return this.s.settings.gate === 'limit';
  }
  /** how long a stage lasts: a short timer when everyone is together, the time limit when they are not */
  private stageMs(liveSeconds: number): number {
    return this.slow() ? this.s.settings.limitHours * 3_600_000 : liveSeconds * 1000;
  }

  /* ───────────── membership ───────────── */

  join(msg: { id?: string; secret?: string; name: string; account?: string | null }, now: number): Result<{ id: string; secret: string }> {
    const s = this.s;
    // an account that already holds a seat here gets that seat back, whatever this browser remembers
    if (msg.account) {
      const sid = Object.keys(s.accounts).find((k) => s.accounts[k] === msg.account);
      const seat = sid ? s.seats.find((x) => x.id === sid && !x.bot) : undefined;
      if (seat) {
        this.setConnected(seat.id, true, now);
        return { ok: true, id: seat.id, secret: s.secrets[seat.id]! };
      }
    }
    if (msg.id) {
      const seat = s.seats.find((x) => x.id === msg.id && !x.bot);
      if (seat) {
        if (!msg.secret || s.secrets[seat.id] !== msg.secret) return fail('bad_secret', 'That seat belongs to someone else.');
        if (msg.account && !s.accounts[seat.id]) s.accounts[seat.id] = msg.account;
        this.setConnected(seat.id, true, now);
        return { ok: true, id: seat.id, secret: s.secrets[seat.id]! };
      }
    }
    if (s.phase !== 'lobby') return fail('in_progress', 'This game has already started.');
    if (this.humans().length >= MAX_SEATS) return fail('room_full', 'This room is full.');
    const id = this.deps.token().slice(0, 8);
    const secret = this.deps.token();
    const used = new Set(s.seats.map((x) => x.hue));
    const hue = SEAT_HUES.findIndex((_, i) => !used.has(i));
    let name = sanitizeName(msg.name);
    const taken = new Set(s.seats.map((x) => x.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      let n = 2;
      while (taken.has(`${name} ${n}`.toLowerCase())) n++;
      name = `${name} ${n}`;
    }
    const club = this.uniqueClub(cleanClub(`${name} FC`) ?? 'Club', id);
    s.seats.push({ id, name, hue: hue < 0 ? 0 : hue, connected: true, droppedAt: 0, formation: '433', bot: false, club, badge: defaultBadge(club) });
    s.secrets[id] = secret;
    if (msg.account) s.accounts[id] = msg.account;
    if (!s.hostId) s.hostId = id;
    s.settings = fitSettings(s.settings, this.humans().length);
    this.bump(now);
    return { ok: true, id, secret };
  }

  setConnected(id: string, connected: boolean, now: number): void {
    const seat = this.s.seats.find((x) => x.id === id && !x.bot);
    if (!seat || seat.connected === connected) return;
    seat.connected = connected;
    seat.droppedAt = connected ? 0 : now;
    const s = this.s;
    if (this.freezes()) {
      // Nobody left to play: freeze the game. When the first human is back, push every timer out by the time they were
      // away, so a match carries on from the minute they left and a pick timer has the same time left.
      if (!connected && this.nobodyHere() && s.pausedAt == null) s.pausedAt = now;
      else if (connected && s.pausedAt != null) {
        this.shiftClock(now - s.pausedAt);
        s.pausedAt = null;
      }
    } else {
      s.pausedAt = null;
    }
    this.bump(now);
  }

  private inPlay(): boolean {
    const p = this.s.phase;
    return p === 'draft' || p === 'setup' || p === 'match' || p === 'hub' || p === 'window';
  }

  /** Does the game stand still while nobody is connected? Always during the draft; afterwards only when the league is played live. */
  private freezes(): boolean {
    return this.inPlay() && (this.s.phase === 'draft' || !this.slow());
  }

  private nobodyHere(): boolean {
    return !this.humans().some((x) => x.connected);
  }

  private shiftClock(ms: number): void {
    if (ms <= 0) return;
    const s = this.s;
    if (s.draft && s.draft.deadline !== null) s.draft.deadline += ms;
    if (s.draft?.spot && s.draft.spot.stealUntil !== null) s.draft.spot.stealUntil += ms;
    if (s.window && s.window.deadline !== null) s.window.deadline += ms;
    if (s.setup) s.setup.deadline += ms;
    if (s.day) {
      s.day.startedAt += ms;
      s.day.deadline += ms;
    }
    if (s.hub) s.hub.deadline += ms;
    // a friend who is still away starts their grace (and their auto-pick timer) afresh, not from before the pause
    for (const x of this.humans()) if (!x.connected && x.droppedAt > 0) x.droppedAt += ms;
  }

  /** A dropped human counts as finished only after a grace period, so a locked phone does not skip their match. */
  private gone(x: Seat, now: number): boolean {
    // on a time limit nobody is waited for by the minute: the limit is the wait
    return !this.slow() && !x.connected && now >= x.droppedAt + DROP_GRACE_MS;
  }

  /** Explicit "leave room". In the lobby the seat is freed; mid-game the seat goes AFK. */
  leave(id: string, now: number): void {
    const s = this.s;
    if (s.phase === 'lobby') {
      this.removeSeat(id);
      this.bump(now);
    } else {
      this.setConnected(id, false, now);
    }
  }

  private removeSeat(id: string): void {
    const s = this.s;
    s.seats = s.seats.filter((x) => x.id !== id);
    delete s.secrets[id];
    delete s.accounts[id];
    delete s.squads[id];
    delete s.rematch[id];
    if (s.hostId === id) s.hostId = s.seats.find((x) => x.connected && !x.bot)?.id ?? s.seats.find((x) => !x.bot)?.id ?? '';
    s.settings = fitSettings(s.settings, Math.max(1, this.humans().length));
  }

  /* ───────────── message handling ───────────── */

  handle(id: string, msg: C2S, now: number): Result {
    this.tick(now);
    const s = this.s;
    const seat = s.seats.find((x) => x.id === id && !x.bot);
    if (!seat) return fail('bad_secret', 'You are not in this room.');
    const isHost = s.hostId === id;

    switch (msg.t) {
      case 'name': {
        seat.name = this.uniqueName(sanitizeName(msg.name), id);
        this.bump(now);
        return OK;
      }
      case 'settings': {
        if (!isHost) return fail('not_host', 'Only the host can change settings.');
        const patch = msg.patch ?? {};
        // the pace may change at any time (an evening that did not finish carries on with time limits); everything else only in the lobby
        const paceOnly = Object.keys(patch).every((k) => k === 'gate' || k === 'limitHours');
        if (s.phase !== 'lobby' && !paceOnly) return fail('wrong_phase', 'Settings are locked once the draft starts.');
        const r = this.applySettings(patch);
        if (!r.ok) return r;
        if (s.phase !== 'lobby') this.resetStageClock(now);
        this.bump(now);
        return OK;
      }
      case 'club': {
        if (s.phase !== 'lobby') return fail('wrong_phase', 'Clubs are fixed once the draft starts.');
        const name = cleanClub(msg.name);
        if (!name) return fail('bad_message', "Use 2 to 24 letters, numbers, spaces or . ' & -");
        if (s.seats.some((x) => x.id !== id && teamName(x).toLowerCase() === name.toLowerCase())) return fail('bad_message', 'Another club already has that name.');
        if (msg.badge !== undefined && !validBadge(msg.badge)) return fail('bad_message', 'That badge is not valid.');
        seat.club = name;
        seat.badge = msg.badge ?? seat.badge ?? defaultBadge(name);
        this.bump(now);
        return OK;
      }
      case 'formation': {
        if (!FORMATION_IDS.includes(msg.formation)) return fail('bad_message', 'Unknown formation.');
        if (s.phase === 'lobby') {
          seat.formation = msg.formation;
        } else if ((s.phase === 'setup' || s.phase === 'hub') && s.squads[id]) {
          s.squads[id] = changeFormation(s.squads[id]!, msg.formation);
          this.unready(id);
        } else {
          return fail('wrong_phase', 'You cannot change formation now.');
        }
        this.bump(now);
        return OK;
      }
      case 'start': {
        if (!isHost) return fail('not_host', 'Only the host can start.');
        if (s.phase !== 'lobby') return fail('wrong_phase', 'Already started.');
        for (const x of s.seats.filter((x) => !x.connected)) this.removeSeat(x.id);
        const n = this.humans().length;
        if (n < 1) return fail('need_players', 'Nobody is here to play.');
        s.settings = fitSettings(s.settings, n);
        if (s.settings.teams < 2) return fail('need_players', 'You need at least two teams. Add CPU teams or invite a friend.');
        const depth = poolHealth(this.pool(), s.settings.teams);
        if (!depth.ok) return fail('bad_settings', depth.problem!);
        this.startDraft(now);
        return OK;
      }
      case 'pack':
        return s.phase === 'window' ? this.windowOpen(id, msg.index, now) : this.openPack(id, msg.round, msg.index, now);
      case 'steal':
        return this.steal(id, msg.round, msg.card, now);
      case 'sign':
        return this.sign(id, msg.card, msg.slot, now);
      case 'pick':
        return this.pick(id, msg.round, msg.card, msg.slot, now);
      case 'swap': {
        if (!this.canEditLineup(id)) return fail('wrong_phase', 'Lineups are locked.');
        const a = s.squads[id]!;
        const b = swapSlots(a, msg.a, msg.b);
        if (b === a) return fail('bad_slot', 'Unknown slot.');
        s.squads[id] = b;
        this.unready(id);
        this.bump(now);
        return OK;
      }
      case 'arrange': {
        if (!this.canEditLineup(id)) return fail('wrong_phase', 'Lineups are locked.');
        s.squads[id] = autoArrange(s.squads[id]!);
        this.unready(id);
        this.bump(now);
        return OK;
      }
      case 'style': {
        if (!this.canEditLineup(id)) return fail('wrong_phase', 'Lineups are locked.');
        if (!(msg.style in STYLES)) return fail('bad_message', 'Unknown style.');
        s.squads[id] = { ...s.squads[id]!, style: msg.style };
        this.unready(id);
        this.bump(now);
        return OK;
      }
      case 'ready': {
        if (s.phase === 'setup' && s.setup) s.setup.ready[id] = !!msg.ready;
        else if (s.phase === 'hub' && s.hub) {
          s.hub.ready[id] = !!msg.ready;
          if (msg.ready) this.markSeen(id); // ready for the next matchday: whoever says so has chosen not to watch the last one
        } else return fail('wrong_phase', 'Nothing to confirm right now.');
        this.bump(now);
        this.tick(now);
        return OK;
      }
      case 'seen': {
        const had = this.markSeen(id);
        if (s.phase === 'match' && s.day) s.day.seen[id] = true;
        else if (!had) return OK;
        this.bump(now);
        this.tick(now);
        return OK;
      }
      case 'rematch': {
        if (s.phase !== 'result') return fail('wrong_phase', 'Not finished yet.');
        s.rematch[id] = !!msg.want;
        this.bump(now);
        this.tick(now);
        return OK;
      }
      case 'lobby': {
        if (!isHost) return fail('not_host', 'Only the host can do that.');
        if (s.phase !== 'result') return fail('wrong_phase', 'Finish the game first.');
        this.backToLobby(now);
        return OK;
      }
      case 'kick': {
        if (!isHost) return fail('not_host', 'Only the host can remove players.');
        if (s.phase !== 'lobby') return fail('wrong_phase', 'You can only remove players in the lobby.');
        if (msg.id === id) return fail('bad_message', 'You cannot remove yourself.');
        this.removeSeat(msg.id);
        this.bump(now);
        return OK;
      }
      case 'hello':
      case 'emote':
        return OK;
      default:
        return fail('bad_message', 'Unknown message.');
    }
  }

  private canEditLineup(id: string): boolean {
    const s = this.s;
    return (s.phase === 'setup' || s.phase === 'hub') && !!s.squads[id];
  }

  /** Changing your lineup takes back a "ready". */
  private unready(id: string): void {
    const s = this.s;
    if (s.setup) s.setup.ready[id] = false;
    if (s.hub) s.hub.ready[id] = false;
  }

  private applySettings(p: Partial<Settings>): Result {
    const s = this.s;
    const next: Settings = { ...s.settings };
    if (p.format !== undefined) {
      if (p.format !== 'spotlight' && p.format !== 'duel' && p.format !== 'packs' && p.format !== 'turns') return fail('bad_message', 'Unknown draft format.');
      next.format = p.format;
    }
    if (p.pools !== undefined) {
      if (!Array.isArray(p.pools) || p.pools.length < 1 || p.pools.length > Object.keys(POOLS).length || p.pools.some((x) => !(x in POOLS))) return fail('bad_message', 'Unknown pool.');
      next.pools = [...new Set(p.pools)] as PoolId[];
    }
    if (p.nations !== undefined) {
      if (!Array.isArray(p.nations) || p.nations.length > 80 || p.nations.some((x) => typeof x !== 'string' || !/^[A-Z]{3}$/.test(x))) return fail('bad_message', 'Unknown country.');
      next.nations = [...new Set(p.nations)].sort();
    }
    if (p.steals !== undefined) {
      if (p.steals !== 0 && p.steals !== 1 && p.steals !== 2) return fail('bad_message', 'Unknown number of steals.');
      next.steals = p.steals;
    }
    if (p.gate !== undefined) {
      if (p.gate !== 'live' && p.gate !== 'limit') return fail('bad_message', 'Unknown pace.');
      next.gate = p.gate;
    }
    if (p.limitHours !== undefined) {
      if (!(LIMIT_HOURS as readonly number[]).includes(p.limitHours)) return fail('bad_message', 'Unknown time limit.');
      next.limitHours = p.limitHours;
    }
    if (p.window !== undefined) next.window = !!p.window;
    if (p.eras !== undefined) {
      if (!Array.isArray(p.eras) || p.eras.length > Object.keys(ERAS).length || p.eras.some((e) => !(e in ERAS))) return fail('bad_message', 'Unknown era.');
      next.eras = [...new Set(p.eras)] as EraId[];
    }
    if (p.ratings !== undefined) {
      if (p.ratings !== 'hidden' && p.ratings !== 'tier' && p.ratings !== 'full') return fail('bad_message', 'Unknown rating mode.');
      next.ratings = p.ratings;
    }
    if (p.pickSeconds !== undefined) {
      if (!(PICK_SECONDS as readonly number[]).includes(p.pickSeconds)) return fail('bad_message', 'Unknown timer.');
      next.pickSeconds = p.pickSeconds;
    }
    const humans = Math.max(1, this.humans().length);
    if (p.competition !== undefined) {
      if (!(p.competition in COMPETITIONS)) return fail('bad_message', 'Unknown competition.');
      next.competition = p.competition as CompetitionKind;
      next.teams = defaultTeams(next.competition, humans);
      // knockout-style games are quicker to watch; leagues have many matches
      if (p.pace === undefined) next.pace = next.competition === 'match' ? 'normal' : 'quick';
    }
    if (p.teams !== undefined) {
      if (!validTeams(next.competition, p.teams)) return fail('bad_settings', 'That team count does not suit this competition.');
      if (p.teams < humans) return fail('bad_settings', 'There are more players than teams.');
      next.teams = p.teams;
    }
    if (p.botLevel !== undefined) {
      if (!(p.botLevel in BOT_LEVELS)) return fail('bad_message', 'Unknown CPU level.');
      next.botLevel = p.botLevel;
    }
    if (p.pace !== undefined) {
      if (p.pace !== 'normal' && p.pace !== 'quick') return fail('bad_message', 'Unknown pace.');
      next.pace = p.pace;
    }
    if (p.legs !== undefined) {
      if (p.legs !== 1 && p.legs !== 2) return fail('bad_message', 'Unknown league length.');
      next.legs = p.legs;
    }
    s.settings = fitSettings(next, humans);
    return OK;
  }

  private uniqueClub(name: string, selfId: string): string {
    const taken = new Set(this.s.seats.filter((x) => x.id !== selfId).map((x) => teamName(x).toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`.toLowerCase())) n++;
    return `${name} ${n}`;
  }

  /** The pace changed mid-game: the stage in progress gets a fresh clock of the new kind. */
  private resetStageClock(now: number): void {
    const s = this.s;
    if (s.phase === 'setup' && s.setup) s.setup.deadline = now + this.stageMs(SETUP_SECONDS);
    if (s.phase === 'hub' && s.hub) s.hub.deadline = now + this.stageMs(HUB_SECONDS);
    if (s.phase === 'window' && s.window) {
      const w = s.window;
      w.turn = this.slow() ? -1 : Math.max(0, w.order.findIndex((id) => w.seats[id]!.stage !== 'done'));
      w.deadline = this.windowDeadline(now);
    }
    if (!this.freezes()) s.pausedAt = null;
  }

  private uniqueName(name: string, selfId: string): string {
    const taken = new Set(this.s.seats.filter((x) => x.id !== selfId).map((x) => x.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`.toLowerCase())) n++;
    return `${name} ${n}`;
  }

  /* ───────────── draft (humans only; CPU teams draft afterwards) ───────────── */

  /** the pool and era filter as one value for dealing and for the CPU teams */
  private pool(): PoolKey {
    return poolKey(this.s.settings.pools, this.s.settings.eras ?? [], this.s.settings.nations ?? []);
  }

  private startDraft(now: number): void {
    const s = this.s;
    s.game += 1;
    s.seed = this.deps.seed();
    // CPU teams are created fresh for every game
    s.seats = s.seats.filter((x) => !x.bot);
    const nBots = s.settings.teams - this.humans().length;
    const names = botNames(s.seed, nBots);
    for (let i = 0; i < nBots; i++) {
      s.seats.push({ id: `cpu${i + 1}`, name: names[i]!, hue: i, connected: true, droppedAt: 0, formation: '433', bot: true, club: names[i]!, badge: defaultBadge(names[i]!) });
    }
    s.squads = {};
    for (const seat of this.humans()) s.squads[seat.id] = emptySquad(seat.formation);
    s.setup = null;
    s.comp = null;
    s.day = null;
    s.hub = null;
    s.rematch = {};
    s.window = null;
    s.windowDone = false;
    s.lastWindow = [];
    s.phase = 'draft';
    s.draft = {
      round: 0,
      deadline: null,
      shared: s.settings.format === 'duel',
      turns: s.settings.format === 'turns',
      board: [],
      boards: {},
      order: [],
      turn: 0,
      picked: [],
      taken: [],
      log: [],
    };
    if (s.draft.turns) {
      // everyone drafts in this order, one after the other; who goes first alternates between games
      const ids = this.humans().map((x) => x.id);
      const rot = (s.game - 1) % ids.length;
      s.draft.order = ids.slice(rot).concat(ids.slice(0, rot));
    }
    if (s.settings.format === 'spotlight') this.startSpotlight(now);
    else this.dealRound(now, 1);
    this.bump(now);
  }

  private turnDeadline(now: number, intro: boolean): number | null {
    const sec = this.s.settings.pickSeconds;
    if (!sec) return null;
    return now + sec * 1000 + (intro ? 2500 : 0);
  }

  private dealRound(now: number, round: number): void {
    const s = this.s;
    const d = s.draft!;
    const ids = this.humans().map((x) => x.id);
    const n = ids.length;
    d.round = round;
    d.picked = [];
    if (!d.turns) d.turn = 0; // in take-turns, turn is whose draft it is and only moves when they are done
    d.offers = undefined;
    d.opened = {};
    // everyone who is choosing gets three sealed packs; they only see the clues until they open one
    const sealed = (id: string) => {
      const sq = s.squads[id]!;
      d.offers![id] = dealPacks({
        seed: s.seed, pool: this.pool(), round, key: id,
        size: boardSize('packs', n),
        taken: new Set(Object.values(sq.slots).filter((x): x is string => !!x)),
        needs: [openRoles(sq).map((o) => o.role)],
      });
      d.boards[id] = [];
    };
    if (d.turns) {
      d.offers = {};
      d.boards = {};
      sealed(d.order[d.turn]!);
    } else if (d.shared) {
      const needs = ids.map((id) => openRoles(s.squads[id]!).map((o) => o.role));
      d.board = dealBoard({
        seed: s.seed, pool: this.pool(), round, key: 'shared',
        size: boardSize('duel', n), taken: new Set(d.taken), needs,
      });
      const rot = (s.game - 1) % n;
      const base = ids.slice(rot).concat(ids.slice(0, rot));
      d.order = round % 2 === 1 ? base : base.slice().reverse();
    } else {
      d.boards = {};
      d.offers = {};
      for (const id of ids) sealed(id);
      d.order = ids;
    }
    d.deadline = this.turnDeadline(now, round === 1);
  }

  /** The humans who owe a pick right now. */
  private owing(): Seat[] {
    const d = this.s.draft;
    if (!d) return [];
    const humans = this.humans();
    if (d.shared || d.turns || d.spot) {
      const up = humans.find((x) => x.id === d.order[d.turn]);
      return up ? [up] : [];
    }
    return humans.filter((x) => !d.picked.includes(x.id));
  }

  /** The deadline that applies to one seat right now (AFK seats are cut short). */
  private seatDeadline(seatId: string): number | null {
    const d = this.s.draft;
    if (!d) return null;
    const seat = this.s.seats.find((x) => x.id === seatId);
    let dl = d.deadline;
    if (seat && !seat.bot && !seat.connected) {
      const afk = seat.droppedAt + AFK_GRACE_MS;
      dl = dl === null ? afk : Math.min(dl, afk);
    }
    return dl;
  }

  private pick(id: string, round: number, card: string, slot: string, now: number): Result {
    const s = this.s;
    const d = s.draft;
    if (s.phase !== 'draft' || !d) return fail('wrong_phase', 'The draft is not running.');
    if (round !== d.round) return fail('stale_round', 'That round is over.');
    if (d.spot) {
      const sp = d.spot;
      if (sp.queue[sp.i] !== id) return fail('not_your_turn', 'Not your turn yet.');
      if (sp.stage !== 'open') return fail('bad_card', 'Open a pack first.');
      if (sp.stealUntil !== null && now < sp.stealUntil) return fail('not_your_turn', 'Wait a moment: a rival may still steal from this pack.');
      if (!d.board.includes(card)) return fail('bad_card', 'That card is not in the pack.');
      const mine = s.squads[id];
      if (!mine || !(slot in mine.slots) || mine.slots[slot]) return fail('bad_slot', 'That position is already filled.');
      this.spotPick(id, card, slot, false, now);
      return OK;
    }
    let board: string[];
    if (d.shared) {
      if (d.order[d.turn] !== id) return fail('not_your_turn', 'Not your turn yet.');
      board = d.board;
    } else if (d.turns) {
      if (d.order[d.turn] !== id) return fail('not_your_turn', 'Not your turn to draft yet.');
      board = d.boards[id] ?? [];
    } else {
      if (d.picked.includes(id)) return fail('not_your_turn', 'You already picked this round.');
      board = d.boards[id] ?? [];
    }
    if (board.length === 0 && d.offers?.[id]) return fail('bad_card', 'Open a pack first.');
    if (!board.includes(card)) return fail('bad_card', 'That card is not on the board.');
    const sq = s.squads[id];
    if (!sq || !(slot in sq.slots) || sq.slots[slot]) return fail('bad_slot', 'That position is already filled.');
    this.applyPick(id, card, slot, false, now);
    return OK;
  }

  private openPack(id: string, round: number, index: number, now: number): Result {
    const s = this.s;
    const d = s.draft;
    if (s.phase !== 'draft' || !d) return fail('wrong_phase', 'The draft is not running.');
    if (d.spot) {
      const sp = d.spot;
      if (round !== d.round) return fail('stale_round', 'That round is over.');
      if (sp.queue[sp.i] !== id) return fail('not_your_turn', 'Not your turn to draft yet.');
      if (sp.stage !== 'choose') return fail('bad_card', 'You already opened a pack.');
      if (!Number.isInteger(index) || index < 0 || index >= sp.packs.length) return fail('bad_message', 'Unknown pack.');
      this.spotOpen(id, index, now);
      this.bump(now);
      return OK;
    }
    if (d.shared || !d.offers) return fail('wrong_phase', 'This draft has no packs to open.');
    if (round !== d.round) return fail('stale_round', 'That round is over.');
    if (d.turns && d.order[d.turn] !== id) return fail('not_your_turn', 'Not your turn to draft yet.');
    const offers = d.offers[id];
    if (!offers || d.picked.includes(id)) return fail('not_your_turn', 'You have no pack to open right now.');
    if (d.opened?.[id] !== undefined) return fail('bad_card', 'You already opened a pack.');
    if (!Number.isInteger(index) || index < 0 || index >= offers.length) return fail('bad_message', 'Unknown pack.');
    this.openOffer(id, index);
    this.bump(now);
    return OK;
  }

  private openOffer(id: string, index: number): void {
    const d = this.s.draft!;
    d.opened = d.opened ?? {};
    d.opened[id] = index;
    d.boards[id] = d.offers![id]![index]!.cards.slice();
  }

  private applyPick(id: string, card: string, slot: string, auto: boolean, now: number): void {
    const s = this.s;
    const d = s.draft!;
    const next = placePlayer(s.squads[id]!, slot, card);
    if (!next) return; // cannot happen after validation; never throw inside a room
    s.squads[id] = next;
    d.log.push({ round: d.round, seat: id, player: card, auto });
    if (d.log.length > 60) d.log.splice(0, d.log.length - 60);
    d.picked.push(id);
    if (d.shared) {
      d.board = d.board.filter((x) => x !== card);
      d.taken.push(card);
      d.turn++;
      if (d.turn >= d.order.length) this.finishRound(now);
      else d.deadline = this.turnDeadline(now, false);
    } else if (d.turns || d.picked.length >= this.humans().length) {
      // take-turns: the one human who is up has picked, so the round is over
      this.finishRound(now);
    }
    this.bump(now);
  }

  private finishRound(now: number): void {
    const d = this.s.draft!;
    if (d.round >= ROUNDS) {
      if (d.turns && d.turn + 1 < d.order.length) {
        d.turn++; // the next human starts their own draft from round 1
        this.dealRound(now, 1);
      } else this.toSetup(now);
    } else this.dealRound(now, d.round + 1);
  }

  private autoPickFor(id: string, now: number): void {
    const s = this.s;
    const d = s.draft!;
    // somebody who ran out of time before choosing a pack gets one chosen for them, by the seed, so it is never a leak
    const mine = d.offers?.[id];
    if (!d.shared && mine && mine.length > 0 && (d.boards[id] ?? []).length === 0) this.openOffer(id, hashSeed(`${s.seed}/open/${d.round}/${id}`) % mine.length);
    const board = d.shared ? d.board : (d.boards[id] ?? []);
    const sq = s.squads[id]!;
    let choice = autoPick(sq, board);
    if (!choice) {
      // defensive: any card in any open slot, so a room can never deadlock
      const slot = openRoles(sq)[0]?.slotId;
      const card = board.find((c) => !Object.values(sq.slots).includes(c));
      if (slot && card) choice = { cardId: card, slotId: slot };
    }
    if (!choice) {
      // truly nothing to pick (should be impossible): skip the seat so the round still ends
      d.picked.push(id);
      if (d.shared) {
        d.turn++;
        if (d.turn >= d.order.length) this.finishRound(now);
      } else if (d.turns || d.picked.length >= this.humans().length) this.finishRound(now);
      this.bump(now);
      return;
    }
    this.applyPick(id, choice.cardId, choice.slotId, true, now);
  }

  /* ───────────── spotlight draft: one manager at a time, three packs that look the same ───────────── */

  private startSpotlight(now: number): void {
    const s = this.s;
    const d = s.draft!;
    const ids = this.humans().map((x) => x.id);
    const rot = (s.game - 1) % ids.length; // who goes first alternates from game to game
    const base = ids.slice(rot).concat(ids.slice(0, rot));
    const queue: string[] = [];
    for (let r = 0; r < ROUNDS; r++) queue.push(...(r % 2 === 0 ? base : base.slice().reverse()));
    const each = (n: number) => Object.fromEntries(ids.map((id) => [id, n]));
    d.spot = {
      queue, i: 0, stage: 'choose', packs: [], opened: null, stealUntil: null, stolen: null,
      steals: each(ids.length > 1 ? s.settings.steals : 0), owed: each(0), missed: null,
    };
    this.beginSpotTurn(now, true);
  }

  /** Put the next manager on the clock with three fresh sealed packs. A turn that a steal already filled is skipped. */
  private beginSpotTurn(now: number, intro = false): void {
    const s = this.s;
    const d = s.draft!;
    const sp = d.spot!;
    const per = sp.queue.length / ROUNDS;
    for (;;) {
      if (sp.i >= sp.queue.length) return this.toSetup(now);
      const seat = sp.queue[sp.i]!;
      if ((sp.owed[seat] ?? 0) > 0) { sp.owed[seat]!--; sp.i++; continue; }
      const sq = s.squads[seat]!;
      const open = openRoles(sq);
      // every deal leaves out everyone already in a squad, so a player can be in one team only
      const offers = open.length ? dealPacks({ seed: s.seed, pool: this.pool(), round: sp.i + 1, key: seat, size: boardSize('packs', per), taken: new Set(d.taken), needs: [open.map((o) => o.role)] }) : [];
      if (offers.length === 0) { sp.i++; continue; } // nothing left to deal or nothing left to fill: never stall
      d.round = Math.floor(sp.i / per) + 1;
      d.order = sp.queue.slice((d.round - 1) * per, d.round * per);
      d.turn = sp.i - (d.round - 1) * per;
      d.board = [];
      d.picked = [];
      sp.packs = offers.map((o) => o.cards);
      sp.stage = 'choose';
      sp.opened = null;
      sp.stealUntil = null;
      sp.stolen = null;
      d.deadline = this.turnDeadline(now, intro);
      return;
    }
  }

  private spotOpen(seat: string, index: number, now: number): void {
    const d = this.s.draft!;
    const sp = d.spot!;
    sp.opened = index;
    sp.stage = 'open';
    d.board = sp.packs[index]!.slice();
    const rivals = this.humans().some((x) => x.id !== seat && this.canSteal(x.id));
    sp.stealUntil = rivals ? now + STEAL_MS : null;
    // the steal window is not taken out of the manager's own time
    if (sp.stealUntil !== null && d.deadline !== null) d.deadline = Math.max(d.deadline, now) + STEAL_MS;
  }

  /** May this manager take a card out of the pack that is open right now? (The clock is checked by the caller.) */
  private canSteal(id: string): boolean {
    const d = this.s.draft;
    const sp = d?.spot;
    if (!d || !sp || sp.stage !== 'open' || sp.stolen) return false;
    if (sp.queue[sp.i] === id || (sp.steals[id] ?? 0) <= 0) return false;
    const sq = this.s.squads[id];
    if (!sq || openRoles(sq).length === 0) return false;
    // a steal takes the place of a turn still to come, so there has to be one
    return sp.queue.slice(sp.i + 1).filter((x) => x === id).length - (sp.owed[id] ?? 0) > 0;
  }

  private steal(id: string, round: number, card: string, now: number): Result {
    const s = this.s;
    const d = s.draft;
    const sp = d?.spot;
    if (s.phase !== 'draft' || !d || !sp) return fail('wrong_phase', 'There is nothing to steal right now.');
    if (round !== d.round) return fail('stale_round', 'That round is over.');
    if (!this.canSteal(id) || sp.stealUntil === null || now > sp.stealUntil + GRACE_MS) return fail('not_your_turn', 'You cannot steal now.');
    if (!d.board.includes(card)) return fail('bad_card', 'That card is not in the pack.');
    const sq = s.squads[id]!;
    const slot = suggestSlot(sq, card) ?? openRoles(sq)[0]?.slotId;
    const next = slot ? placePlayer(sq, slot, card) : null;
    if (!next) return fail('bad_slot', 'You have no room for that player.');
    s.squads[id] = next;
    d.board = d.board.filter((x) => x !== card);
    d.taken.push(card);
    sp.stolen = { by: id, card };
    sp.steals[id] = (sp.steals[id] ?? 1) - 1;
    sp.owed[id] = (sp.owed[id] ?? 0) + 1;
    sp.stealUntil = now; // one steal per pack: the window is over and the manager on the clock may choose from what is left
    d.log.push({ round: d.round, seat: id, player: card, auto: false, from: sp.queue[sp.i]! });
    if (d.log.length > 60) d.log.splice(0, d.log.length - 60);
    this.bump(now);
    return OK;
  }

  private spotPick(id: string, card: string, slot: string, auto: boolean, now: number): void {
    const s = this.s;
    const d = s.draft!;
    const sp = d.spot!;
    const next = placePlayer(s.squads[id]!, slot, card);
    if (!next) return; // cannot happen after validation; never throw inside a room
    s.squads[id] = next;
    d.taken.push(card);
    d.log.push({ round: d.round, seat: id, player: card, auto });
    if (d.log.length > 60) d.log.splice(0, d.log.length - 60);
    // what they did not get: shown to everyone, and all of it goes back into the pool
    sp.missed = { seat: id, round: d.round, picked: card, left: d.board.filter((x) => x !== card), others: sp.packs.filter((_, i) => i !== sp.opened) };
    sp.i++;
    this.beginSpotTurn(now);
    this.bump(now);
  }

  /** The clock ran out: open a pack for them (chosen by the seed, so it is never a leak), then take the best fit. */
  private spotTimeout(now: number): boolean {
    const s = this.s;
    const d = s.draft!;
    const sp = d.spot!;
    const seat = sp.queue[sp.i];
    if (!seat) return false;
    const dl = this.seatDeadline(seat);
    if (dl === null || now < dl + GRACE_MS) return false;
    if (sp.stage === 'choose') {
      this.spotOpen(seat, hashSeed(`${s.seed}/open/${sp.i}/${seat}`) % sp.packs.length, now);
      this.bump(now);
      return true;
    }
    if (sp.stealUntil !== null && now < sp.stealUntil) return false;
    const sq = s.squads[seat]!;
    let choice = autoPick(sq, d.board);
    if (!choice) {
      const slot = openRoles(sq)[0]?.slotId;
      if (slot && d.board[0]) choice = { cardId: d.board[0], slotId: slot };
    }
    if (choice) this.spotPick(seat, choice.cardId, choice.slotId, true, now);
    else { sp.i++; this.beginSpotTurn(now); this.bump(now); }
    return true;
  }

  /* ───────────── sealed results ───────────── */

  /** The played match this manager has not watched yet, newest first. */
  private unseenOf(id: string): { day: number; fixture: string } | null {
    const c = this.s.comp;
    if (!c) return null;
    for (let i = Math.min(c.day, c.days.length - 1); i >= 0; i--) {
      const f = c.days[i]!.fixtures.find((x) => x.unseen?.includes(id));
      if (f) return { day: i, fixture: f.id };
    }
    return null;
  }

  private anyUnseen(): boolean {
    return !!this.s.comp?.days.some((d) => d.fixtures.some((f) => f.unseen?.length));
  }

  /** This manager has watched (or waived) their match. Returns whether anything was waiting. */
  private markSeen(id: string): boolean {
    const c = this.s.comp;
    let had = false;
    for (const d of c?.days ?? []) for (const f of d.fixtures) {
      if (f.unseen?.includes(id)) { f.unseen = f.unseen.filter((x) => x !== id); had = true; }
    }
    return had;
  }

  /** The embargo on a matchday ends when the next one is played: its scores are open to everyone and its stories are dropped. */
  private unsealBefore(dayIndex: number): void {
    const c = this.s.comp!;
    for (let i = 0; i < Math.min(dayIndex, c.days.length); i++) for (const f of c.days[i]!.fixtures) {
      if (f.unseen?.length) f.unseen = [];
      f.result = null;
    }
  }

  /**
   * The competition as one viewer may see it. A fixture somebody has yet to watch is sealed: other people get no score for it (so the
   * table they build leaves it out), and the people who play in it get the match itself to watch but no score outside it.
   */
  private compFor(forId: string): CompState | null {
    const c = this.s.comp;
    if (!c) return null;
    let sealed = false;
    const days = c.days.map((d) => ({
      ...d,
      fixtures: d.fixtures.map((f) => {
        const mine = f.humans.includes(forId);
        if (!f.unseen?.length) return mine || !f.result ? f : { ...f, result: null }; // open to everyone; the story only to those who play in it
        sealed = true;
        if (mine && !f.unseen.includes(forId)) return f; // I have watched it; my opponent has not
        if (mine) return { ...f, lite: null, sealed: true };
        return { ...f, lite: null, result: null, sealed: true };
      }),
    }));
    return { ...c, days, champion: sealed ? null : c.champion };
  }

  /* ───────────── the mid-season transfer window ───────────── */

  private windowDue(): boolean {
    const s = this.s;
    const c = s.comp!;
    return s.settings.window && c.kind === 'league' && !s.windowDone && !c.champion && c.days.length >= 3 && c.day >= Math.floor(c.days.length / 2);
  }

  private windowDeadline(now: number): number | null {
    if (this.slow()) return now + this.s.settings.limitHours * 3_600_000;
    return this.s.settings.pickSeconds ? now + WINDOW_SECONDS * 1000 : null;
  }

  /** bottom of the table first */
  private windowOrder(): string[] {
    return tables(this.s.comp!)[0]!.rows.map((r) => r.id).reverse();
  }

  private openWindow(now: number): void {
    const s = this.s;
    const humans = new Set(this.humanIds());
    const order = this.windowOrder().filter((id) => humans.has(id));
    const seats: Record<string, WindowSeat> = {};
    for (const id of order) seats[id] = { stage: 'choose', board: [], others: [], signed: null };
    s.window = { order, turn: this.slow() ? -1 : 0, deadline: this.windowDeadline(now), seats, signings: [] };
    s.phase = 'window';
    this.bump(now);
    if (order.length === 0) this.closeWindow(now);
  }

  private windowTurn(id: string): boolean {
    const w = this.s.window!;
    return w.turn === -1 || w.order[w.turn] === id;
  }

  private weakestRole(id: string): Role {
    const sq = this.s.squads[id]!;
    let worst: { role: Role; v: number } | null = null;
    for (const sl of FORMATIONS[sq.formation].slots) {
      const p = sq.slots[sl.id];
      const v = p ? effectiveOvr(p, sl.role) : -1;
      if (!worst || v < worst.v) worst = { role: sl.role, v };
    }
    return worst?.role ?? 'ST';
  }

  /** everyone who cannot be dealt in the window: every squad, and what lies open on a rival's table right now */
  private windowTaken(): Set<string> {
    const s = this.s;
    const taken = new Set<string>();
    for (const sq of Object.values(s.squads)) for (const p of Object.values(sq.slots)) if (p) taken.add(p);
    for (const x of Object.values(s.window?.seats ?? {})) if (x.stage === 'open') for (const p of x.board) taken.add(p);
    return taken;
  }

  private windowOpen(id: string, index: number, now: number): Result {
    const s = this.s;
    const w = s.window;
    if (s.phase !== 'window' || !w) return fail('wrong_phase', 'The transfer window is not open.');
    const me = w.seats[id];
    if (!me || !this.windowTurn(id)) return fail('not_your_turn', 'Not your turn yet.');
    if (me.stage !== 'choose') return fail('bad_card', 'You already opened a pack.');
    if (!Number.isInteger(index) || index < 0 || index >= PACKS_PER_ROUND) return fail('bad_message', 'Unknown pack.');
    // dealt at the moment of opening, so it can never hold a player somebody signed a minute ago
    const packs = dealPacks({ seed: s.seed, pool: this.pool(), round: 100 + s.game, key: `w/${id}`, size: 3, taken: this.windowTaken(), needs: [[this.weakestRole(id)]] }).map((o) => o.cards);
    if (packs.length === 0) { me.stage = 'done'; this.windowAdvance(now); return OK; }
    const i = Math.min(index, packs.length - 1);
    me.board = packs[i]!;
    me.others = packs.filter((_, k) => k !== i);
    me.stage = 'open';
    this.bump(now);
    return OK;
  }

  private sign(id: string, card: string | null, slot: string | undefined, now: number): Result {
    const s = this.s;
    const w = s.window;
    if (s.phase !== 'window' || !w) return fail('wrong_phase', 'The transfer window is not open.');
    const me = w.seats[id];
    if (!me || me.stage === 'done' || !this.windowTurn(id)) return fail('not_your_turn', 'Not your turn yet.');
    if (card !== null) {
      if (me.stage !== 'open' || !me.board.includes(card)) return fail('bad_card', 'That player is not in your pack.');
      const sq = s.squads[id]!;
      const out = slot ? sq.slots[slot] : null;
      if (!slot || !out) return fail('bad_slot', 'Choose which of your players makes way.');
      s.squads[id] = { ...sq, slots: { ...sq.slots, [slot]: card } };
      me.signed = { team: id, in: card, out };
      w.signings.push(me.signed);
    }
    me.stage = 'done';
    this.windowAdvance(now);
    return OK;
  }

  private windowAdvance(now: number): void {
    const w = this.s.window!;
    if (w.turn >= 0) {
      while (w.turn < w.order.length && w.seats[w.order[w.turn]!]!.stage === 'done') w.turn++;
      if (w.turn < w.order.length) { w.deadline = this.windowDeadline(now); this.bump(now); return; }
    } else if (w.order.some((id) => w.seats[id]!.stage !== 'done')) { this.bump(now); return; }
    this.closeWindow(now);
  }

  /** The managers are done. CPU teams take their turn (bottom of the table first, signing only an improvement), then the season goes on. */
  private closeWindow(now: number): void {
    const s = this.s;
    const w = s.window!;
    const taken = this.windowTaken();
    for (const id of this.windowOrder()) {
      if (!s.seats.find((x) => x.id === id)?.bot) continue;
      const sq = s.squads[id]!;
      const cards = dealBoard({ seed: s.seed, pool: this.pool(), round: 100 + s.game, key: `w/${id}`, size: 3, taken, needs: [[this.weakestRole(id)]] });
      let best: { card: string; slot: string; gain: number } | null = null;
      for (const card of cards) for (const sl of FORMATIONS[sq.formation].slots) {
        const cur = sq.slots[sl.id];
        if (!cur) continue;
        const gain = effectiveOvr(card, sl.role) - effectiveOvr(cur, sl.role);
        if (gain > (best?.gain ?? 0.5)) best = { card, slot: sl.id, gain };
      }
      if (!best) continue;
      const out = sq.slots[best.slot]!;
      s.squads[id] = { ...sq, slots: { ...sq.slots, [best.slot]: best.card } };
      taken.add(best.card);
      taken.delete(out);
      w.signings.push({ team: id, in: best.card, out });
    }
    s.lastWindow = w.signings.slice();
    s.window = null;
    s.windowDone = true;
    if (s.hub) s.hub.deadline = now + this.stageMs(HUB_SECONDS);
    s.phase = 'hub';
    this.bump(now);
  }

  /* ───────────── setup, matchdays, hub, result ───────────── */

  private toSetup(now: number): void {
    const s = this.s;
    s.phase = 'setup';
    s.draft = null;
    // CPU teams draft from whoever the humans left
    const taken = new Set<string>();
    for (const h of this.humans()) for (const p of Object.values(s.squads[h.id]!.slots)) if (p) taken.add(p);
    for (const b of s.seats.filter((x) => x.bot)) s.squads[b.id] = buildBotSquad(s.seed, this.pool(), s.settings.botLevel, taken, b.id);
    s.setup = { deadline: now + this.stageMs(SETUP_SECONDS), ready: {} };
  }

  private humanIds(): string[] {
    return this.humans().map((x) => x.id);
  }

  private simulateDay(idx: number): void {
    const s = this.s;
    const day = s.comp!.days[idx]!;
    for (const f of day.fixtures) {
      if (f.lite) continue;
      const names: [string, string] = [this.teamOf(f.a), this.teamOf(f.b)];
      const result = simulateMatch(s.squads[f.a]!, s.squads[f.b]!, names, `${s.seed}/d${idx}/${f.id}`, { knockout: f.knockout, gkPivot: s.comp!.gkPivot });
      f.lite = litefy(result);
      // only matches a human plays in are kept in full; CPU-versus-CPU games are just a result
      f.result = f.humans.length ? result : null;
      // sealed until the humans in it have watched it
      if (f.humans.length) f.unseen = f.humans.slice();
    }
  }

  private dayHasHumans(day: Matchday): boolean {
    return day.fixtures.some((f) => f.humans.length > 0);
  }

  /** Matchdays nobody human plays in resolve instantly. Returns the indexes of the days it skipped over. */
  private skipCpuDays(): number[] {
    const c = this.s.comp!;
    const skipped: number[] = [];
    for (let guard = 0; guard < 80 && !c.champion && !this.dayHasHumans(c.days[c.day]!); guard++) {
      const idx = c.day;
      this.simulateDay(idx);
      completeDay(c, this.humanIds());
      skipped.push(idx);
    }
    return skipped;
  }

  /** The first matchday starts once everyone has set up. */
  private startCompetition(now: number): void {
    const s = this.s;
    const teamIds = s.seats.map((x) => x.id);
    s.comp = createCompetition(s.settings.competition, teamIds, this.humanIds(), s.seed, s.settings.legs);
    // a league of sourced players is not at the stars' level: its keepers are judged against each other (the mean starting keeper
    // stops the average share of shots), or every one of them would look poor and goals would jump by a third
    if (!poolHasStars(this.pool())) s.comp.gkPivot = this.keeperLevel();
    s.setup = null;
    this.skipCpuDays();
    if (s.comp.champion) return this.toResult(now);
    this.beginHumanDay(now);
  }

  private keeperLevel(): number {
    const vals: number[] = [];
    for (const sq of Object.values(this.s.squads)) {
      const slot = FORMATIONS[sq.formation].slots.find((x) => x.role === 'GK');
      const id = slot ? sq.slots[slot.id] : null;
      if (id) vals.push(effectiveOvr(id, 'GK'));
    }
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 85;
  }

  private beginHumanDay(now: number): void {
    const s = this.s;
    const c = s.comp!;
    this.unsealBefore(c.day);
    this.simulateDay(c.day);
    // on a time limit nobody waits for anybody to watch: the day is played and each manager watches when they are next here
    if (this.slow()) return this.afterDay(now);
    const day = c.days[c.day]!;
    const mine = day.fixtures.filter((f) => f.humans.length > 0);
    const seen: Record<string, boolean> = {};
    for (const h of this.humans()) if (!mine.some((f) => f.humans.includes(h.id))) seen[h.id] = true;
    let longest = 0;
    for (const f of mine) longest = Math.max(longest, playbackSchedule(f.result!, s.settings.pace).totalMs);
    s.day = { startedAt: now + 3000, seen, deadline: now + 3000 + longest + 4500 + 30_000 };
    s.hub = null;
    s.phase = 'match';
    this.bump(now);
  }

  /** Everyone has watched (or skipped) their games. Close the matchday, play CPU-only rounds, then show the hub. */
  private afterDay(now: number): void {
    const s = this.s;
    const c = s.comp!;
    const idx = c.day;
    completeDay(c, this.humanIds());
    const played = [idx];
    if (!c.champion) played.push(...this.skipCpuDays());
    s.day = null;
    if (c.champion) {
      // on a time limit the result waits until every manager has watched their last match (or the limit runs out)
      if (!this.slow() || !this.anyUnseen()) return this.toResult(now);
      s.hub = { deadline: now + this.stageMs(HUB_SECONDS), ready: {}, played, final: true };
      s.phase = 'hub';
      this.bump(now);
      return;
    }
    s.hub = { deadline: now + this.stageMs(HUB_SECONDS), ready: {}, played };
    if (this.windowDue()) return this.openWindow(now);
    s.phase = 'hub';
    this.bump(now);
  }

  private toResult(now: number): void {
    const s = this.s;
    const c = s.comp!;
    const champ = c.champion;
    const isHuman = !!champ && this.humans().some((h) => h.id === champ);
    // it is over: nothing stays sealed
    for (const d of c.days) for (const f of d.fixtures) if (f.unseen?.length) f.unseen = [];
    let summary: string;
    if (c.kind === 'match') {
      const f = c.days[0]!.fixtures[0]!;
      const pens = f.lite?.pens ? ` (${f.lite.pens[0]}-${f.lite.pens[1]} pens)` : '';
      summary = `${this.teamOf(f.a)} ${f.lite?.score[0]}-${f.lite?.score[1]} ${this.teamOf(f.b)}${pens}`;
    } else {
      summary = champ ? `${this.teamOf(champ)} won the ${COMPETITIONS[c.kind].name.toLowerCase()}` : 'No champion';
    }
    s.series.games += 1;
    if (isHuman && champ) s.series.wins[champ] = (s.series.wins[champ] ?? 0) + 1;
    s.series.log.push({ game: s.game, winner: isHuman ? champ : null, summary });
    if (s.series.log.length > 30) s.series.log.shift();
    s.phase = 'result';
    s.day = null;
    s.hub = null;
    s.setup = null;
    s.window = null;
    s.rematch = {};
    this.bump(now);
  }

  private backToLobby(now: number): void {
    const s = this.s;
    s.phase = 'lobby';
    s.draft = null;
    s.setup = null;
    s.comp = null;
    s.day = null;
    s.hub = null;
    s.window = null;
    s.windowDone = false;
    s.lastWindow = [];
    s.squads = {};
    s.rematch = {};
    s.seats = s.seats.filter((x) => !x.bot);
    for (const x of s.seats.filter((x) => !x.connected)) this.removeSeat(x.id);
    s.settings = fitSettings(s.settings, Math.max(1, this.humans().length));
    this.bump(now);
  }

  /* ───────────── time ───────────── */

  /** Applies every timer that has expired. Returns true if state changed. */
  tick(now: number): boolean {
    let changed = false;
    for (let guard = 0; guard < 400; guard++) {
      if (!this.tickOnce(now)) break;
      changed = true;
    }
    return changed;
  }

  private tickOnce(now: number): boolean {
    const s = this.s;
    const humans = this.humans();
    if (this.freezes() && this.nobodyHere()) return false;
    switch (s.phase) {
      case 'draft': {
        const d = s.draft;
        if (!d) return false;
        if (d.spot) return this.spotTimeout(now);
        for (const seat of this.owing()) {
          // nothing left to choose from (a pool spent down to nothing): skip the seat now, do not wait for a timer that may be off
          if (!d.shared && d.offers?.[seat.id]?.length === 0 && (d.boards[seat.id] ?? []).length === 0) {
            this.autoPickFor(seat.id, now);
            return true;
          }
          const dl = this.seatDeadline(seat.id);
          if (dl !== null && now >= dl + GRACE_MS) {
            this.autoPickFor(seat.id, now);
            return true;
          }
        }
        return false;
      }
      case 'setup': {
        const st = s.setup;
        if (!st) return false;
        const everyoneReady = humans.every((x) => this.gone(x, now) || st.ready[x.id]);
        if (everyoneReady || now >= st.deadline) {
          this.startCompetition(now);
          return true;
        }
        return false;
      }
      case 'match': {
        const d = s.day;
        if (!d) return false;
        const allSeen = humans.every((x) => this.gone(x, now) || d.seen[x.id]);
        if ((allSeen && now >= d.startedAt) || now >= d.deadline) {
          this.afterDay(now);
          return true;
        }
        return false;
      }
      case 'window': {
        const w = s.window;
        if (!w) return false;
        const late = w.deadline !== null && now >= w.deadline;
        if (w.turn >= 0) {
          const id = w.order[w.turn];
          const seat = humans.find((x) => x.id === id);
          if (!id || !seat) { this.closeWindow(now); return true; }
          if (late || this.gone(seat, now)) { w.seats[id]!.stage = 'done'; this.windowAdvance(now); return true; }
          return false;
        }
        if (late) { for (const x of Object.values(w.seats)) x.stage = 'done'; this.closeWindow(now); return true; }
        return false;
      }
      case 'hub': {
        const h = s.hub;
        if (!h) return false;
        if (h.final) {
          if (!this.anyUnseen() || now >= h.deadline) { this.toResult(now); return true; }
          return false;
        }
        const everyoneReady = humans.every((x) => this.gone(x, now) || h.ready[x.id]);
        if (everyoneReady || now >= h.deadline) {
          this.beginHumanDay(now);
          return true;
        }
        return false;
      }
      case 'result': {
        const connected = humans.filter((x) => x.connected);
        if (connected.length >= 1 && connected.every((x) => s.rematch[x.id])) {
          this.startDraft(now);
          return true;
        }
        return this.housekeeping(now);
      }
      case 'lobby':
        return this.housekeeping(now);
      default:
        return false;
    }
  }

  /** host hand-over and ghost clean-up */
  private housekeeping(now: number): boolean {
    const s = this.s;
    const host = s.seats.find((x) => x.id === s.hostId);
    if (!host || (!host.connected && now - host.droppedAt >= HOST_MIGRATE_MS)) {
      const next = s.seats.find((x) => x.connected && !x.bot);
      if (next && next.id !== s.hostId) {
        s.hostId = next.id;
        this.bump(now);
        return true;
      }
    }
    if (s.phase === 'lobby') {
      const ghost = s.seats.find((x) => !x.connected && now - x.droppedAt >= LOBBY_GHOST_MS);
      if (ghost) {
        this.removeSeat(ghost.id);
        this.bump(now);
        return true;
      }
    }
    return false;
  }

  /** Earliest moment something needs to happen, so the host environment can set an alarm. */
  nextWake(now: number): number | null {
    const s = this.s;
    const cands: number[] = [];
    const add = (t: number | null | undefined) => {
      if (typeof t === 'number' && Number.isFinite(t)) cands.push(t);
    };
    const paused = this.freezes() && this.nobodyHere();
    if (!paused && !this.slow() && (s.phase === 'setup' || s.phase === 'match' || s.phase === 'hub' || s.phase === 'window')) {
      for (const x of this.humans()) if (!x.connected) add(x.droppedAt + DROP_GRACE_MS);
    }
    switch (paused ? 'paused' : s.phase) {
      case 'draft': {
        const d = s.draft;
        if (d) {
          for (const seat of this.owing()) {
            const dl = this.seatDeadline(seat.id);
            if (dl !== null) add(dl + GRACE_MS);
          }
          add(d.spot?.stealUntil);
        }
        break;
      }
      case 'window':
        add(s.window?.deadline);
        break;
      case 'setup':
        add(s.setup?.deadline);
        break;
      case 'match':
        add(s.day?.deadline);
        if (s.day) add(s.day.startedAt);
        break;
      case 'hub':
        add(s.hub?.deadline);
        break;
      default:
        break;
    }
    const host = s.seats.find((x) => x.id === s.hostId);
    // only when someone else is there to take over; otherwise this moment passes and never resolves
    if (host && !host.connected && s.seats.some((x) => x.connected && !x.bot)) add(host.droppedAt + HOST_MIGRATE_MS);
    if (s.phase === 'lobby') for (const x of s.seats) if (!x.connected) add(x.droppedAt + LOBBY_GHOST_MS);
    add(this.expiresAt(now));
    // tick() has already run by now, so a moment in the past is one nothing can act on: waking for it would spin
    const ahead = cands.filter((t) => t > now);
    if (ahead.length === 0) return null;
    return Math.max(now + 50, Math.min(...ahead));
  }

  /** When the room should be deleted if nothing happens. */
  expiresAt(_now: number): number {
    const s = this.s;
    const humans = this.humans();
    const anyConnected = humans.some((x) => x.connected);
    // a league on a time limit is meant to be left alone for days
    const slow = this.slow() && s.phase !== 'lobby';
    const abandoned = anyConnected ? Infinity : Math.max(s.lastActive, ...humans.map((x) => x.droppedAt)) + (slow ? SLOW_ABANDONED_MS : ROOM_ABANDONED_MS);
    return Math.min(abandoned, s.createdAt + (slow ? SLOW_MAX_AGE_MS : ROOM_MAX_AGE_MS));
  }

  isExpired(now: number): boolean {
    return now >= this.expiresAt(now);
  }

  /* ───────────── views ───────────── */

  view(forId: string, now: number): RoomView {
    const s = this.s;
    const rosters: Record<string, string[]> = {};
    for (const seat of s.seats) {
      const sq = s.squads[seat.id];
      rosters[seat.id] = sq ? (Object.values(sq.slots).filter((x): x is string => !!x)) : [];
    }
    const squads: RoomView['squads'] = {};
    const revealAll = s.phase === 'draft' || s.phase === 'match' || s.phase === 'hub' || s.phase === 'window' || s.phase === 'result';
    for (const seat of s.seats) {
      const sq = s.squads[seat.id];
      if (!sq) continue;
      if (revealAll || seat.id === forId) squads[seat.id] = sq;
    }
    let draft: RoomView['draft'] = null;
    if (s.draft) {
      const d: DraftState = s.draft;
      draft = {
        round: d.round,
        deadline: d.deadline,
        shared: d.shared,
        turns: !!d.turns,
        // take-turns: everyone sees the pack of whoever is up, so the other player can watch the draft happen
        board: d.shared || d.spot ? d.board : d.turns ? (d.boards[d.order[d.turn]!] ?? []) : (d.boards[forId] ?? []),
        // only the clues on the packs, never what is inside the ones that stay sealed
        packs: d.shared || d.spot ? undefined : d.offers?.[d.turns ? d.order[d.turn]! : forId]?.map((o) => o.clue),
        opened: d.shared || d.spot ? undefined : (d.opened?.[d.turns ? d.order[d.turn]! : forId] ?? null),
        order: d.order,
        turn: d.turn,
        picked: d.picked,
        log: d.log.slice(-24),
      };
      if (d.spot) {
        const sp = d.spot;
        draft.spot = {
          seat: sp.queue[sp.i] ?? '',
          stage: sp.stage,
          // the sealed packs are identical to everyone, their owner included: only how many there are is sent
          packs: sp.stage === 'choose' ? sp.packs.length : 0,
          opened: sp.opened,
          stealUntil: sp.stealUntil,
          stolen: sp.stolen,
          steals: sp.steals,
          owed: sp.owed,
          canSteal: this.canSteal(forId) && sp.stealUntil !== null && now < sp.stealUntil,
          missed: sp.missed,
          done: sp.i,
          total: sp.queue.length,
        };
      }
    }
    let window: WindowView | null = null;
    if (s.window) {
      const w = s.window;
      const seats: Record<string, WindowSeat> = {};
      for (const id of w.order) {
        const x = w.seats[id]!;
        // played live, everyone watches the pack being opened; on a time limit a manager's pack is their own until they are done
        seats[id] = w.turn >= 0 || id === forId || x.stage === 'done' ? x : { stage: x.stage, board: [], others: [], signed: null };
      }
      const me = w.seats[forId];
      window = { order: w.order, turn: w.turn, deadline: w.deadline, seats, signings: w.signings, yourMove: !!me && me.stage !== 'done' && (w.turn === -1 || w.order[w.turn] === forId) };
    }
    return {
      code: s.code,
      rev: s.rev,
      now,
      you: forId,
      phase: s.phase,
      game: s.game,
      hostId: s.hostId,
      settings: s.settings,
      seats: s.seats,
      draft,
      rosters,
      squads,
      setup: s.setup,
      comp: this.compFor(forId),
      day: s.day,
      hub: s.hub,
      series: s.series,
      rematch: s.rematch,
      window,
      lastWindow: s.lastWindow,
      replay: s.phase === 'match' ? null : this.unseenOf(forId),
    };
  }

  private bump(now: number): void {
    this.s.rev++;
    this.s.lastActive = now;
  }
}

/** Not part of the engine contract; used by tests to build deterministic ids and seeds. */
export function testDeps(prefix = 't'): Deps {
  let n = 0;
  return {
    seed: () => `${prefix}-seed-${++n}`,
    token: () => {
      const r = new Rng(`${prefix}-token-${++n}`);
      return Array.from({ length: 16 }, () => r.int(256).toString(16).padStart(2, '0')).join('');
    },
  };
}

export { FORMATIONS };
export type { FormationId };
