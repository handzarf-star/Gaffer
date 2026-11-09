import { DurableObject } from 'cloudflare:workers';
import { MAX_SEATS, ROOM_CODE_RE, type RoomState } from '../shared/protocol';
import { RoomEngine } from '../shared/room';
import { RoomHost, type Conn, type HostIO } from './host';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * One Durable Object per room code. It uses the WebSocket Hibernation API, so an idle room costs nothing,
 * and persists its state so a redeploy or eviction never loses a draft in progress.
 */
export class Room extends DurableObject<Env> {
  private host: RoomHost | null = null;
  private lastMatch: RoomState['match'] | undefined = undefined;
  private alarmAt: number | null = null;
  private conns = new WeakMap<WebSocket, Conn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const core = await ctx.storage.get<Omit<RoomState, 'match'>>('core');
      if (core) {
        const match = (await ctx.storage.get<RoomState['match']>('match')) ?? null;
        this.start({ ...core, match } as RoomState);
      }
    });
  }

  private start(state: RoomState): void {
    this.lastMatch = state.match;
    this.host = new RoomHost(new RoomEngine(state), this.io());
  }

  private conn(ws: WebSocket): Conn {
    let c = this.conns.get(ws);
    if (!c) {
      c = {
        raw: ws,
        getId: () => (ws.deserializeAttachment() as { id: string | null } | null)?.id ?? null,
        setId: (id) => ws.serializeAttachment({ id }),
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason.slice(0, 100)),
      };
      this.conns.set(ws, c);
    }
    return c;
  }

  private io(): HostIO {
    return {
      conns: () => this.ctx.getWebSockets().map((ws) => this.conn(ws)),
      now: () => Date.now(),
      persist: async (state) => {
        const { match, ...core } = state;
        const puts: Record<string, unknown> = { core: { ...core, match: null } };
        if (match !== this.lastMatch) {
          puts.match = match;
          this.lastMatch = match;
        }
        await this.ctx.storage.put(puts);
      },
      schedule: async (at) => {
        if (at === this.alarmAt) return;
        this.alarmAt = at;
        if (at === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(at);
      },
      destroy: async () => {
        this.host = null;
        this.alarmAt = null;
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
      },
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.host) return new Response('exists', { status: 409 });
      const code = request.headers.get('x-room-code') ?? '';
      if (!ROOM_CODE_RE.test(code)) return new Response('bad code', { status: 400 });
      const state = RoomEngine.create(code, Date.now()).s;
      this.start(state);
      await this.host!.changed(Date.now());
      return new Response('ok', { status: 201 });
    }

    if (url.pathname === '/info') {
      if (!this.host) return json({ exists: false }, 404);
      const s = this.host.engine.s;
      return json({ exists: true, phase: s.phase, players: s.seats.length, joinable: s.phase === 'lobby' && s.seats.length < MAX_SEATS });
    }

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    if (!this.host) return new Response('No such room.', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.host) {
      ws.close(4000, 'no_room');
      return;
    }
    await this.host.onMessage(this.conn(ws), message);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code >= 3000 && code <= 4999 ? code : 1000, reason.slice(0, 100));
    } catch {
      /* already closed */
    }
    await this.host?.onClose(this.conn(ws));
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.host?.onClose(this.conn(ws));
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    await this.host?.onAlarm();
  }
}
