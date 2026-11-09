import { useEffect, useState, useSyncExternalStore } from 'react';
import type { C2S, ErrorCode, RoomView, S2C } from '../../shared/protocol';
import { clearIdentity, getIdentity, getName, setIdentity } from './storage';

export type NetStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface NetState {
  status: NetStatus;
  view: RoomView | null;
  /** serverNow - Date.now(), refreshed on every message */
  offset: number;
  fatal: { code: ErrorCode; msg: string } | null;
  attempt: number;
}

type Listener = () => void;

const FATAL_NO_RETRY: ErrorCode[] = ['no_room', 'room_full', 'in_progress', 'bad_secret', 'kicked'];
const PING_EVERY = 12_000;
const DEAD_AFTER = 26_000;

/**
 * One resilient connection to one room. Designed for phones: sockets die when the screen locks,
 * the network flips between wifi and 4G, or a tab sleeps. It reconnects with backoff, re-identifies
 * with its saved seat, notices dead connections via a heartbeat, and reconnects the moment the tab wakes up.
 */
export class RoomConnection {
  state: NetState = { status: 'connecting', view: null, offset: 0, fatal: null, attempt: 0 };
  onError: (code: ErrorCode, msg: string) => void = () => undefined;
  onEmote: (from: string, e: string) => void = () => undefined;

  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  private stopped = true;

  constructor(readonly code: string) {}

  /* ───────────── store plumbing ───────────── */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): NetState => this.state;

  private set(patch: Partial<NetState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  serverNow(): number {
    return Date.now() + this.state.offset;
  }

  /* ───────────── lifecycle ───────────── */

  connect(): void {
    this.stopped = false;
    window.addEventListener('online', this.wake);
    window.addEventListener('focus', this.wake);
    document.addEventListener('visibilitychange', this.onVisible);
    this.open();
  }

  close(): void {
    this.stopped = true;
    window.removeEventListener('online', this.wake);
    window.removeEventListener('focus', this.wake);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.retry) clearTimeout(this.retry);
    if (this.hb) clearInterval(this.hb);
    this.retry = null;
    this.hb = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'bye');
    } catch {
      /* ignore */
    }
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.wake();
  };

  /** Called when the tab or network wakes up: don't wait for a timer. */
  private wake = () => {
    if (this.stopped || this.state.fatal) return;
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      if (this.retry) clearTimeout(this.retry);
      this.open();
    } else if (ws.readyState === WebSocket.OPEN) {
      // looks open, but may be a zombie after sleep: check it
      this.lastHeard = Math.min(this.lastHeard, Date.now() - DEAD_AFTER + 4000);
      try {
        ws.send('ping');
      } catch {
        /* the heartbeat will notice */
      }
    }
  };

  private open() {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.set({ status: this.state.view ? 'reconnecting' : 'connecting' });

    ws.onopen = () => {
      this.lastHeard = Date.now();
      const saved = getIdentity(this.code);
      const hello: C2S = {
        t: 'hello',
        code: this.code,
        name: saved?.name || getName() || 'Player',
        ...(saved ? { id: saved.id, secret: saved.secret } : {}),
      };
      ws.send(JSON.stringify(hello));
      if (this.hb) clearInterval(this.hb);
      this.hb = setInterval(() => this.heartbeat(), PING_EVERY);
    };

    ws.onmessage = (ev) => {
      this.lastHeard = Date.now();
      if (ev.data === 'pong') return;
      let msg: S2C;
      try {
        msg = JSON.parse(String(ev.data)) as S2C;
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // an old socket closing after we replaced it
      this.ws = null;
      if (this.hb) clearInterval(this.hb);
      this.hb = null;
      if (this.stopped || this.state.fatal) return;
      this.scheduleRetry();
    };
    ws.onerror = () => undefined; // onclose follows and does the work
  }

  private heartbeat() {
    const ws = this.ws;
    if (!ws) return;
    if (Date.now() - this.lastHeard > DEAD_AFTER) {
      // no word from the server for too long: treat as dead and reconnect
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (this.ws === ws) {
        this.ws = null;
        this.scheduleRetry();
      }
      return;
    }
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    } catch {
      /* ignore */
    }
  }

  private scheduleRetry() {
    if (this.stopped) return;
    if (this.retry) clearTimeout(this.retry);
    const attempt = this.state.attempt + 1;
    this.set({ status: 'reconnecting', attempt });
    const delay = Math.min(8000, 350 * 2 ** Math.min(attempt - 1, 5)) + Math.random() * 300;
    this.retry = setTimeout(() => this.open(), delay);
  }

  private handle(msg: S2C) {
    switch (msg.t) {
      case 'welcome': {
        const name = getIdentity(this.code)?.name || getName() || 'Player';
        setIdentity(this.code, { id: msg.id, secret: msg.secret, name, at: Date.now() });
        this.set({ offset: msg.now - Date.now() });
        break;
      }
      case 'state':
        this.set({ status: 'live', view: msg.s, offset: msg.now - Date.now(), attempt: 0, fatal: null });
        break;
      case 'err':
        this.onError(msg.code, msg.msg);
        break;
      case 'fatal':
        if (msg.code === 'bad_secret') clearIdentity(this.code);
        this.set({ fatal: { code: msg.code, msg: msg.msg }, status: FATAL_NO_RETRY.includes(msg.code) ? 'closed' : this.state.status });
        break;
      case 'emote':
        this.onEmote(msg.from, msg.e);
        break;
    }
  }

  send(msg: C2S): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }
}

/** Subscribes a component to a room. Owns the connection for as long as the component is mounted. */
export function useRoom(code: string, ready: boolean) {
  const [conn] = useState(() => new RoomConnection(code));
  const state = useSyncExternalStore(conn.subscribe, conn.getSnapshot, conn.getSnapshot);
  useEffect(() => {
    if (!ready) return;
    conn.connect();
    return () => conn.close();
  }, [conn, ready]);
  return { conn, state };
}
