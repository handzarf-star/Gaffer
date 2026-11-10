// Runtime-agnostic room host. It owns validation, rate-limiting, reconnect takeover and broadcasting,
// and talks to the outside world through a tiny IO interface, so the exact same code runs inside a
// Cloudflare Durable Object and inside the plain Node dev server.

import { EMOTES, type ErrorCode, type RoomState, type S2C } from '../shared/protocol';
import { RoomEngine } from '../shared/room';
import { parseMessage } from './schema';

export interface Conn {
  /** the underlying socket object, used as a stable identity */
  readonly raw: object;
  getId(): string | null;
  setId(id: string | null): void;
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface HostIO {
  conns(): Conn[];
  now(): number;
  persist(state: RoomState): void | Promise<void>;
  schedule(at: number | null): void | Promise<void>;
  destroy(): void | Promise<void>;
  /** the build id this server is serving ("dev" when unknown) */
  build?(): string;
}

interface Bucket {
  tokens: number;
  at: number;
}

const BUCKET_MAX = 24;
const BUCKET_REFILL_PER_S = 12;

export class RoomHost {
  private buckets = new WeakMap<object, Bucket>();

  constructor(
    readonly engine: RoomEngine,
    private io: HostIO,
  ) {}

  /* ───────────── socket events ───────────── */

  async onMessage(conn: Conn, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    if (!this.allow(conn)) {
      this.send(conn, { t: 'err', code: 'rate_limited', msg: 'Slow down a little.' });
      return;
    }
    const msg = parseMessage(raw);
    if (!msg) {
      this.send(conn, { t: 'err', code: 'bad_message', msg: 'That message was not understood.' });
      return;
    }
    const now = this.io.now();
    this.reconcile(now);

    if (msg.t === 'hello') {
      if (msg.code !== this.engine.s.code) {
        this.fatal(conn, 'no_room', 'Wrong room.');
        return;
      }
      const r = this.engine.join({ id: msg.id, secret: msg.secret, name: msg.name }, now);
      if (!r.ok) {
        this.fatal(conn, r.code, r.msg);
        return;
      }
      // one live connection per seat: the newest wins (phone woke up, second tab, etc.)
      for (const other of this.io.conns()) {
        if (other.raw !== conn.raw && other.getId() === r.id) {
          other.setId(null);
          other.close(4001, 'replaced by a newer connection');
        }
      }
      conn.setId(r.id);
      this.send(conn, { t: 'welcome', id: r.id, secret: r.secret, now, build: this.io.build?.() ?? 'dev' });
      await this.changed(now);
      return;
    }

    const id = conn.getId();
    if (!id) {
      this.send(conn, { t: 'err', code: 'bad_secret', msg: 'Say hello first.' });
      return;
    }
    if (msg.t === 'emote') {
      if ((EMOTES as readonly string[]).includes(msg.e)) this.broadcast({ t: 'emote', from: id, e: msg.e });
      return;
    }
    const res = this.engine.handle(id, msg, now);
    if (!res.ok) this.send(conn, { t: 'err', code: res.code, msg: res.msg });
    await this.changed(now);
  }

  async onClose(conn: Conn): Promise<void> {
    const id = conn.getId();
    const now = this.io.now();
    this.reconcile(now);
    if (id) {
      const stillHere = this.io.conns().some((c) => c.raw !== conn.raw && c.getId() === id);
      if (!stillHere) this.engine.setConnected(id, false, now);
    }
    await this.changed(now);
  }

  async onAlarm(): Promise<void> {
    const now = this.io.now();
    this.reconcile(now);
    if (this.engine.isExpired(now)) {
      for (const c of this.io.conns()) c.close(4002, 'room expired');
      await this.io.destroy();
      return;
    }
    this.engine.tick(now);
    await this.changed(now);
  }

  /* ───────────── internals ───────────── */

  /** Make the seats' connected flags agree with the sockets that actually exist. */
  reconcile(now: number): void {
    const live = new Set(this.io.conns().map((c) => c.getId()).filter((x): x is string => !!x));
    for (const seat of this.engine.s.seats) {
      if (seat.connected !== live.has(seat.id)) this.engine.setConnected(seat.id, live.has(seat.id), now);
    }
  }

  async changed(now: number): Promise<void> {
    this.engine.tick(now);
    await this.io.persist(this.engine.s);
    await this.io.schedule(this.engine.nextWake(now));
    this.broadcastState(now);
  }

  broadcastState(now: number): void {
    for (const c of this.io.conns()) {
      const id = c.getId();
      if (!id) continue;
      this.send(c, { t: 'state', s: this.engine.view(id, now), now });
    }
  }

  private broadcast(msg: S2C): void {
    const data = JSON.stringify(msg);
    for (const c of this.io.conns()) if (c.getId()) this.trySend(c, data);
  }

  private send(conn: Conn, msg: S2C): void {
    this.trySend(conn, JSON.stringify(msg));
  }

  private trySend(conn: Conn, data: string): void {
    try {
      conn.send(data);
    } catch {
      /* a socket that is already closing must never take the room down */
    }
  }

  private fatal(conn: Conn, code: ErrorCode, msg: string): void {
    this.send(conn, { t: 'fatal', code, msg });
    try {
      conn.close(4000, code);
    } catch {
      /* ignore */
    }
  }

  private allow(conn: Conn): boolean {
    const now = Date.now();
    let b = this.buckets.get(conn.raw);
    if (!b) {
      b = { tokens: BUCKET_MAX, at: now };
      this.buckets.set(conn.raw, b);
    }
    b.tokens = Math.min(BUCKET_MAX, b.tokens + ((now - b.at) / 1000) * BUCKET_REFILL_PER_S);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
