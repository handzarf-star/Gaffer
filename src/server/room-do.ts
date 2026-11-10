import { DurableObject } from 'cloudflare:workers';
import { MAX_SEATS, ROOM_CODE_RE, type RoomState } from '../shared/protocol';
import { RoomEngine } from '../shared/room';
import { currentBuild } from './build';
import { restoreRoom, type LockReason } from './restore';
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
  private lastComp: RoomState['comp'] | undefined = undefined;
  private alarmAt: number | null = null;
  private conns = new WeakMap<WebSocket, Conn>();
  private build = 'dev';
  /** set when the stored room cannot be served by this build; the storage is left exactly as it was */
  private locked: LockReason | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.build = await currentBuild(env.ASSETS);
      const r = restoreRoom(await ctx.storage.get('core'), await ctx.storage.get('comp'));
      if (r.kind === 'ready') {
        this.start(r.state);
        // an old save is rewritten in the current shape once, so the next wake-up has nothing to migrate
        if (r.changed) await this.io().persist(r.state);
      } else if (r.kind === 'drop') {
        // too old to read and a room is never more than a game: free the code
        await ctx.storage.deleteAll();
      } else if (r.kind === 'locked') {
        // written by a newer build, or damaged beyond repair: do not touch it, do not serve it, do not let a new room overwrite it
        this.locked = r.reason;
        console.error(`room not loaded: ${r.reason} (saved v${r.from ?? '?'}) ${r.detail ?? ''}`);
      }
    });
  }

  private start(state: RoomState): void {
    this.lastComp = state.comp;
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
      build: () => this.build,
      persist: async (state) => {
        const { comp, ...core } = state;
        const puts: Record<string, unknown> = { core: { ...core, comp: null } };
        // The competition is mutated in place as matchdays are played, so it must be written every time it exists
        // (comparing references would silently persist a stale table).
        if (comp || this.lastComp) {
          puts.comp = comp;
          this.lastComp = comp;
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
      if (this.host || this.locked) return new Response('exists', { status: 409 });
      const code = request.headers.get('x-room-code') ?? '';
      if (!ROOM_CODE_RE.test(code)) return new Response('bad code', { status: 400 });
      const state = RoomEngine.create(code, Date.now()).s;
      this.start(state);
      await this.host!.changed(Date.now());
      return new Response('ok', { status: 201 });
    }

    if (this.locked) {
      // a newer or damaged save: the room exists, it just cannot be played from this build right now
      if (url.pathname === '/info') return json({ exists: true, joinable: false, locked: this.locked });
      return new Response('This room is being updated. Reload in a minute.', { status: 503 });
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
