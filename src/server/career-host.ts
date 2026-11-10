// Runtime-agnostic league host. It owns authorisation, validation, rate-limiting and persistence for one career league,
// and nothing about Cloudflare, so it runs unchanged in tests. The Durable Object is a thin shell around it.
//
// Identity: the worker verifies the sign-in cookie and passes an account id. Inside a league a manager is only an opaque
// member handle (m0-xxxxxx); the mapping handle -> account lives here and is never put in a view.

import { getWorld } from '../shared/career/data';
import { type IndexedWorld } from '../shared/career/world';
import {
  createCareer, draftPick, joinCareer, lastMatch, nextWake, setAuto, setLineup, setReady, setSettings, startCareer, tick, viewFor, windowPlan, windowReady,
  type CareerState, type CareerView, type HumanMatch, type Result,
} from '../shared/career/engine';
import { randomId } from './auth';
import { parseAct } from './career-schema';

export interface Stored { st: CareerState; accountOf: Record<string, string>; touched: number }

export interface CareerIO {
  now(): number;
  load(): Promise<Stored | null>;
  save(s: Stored): Promise<void>;
  schedule(at: number | null): Promise<void>;
  destroy(): Promise<void>;
}

export type Reply = { ok: true; view: CareerView | null; joined?: string } | { ok: false; code: string; msg: string; status: number };

const EXPIRE_AFTER = 120 * 86_400_000;
const err = (code: string, msg: string, status = 400): Reply => ({ ok: false, code, msg, status });
const fromResult = (r: Result): Reply | null => (r.ok ? null : err(r.code, r.msg));

export class CareerHost {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private cur: Stored, private io: CareerIO, private world: IndexedWorld = getWorld()) {}

  static async create(code: string, seed: string, io: CareerIO, world: IndexedWorld = getWorld()): Promise<CareerHost> {
    const now = io.now();
    const h = new CareerHost({ st: createCareer(world, code, seed, now), accountOf: {}, touched: now }, io, world);
    await h.commit();
    return h;
  }
  static async load(io: CareerIO, world: IndexedWorld = getWorld()): Promise<CareerHost | null> {
    const s = await io.load();
    return s ? new CareerHost(s, io, world) : null;
  }

  get state(): CareerState { return this.cur.st; }

  private memberOf(account: string | null): string | null {
    if (!account) return null;
    return Object.keys(this.cur.accountOf).find((m) => this.cur.accountOf[m] === account) ?? null;
  }
  private owner(): string | null { return this.cur.st.members[0]?.id ?? null; }

  /** Persist and arm the next alarm. Every mutation ends here. */
  private async commit(touch = true): Promise<void> {
    if (touch) this.cur.touched = this.io.now();
    await this.io.save(this.cur);
    const wake = nextWake(this.cur.st);
    const expire = this.cur.touched + EXPIRE_AFTER;
    await this.io.schedule(wake !== null ? Math.min(wake, expire) : expire);
  }

  private limited(account: string): boolean {
    const now = this.io.now();
    const b = this.buckets.get(account) ?? { tokens: 20, at: now };
    b.tokens = Math.min(20, b.tokens + ((now - b.at) / 1000) * 2); // 2 actions a second, bursts of 20
    b.at = now;
    this.buckets.set(account, b);
    if (this.buckets.size > 200) this.buckets.clear();
    if (b.tokens < 1) return true;
    b.tokens -= 1;
    return false;
  }

  /** The caller's view. `since` lets a polling client skip an unchanged state. */
  async view(account: string | null, since?: number): Promise<{ rev: number; view: CareerView | null }> {
    const now = this.io.now();
    const member = this.memberOf(account) !== null;
    if (tick(this.world, this.cur.st, now)) await this.commit(member);
    else if (member && now - this.cur.touched > 3_600_000) await this.commit(true); // a manager looking in counts as a visit
    const rev = this.cur.st.rev;
    if (since !== undefined && since === rev) return { rev, view: null };
    return { rev, view: viewFor(this.world, this.cur.st, this.memberOf(account)) };
  }

  async match(account: string | null): Promise<HumanMatch | null> {
    const m = this.memberOf(account);
    return m ? lastMatch(this.cur.st, m) : null;
  }

  async act(account: string, raw: unknown): Promise<Reply> {
    if (this.limited(account)) return err('rate_limited', 'Slow down a little.', 429);
    const a = parseAct(raw);
    if (!a) return err('bad_request', 'That request was not understood.');
    const { st } = this.cur;
    const now = this.io.now();
    tick(this.world, st, now);
    const member = this.memberOf(account);
    let joined: string | undefined;
    let r: Reply | null = null;

    if (a.t === 'join') {
      if (member) return err('joined', 'You are already in this league.');
      const memberId = `m${st.members.length}-${randomId(6)}`;
      r = fromResult(joinCareer(this.world, st, { memberId, name: a.name, choice: a.choice, badge: a.badge }));
      if (!r) { this.cur.accountOf[memberId] = account; joined = memberId; }
    } else if (!member) {
      return err('not_member', 'Join this league first.', 403);
    } else switch (a.t) {
      case 'settings':
        r = member !== this.owner() ? err('owner_only', 'Only the person who made the league can change this.', 403) : fromResult(setSettings(st, a.patch));
        break;
      case 'start':
        r = member !== this.owner() ? err('owner_only', 'Only the person who made the league can start it.', 403) : fromResult(startCareer(this.world, st, now));
        break;
      case 'pick': r = fromResult(draftPick(this.world, st, member, a.player, now)); break;
      case 'lineup': r = fromResult(setLineup(this.world, st, member, { formation: a.formation, style: a.style, slots: a.slots })); break;
      case 'ready': r = fromResult(setReady(this.world, st, member, a.ready, now)); break;
      case 'auto': r = fromResult(setAuto(st, member, a.auto)); break;
      case 'plan': r = fromResult(windowPlan(this.world, st, member, a.swaps)); break;
      case 'windowReady': r = fromResult(windowReady(this.world, st, member, a.ready, now)); break;
    }
    if (r) return r;
    tick(this.world, st, now);
    await this.commit();
    return { ok: true, view: viewFor(this.world, st, this.memberOf(account)), joined };
  }

  /** The alarm: move on whatever is due. Returns true if the league should be deleted (abandoned). */
  async onAlarm(): Promise<boolean> {
    const now = this.io.now();
    if (now - this.cur.touched > EXPIRE_AFTER) {
      await this.io.destroy();
      return true;
    }
    const changed = tick(this.world, this.cur.st, now);
    if (changed) { await this.io.save(this.cur); }
    const wake = nextWake(this.cur.st);
    await this.io.schedule(wake !== null ? Math.min(wake, this.cur.touched + EXPIRE_AFTER) : this.cur.touched + EXPIRE_AFTER);
    return false;
  }
}
