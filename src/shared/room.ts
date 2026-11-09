// The whole multiplayer game as a pure state machine with an injected clock.
// The Cloudflare Durable Object and the Node dev server are thin adapters around this class,
// so every rule (turns, timers, AFK, reconnect) is unit-testable without any network.

import { ROUNDS, autoPick, boardSize, dealBoard, openRoles, placePlayer } from './draft';
import { FORMATIONS, FORMATION_IDS, type FormationId } from './formations';
import { PLAYER_BY_ID } from './players';
import { Rng, randomSeed, randomToken } from './rng';
import { playbackSchedule, simulateMatch } from './sim';
import { STYLES, autoArrange, changeFormation, emptySquad, swapSlots, type Squad } from './squad';
import {
  DEFAULT_SETTINGS,
  MAX_SEATS,
  MIN_SEATS,
  PICK_SECONDS,
  SEAT_HUES,
  type C2S,
  type DraftState,
  type ErrorCode,
  type Fixture,
  type RoomState,
  type RoomView,
  type Seat,
  type Settings,
} from './protocol';

/** Picks that arrive this late after the timer still count (network latency). */
export const GRACE_MS = 700;
/** A dropped player gets this long to come back before the room auto-picks for them. */
export const AFK_GRACE_MS = 8000;
export const SETUP_SECONDS = 75;
export const HOST_MIGRATE_MS = 20_000;
export const LOBBY_GHOST_MS = 120_000;
/** Nobody connected for this long: the room is garbage. */
export const ROOM_ABANDONED_MS = 45 * 60_000;
/** Hard cap on room lifetime regardless of activity. */
export const ROOM_MAX_AGE_MS = 12 * 3600_000;

export interface Deps {
  seed: () => string;
  token: () => string;
}
export const defaultDeps: Deps = { seed: randomSeed, token: randomToken };

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode; msg: string };
const fail = (code: ErrorCode, msg: string): { ok: false; code: ErrorCode; msg: string } => ({ ok: false, code, msg });
const OK = { ok: true } as const;

export function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || 'Player';
}

export function roundRobin(ids: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i]!, ids[j]!]);
  return out;
}

export interface TableRow {
  id: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

export function standings(fixtures: Fixture[], ids: string[]): TableRow[] {
  const rows = new Map<string, TableRow>(ids.map((id) => [id, { id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const f of fixtures) {
    const a = rows.get(f.a);
    const b = rows.get(f.b);
    if (!a || !b) continue;
    const [ga, gb] = f.result.score;
    a.played++; b.played++;
    a.gf += ga; a.ga += gb; b.gf += gb; b.ga += ga;
    if (f.result.winner === 0) { a.w++; b.l++; a.pts += 3; }
    else if (f.result.winner === 1) { b.w++; a.l++; b.pts += 3; }
    else { a.d++; b.d++; a.pts++; b.pts++; }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf);
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
        v: 1,
        code,
        rev: 0,
        createdAt: now,
        lastActive: now,
        phase: 'lobby',
        hostId: '',
        settings: { ...DEFAULT_SETTINGS },
        seats: [],
        secrets: {},
        game: 0,
        seed: '',
        draft: null,
        squads: {},
        setup: null,
        match: null,
        series: { wins: {}, games: 0, log: [] },
        rematch: {},
      },
      deps,
    );
  }

  /* ───────────── membership ───────────── */

  join(msg: { id?: string; secret?: string; name: string }, now: number): Result<{ id: string; secret: string }> {
    const s = this.s;
    if (msg.id) {
      const seat = s.seats.find((x) => x.id === msg.id);
      if (seat) {
        if (!msg.secret || s.secrets[seat.id] !== msg.secret) return fail('bad_secret', 'That seat belongs to someone else.');
        this.setConnected(seat.id, true, now);
        return { ok: true, id: seat.id, secret: s.secrets[seat.id]! };
      }
    }
    if (s.phase !== 'lobby') return fail('in_progress', 'This game has already started.');
    if (s.seats.length >= MAX_SEATS) return fail('room_full', 'This room is full.');
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
    const seat: Seat = { id, name, hue: hue < 0 ? 0 : hue, connected: true, droppedAt: 0, formation: '433' };
    s.seats.push(seat);
    s.secrets[id] = secret;
    if (!s.hostId) s.hostId = id;
    this.bump(now);
    return { ok: true, id, secret };
  }

  setConnected(id: string, connected: boolean, now: number): void {
    const seat = this.s.seats.find((x) => x.id === id);
    if (!seat || seat.connected === connected) return;
    seat.connected = connected;
    seat.droppedAt = connected ? 0 : now;
    this.bump(now);
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
    delete s.squads[id];
    delete s.rematch[id];
    if (s.hostId === id) s.hostId = s.seats.find((x) => x.connected)?.id ?? s.seats[0]?.id ?? '';
  }

  /* ───────────── message handling ───────────── */

  handle(id: string, msg: C2S, now: number): Result {
    this.tick(now);
    const s = this.s;
    const seat = s.seats.find((x) => x.id === id);
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
        if (s.phase !== 'lobby') return fail('wrong_phase', 'Settings are locked once the draft starts.');
        const p = msg.patch ?? {};
        const next: Settings = { ...s.settings };
        if (p.format !== undefined) {
          if (p.format !== 'duel' && p.format !== 'packs') return fail('bad_message', 'Unknown draft format.');
          next.format = p.format;
        }
        if (p.pool !== undefined) {
          if (p.pool !== 'modern' && p.pool !== 'legends' && p.pool !== 'all') return fail('bad_message', 'Unknown pool.');
          next.pool = p.pool;
        }
        if (p.ratings !== undefined) {
          if (p.ratings !== 'hidden' && p.ratings !== 'tier' && p.ratings !== 'full') return fail('bad_message', 'Unknown rating mode.');
          next.ratings = p.ratings;
        }
        if (p.pickSeconds !== undefined) {
          if (!(PICK_SECONDS as readonly number[]).includes(p.pickSeconds)) return fail('bad_message', 'Unknown timer.');
          next.pickSeconds = p.pickSeconds;
        }
        s.settings = next;
        this.bump(now);
        return OK;
      }
      case 'formation': {
        if (!FORMATION_IDS.includes(msg.formation)) return fail('bad_message', 'Unknown formation.');
        if (s.phase === 'lobby') {
          seat.formation = msg.formation;
        } else if (s.phase === 'setup' && s.setup && s.squads[id]) {
          s.squads[id] = changeFormation(s.squads[id]!, msg.formation);
          s.setup.ready[id] = false;
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
        if (s.seats.length < MIN_SEATS) return fail('need_players', 'Waiting for at least one more player.');
        this.startDraft(now);
        return OK;
      }
      case 'pick':
        return this.pick(id, msg.round, msg.card, msg.slot, now);
      case 'swap': {
        if (s.phase !== 'setup' || !s.setup || !s.squads[id]) return fail('wrong_phase', 'Lineups are locked.');
        const a = s.squads[id]!;
        const b = swapSlots(a, msg.a, msg.b);
        if (b === a) return fail('bad_slot', 'Unknown slot.');
        s.squads[id] = b;
        s.setup.ready[id] = false;
        this.bump(now);
        return OK;
      }
      case 'arrange': {
        if (s.phase !== 'setup' || !s.setup || !s.squads[id]) return fail('wrong_phase', 'Lineups are locked.');
        s.squads[id] = autoArrange(s.squads[id]!);
        s.setup.ready[id] = false;
        this.bump(now);
        return OK;
      }
      case 'style': {
        if (s.phase !== 'setup' || !s.setup || !s.squads[id]) return fail('wrong_phase', 'Lineups are locked.');
        if (!(msg.style in STYLES)) return fail('bad_message', 'Unknown style.');
        s.squads[id] = { ...s.squads[id]!, style: msg.style };
        s.setup.ready[id] = false;
        this.bump(now);
        return OK;
      }
      case 'ready': {
        if (s.phase !== 'setup' || !s.setup) return fail('wrong_phase', 'Nothing to confirm right now.');
        s.setup.ready[id] = !!msg.ready;
        this.bump(now);
        this.tick(now);
        return OK;
      }
      case 'seen': {
        if (s.phase !== 'match' || !s.match) return OK;
        s.match.seen[id] = true;
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

  private uniqueName(name: string, selfId: string): string {
    const taken = new Set(this.s.seats.filter((x) => x.id !== selfId).map((x) => x.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`.toLowerCase())) n++;
    return `${name} ${n}`;
  }

  /* ───────────── draft ───────────── */

  private startDraft(now: number): void {
    const s = this.s;
    s.game += 1;
    s.seed = this.deps.seed();
    s.squads = {};
    for (const seat of s.seats) s.squads[seat.id] = emptySquad(seat.formation);
    s.setup = null;
    s.match = null;
    s.rematch = {};
    s.phase = 'draft';
    s.draft = {
      round: 0,
      deadline: null,
      shared: s.settings.format === 'duel',
      board: [],
      boards: {},
      order: [],
      turn: 0,
      picked: [],
      taken: [],
      log: [],
    };
    this.dealRound(now, 1);
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
    const ids = s.seats.map((x) => x.id);
    const n = ids.length;
    d.round = round;
    d.picked = [];
    d.turn = 0;
    if (d.shared) {
      const needs = ids.map((id) => openRoles(s.squads[id]!).map((o) => o.role));
      d.board = dealBoard({
        seed: s.seed, pool: s.settings.pool, round, key: 'shared',
        size: boardSize('duel', n), taken: new Set(d.taken), needs,
      });
      const rot = (s.game - 1) % n;
      const base = ids.slice(rot).concat(ids.slice(0, rot));
      d.order = round % 2 === 1 ? base : base.slice().reverse();
    } else {
      d.boards = {};
      for (const id of ids) {
        const sq = s.squads[id]!;
        d.boards[id] = dealBoard({
          seed: s.seed, pool: s.settings.pool, round, key: id,
          size: boardSize('packs', n),
          taken: new Set(Object.values(sq.slots).filter((x): x is string => !!x)),
          needs: [openRoles(sq).map((o) => o.role)],
        });
      }
      d.order = ids;
    }
    d.deadline = this.turnDeadline(now, round === 1);
  }

  /** The deadline that applies to one seat right now (AFK seats are cut short). */
  private seatDeadline(seatId: string): number | null {
    const d = this.s.draft;
    if (!d) return null;
    const seat = this.s.seats.find((x) => x.id === seatId);
    let dl = d.deadline;
    if (seat && !seat.connected) {
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
    let board: string[];
    if (d.shared) {
      if (d.order[d.turn] !== id) return fail('not_your_turn', 'Not your turn yet.');
      board = d.board;
    } else {
      if (d.picked.includes(id)) return fail('not_your_turn', 'You already picked this round.');
      board = d.boards[id] ?? [];
    }
    if (!board.includes(card) || !PLAYER_BY_ID.has(card)) return fail('bad_card', 'That card is not on the board.');
    const sq = s.squads[id];
    if (!sq || !(slot in sq.slots) || sq.slots[slot]) return fail('bad_slot', 'That position is already filled.');
    this.applyPick(id, card, slot, false, now);
    return OK;
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
    } else if (d.picked.length >= s.seats.length) {
      this.finishRound(now);
    }
    this.bump(now);
  }

  private finishRound(now: number): void {
    const d = this.s.draft!;
    if (d.round >= ROUNDS) this.toSetup(now);
    else this.dealRound(now, d.round + 1);
  }

  private autoPickFor(id: string, now: number): void {
    const s = this.s;
    const d = s.draft!;
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
      } else if (d.picked.length >= s.seats.length) this.finishRound(now);
      this.bump(now);
      return;
    }
    this.applyPick(id, choice.cardId, choice.slotId, true, now);
  }

  /* ───────────── setup, match, result ───────────── */

  private toSetup(now: number): void {
    const s = this.s;
    s.phase = 'setup';
    s.draft = null;
    s.setup = { deadline: now + SETUP_SECONDS * 1000, ready: {} };
  }

  private startMatches(now: number): void {
    const s = this.s;
    const ids = s.seats.map((x) => x.id);
    const knockout = ids.length === 2;
    const pairs = knockout ? ([[ids[0]!, ids[1]!]] as Array<[string, string]>) : roundRobin(ids);
    const nameOf = (id: string) => s.seats.find((x) => x.id === id)?.name ?? '???';
    const fixtures: Fixture[] = pairs.map(([a, b], i) => {
      const names: [string, string] = [nameOf(a), nameOf(b)];
      return { a, b, names, result: simulateMatch(s.squads[a]!, s.squads[b]!, names, `${s.seed}/m/${i}`, { knockout }) };
    });
    let total = 0;
    for (const f of fixtures) total += playbackSchedule(f.result).totalMs + 4000;
    s.match = { startedAt: now + 3000, knockout, fixtures, seen: {}, deadline: now + 3000 + total + 25_000 };
    s.setup = null;
    s.phase = 'match';
    this.bump(now);
  }

  private toResult(now: number): void {
    const s = this.s;
    const m = s.match!;
    const ids = s.seats.map((x) => x.id);
    let winner: string | null = null;
    let summary = '';
    const nameOf = (id: string) => s.seats.find((x) => x.id === id)?.name ?? '???';
    if (m.knockout) {
      const f = m.fixtures[0]!;
      winner = f.result.winner === null ? null : f.result.winner === 0 ? f.a : f.b;
      const pens = f.result.pens ? ` (${f.result.pens[0]}-${f.result.pens[1]} pens)` : '';
      summary = `${f.names[0]} ${f.result.score[0]}-${f.result.score[1]} ${f.names[1]}${pens}`;
    } else {
      const table = standings(m.fixtures, ids);
      const [t0, t1] = table;
      const tie = !!t0 && !!t1 && t0.pts === t1.pts && t0.gf - t0.ga === t1.gf - t1.ga && t0.gf === t1.gf;
      winner = tie || !t0 ? null : t0.id;
      summary = winner ? `${nameOf(winner)} won the table on ${t0!.pts} pts` : 'Dead heat at the top';
    }
    s.series.games += 1;
    if (winner) s.series.wins[winner] = (s.series.wins[winner] ?? 0) + 1;
    s.series.log.push({ game: s.game, winner, summary });
    if (s.series.log.length > 30) s.series.log.shift();
    s.phase = 'result';
    s.rematch = {};
    this.bump(now);
  }

  private backToLobby(now: number): void {
    const s = this.s;
    s.phase = 'lobby';
    s.draft = null;
    s.setup = null;
    s.match = null;
    s.squads = {};
    s.rematch = {};
    for (const x of s.seats.filter((x) => !x.connected)) this.removeSeat(x.id);
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
    switch (s.phase) {
      case 'draft': {
        const d = s.draft;
        if (!d) return false;
        if (d.shared) {
          const id = d.order[d.turn];
          if (!id) return false;
          const dl = this.seatDeadline(id);
          if (dl !== null && now >= dl + GRACE_MS) {
            this.autoPickFor(id, now);
            return true;
          }
          return false;
        }
        for (const seat of s.seats) {
          if (d.picked.includes(seat.id)) continue;
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
        const everyoneReady = s.seats.every((x) => !x.connected || st.ready[x.id]);
        if (everyoneReady || now >= st.deadline) {
          this.startMatches(now);
          return true;
        }
        return false;
      }
      case 'match': {
        const m = s.match;
        if (!m) return false;
        const allSeen = s.seats.every((x) => !x.connected || m.seen[x.id]);
        if ((allSeen && now >= m.startedAt) || now >= m.deadline) {
          this.toResult(now);
          return true;
        }
        return false;
      }
      case 'result': {
        const connected = s.seats.filter((x) => x.connected);
        if (connected.length >= MIN_SEATS && connected.every((x) => s.rematch[x.id])) {
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
      const next = s.seats.find((x) => x.connected);
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
    switch (s.phase) {
      case 'draft': {
        const d = s.draft;
        if (d) {
          if (d.shared) {
            const id = d.order[d.turn];
            if (id) {
              const dl = this.seatDeadline(id);
              if (dl !== null) add(dl + GRACE_MS);
            }
          } else {
            for (const seat of s.seats) {
              if (d.picked.includes(seat.id)) continue;
              const dl = this.seatDeadline(seat.id);
              if (dl !== null) add(dl + GRACE_MS);
            }
          }
        }
        break;
      }
      case 'setup':
        add(s.setup?.deadline);
        break;
      case 'match':
        add(s.match?.deadline);
        if (s.match) add(s.match.startedAt);
        break;
      default:
        break;
    }
    const host = s.seats.find((x) => x.id === s.hostId);
    if (host && !host.connected) add(host.droppedAt + HOST_MIGRATE_MS);
    if (s.phase === 'lobby') for (const x of s.seats) if (!x.connected) add(x.droppedAt + LOBBY_GHOST_MS);
    add(this.expiresAt(now));
    if (cands.length === 0) return null;
    return Math.max(now + 50, Math.min(...cands));
  }

  /** When the room should be deleted if nothing happens. */
  expiresAt(_now: number): number {
    const s = this.s;
    const anyConnected = s.seats.some((x) => x.connected);
    const abandoned = anyConnected ? Infinity : Math.max(s.lastActive, ...s.seats.map((x) => x.droppedAt)) + ROOM_ABANDONED_MS;
    return Math.min(abandoned, s.createdAt + ROOM_MAX_AGE_MS);
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
    const squads: Record<string, Squad> = {};
    const revealAll = s.phase === 'draft' || s.phase === 'match' || s.phase === 'result';
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
        board: d.shared ? d.board : (d.boards[forId] ?? []),
        order: d.order,
        turn: d.turn,
        picked: d.picked,
        log: d.log.slice(-24),
      };
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
      match: s.match,
      series: s.series,
      rematch: s.rematch,
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
