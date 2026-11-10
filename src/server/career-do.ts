import { DurableObject } from 'cloudflare:workers';
import { b64u, randomId } from './auth';
import { CareerHost, type CareerIO, type Stored } from './career-host';

export interface Env {
  ROOMS: DurableObjectNamespace;
  CAREERS: DurableObjectNamespace<CareerRoom>;
  ACCOUNTS: DurableObjectNamespace<Account>;
  ASSETS: Fetcher;
  /** public OAuth client id for Google sign-in; empty = Google sign-in is off and everyone plays as a guest */
  GOOGLE_CLIENT_ID?: string;
  /** optional; if unset the server makes and keeps its own signing secret */
  SESSION_SECRET?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** One Durable Object per career league. Its state is saved after every change, and an alarm plays the matchday at its deadline. */
export class CareerRoom extends DurableObject<Env> {
  private host: CareerHost | null = null;
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.host = await CareerHost.load(this.io());
    });
  }

  private io(): CareerIO {
    return {
      now: () => Date.now(),
      load: async () => {
        const st = await this.ctx.storage.get<Stored['st']>('st');
        if (!st || st.v !== 1) return null;
        const auth = (await this.ctx.storage.get<{ accountOf: Record<string, string>; touched: number }>('auth')) ?? { accountOf: {}, touched: Date.now() };
        return { st, accountOf: auth.accountOf, touched: auth.touched };
      },
      save: async (s) => { await this.ctx.storage.put({ st: s.st, auth: { accountOf: s.accountOf, touched: s.touched } }); },
      schedule: async (at) => {
        if (at === this.alarmAt) return;
        this.alarmAt = at;
        if (at === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(at);
      },
      destroy: async () => { this.host = null; this.alarmAt = null; await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); },
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The worker verified the sign-in cookie and set this header; clients cannot reach this object directly.
    const account = request.headers.get('x-account') || null;

    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.host) return new Response('exists', { status: 409 });
      const code = request.headers.get('x-code') ?? '';
      this.host = await CareerHost.create(code, randomId(12), this.io());
      return new Response('ok', { status: 201 });
    }
    if (!this.host) return json({ exists: false }, 404);

    if (url.pathname === '/info') {
      const s = this.host.state;
      return json({ exists: true, phase: s.phase, managers: s.members.length, season: s.season, joinable: s.phase === 'lobby' && s.members.length < 4 });
    }
    if (url.pathname === '/view' && request.method === 'GET') {
      const since = url.searchParams.get('since');
      const r = await this.host.view(account, since !== null && /^\d+$/.test(since) ? Number(since) : undefined);
      return json(r.view ? { rev: r.rev, view: r.view } : { rev: r.rev, same: true });
    }
    if (url.pathname === '/match' && request.method === 'GET') {
      const m = await this.host.match(account);
      return m ? json(m) : json({ none: true });
    }
    if (url.pathname === '/act' && request.method === 'POST') {
      if (!account) return json({ ok: false, code: 'signin', msg: 'Sign in to play.' }, 401);
      const text = await request.text();
      if (text.length > 16_384) return json({ ok: false, code: 'too_big', msg: 'That request is too large.' }, 413);
      let body: unknown;
      try { body = JSON.parse(text); } catch { return json({ ok: false, code: 'bad_request', msg: 'That request was not understood.' }, 400); }
      const r = await this.host.act(account, body);
      return r.ok ? json(r) : json(r, r.status);
    }
    return json({ error: 'not found' }, 404);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    await this.host?.onAlarm();
  }
}

export interface Profile { id: string; kind: 'g' | 'u'; name: string; createdAt: number; careers: Array<{ code: string; memberId: string; club: string; at: number }> }

/**
 * One Durable Object per account (keyed by the opaque account id), plus one named "__config__" that holds the signing secret
 * when none is configured. Reachable only from the worker.
 */
export class Account extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/secret') {
      let secret = await this.ctx.storage.get<string>('secret');
      if (!secret) { secret = b64u(crypto.getRandomValues(new Uint8Array(32))); await this.ctx.storage.put('secret', secret); }
      return json({ secret });
    }
    if (url.pathname === '/profile' && request.method === 'GET') {
      const p = await this.ctx.storage.get<Profile>('profile');
      return p ? json(p) : json({ exists: false }, 404);
    }
    if (url.pathname === '/profile' && request.method === 'PUT') {
      const body = (await request.json()) as Pick<Profile, 'id' | 'kind' | 'name'>;
      const old = await this.ctx.storage.get<Profile>('profile');
      const p: Profile = { id: body.id, kind: body.kind, name: body.name, createdAt: old?.createdAt ?? Date.now(), careers: old?.careers ?? [] };
      await this.ctx.storage.put('profile', p);
      return json(p);
    }
    if (url.pathname === '/careers' && request.method === 'POST') {
      const body = (await request.json()) as Profile['careers'][number];
      const p = await this.ctx.storage.get<Profile>('profile');
      if (!p) return json({ exists: false }, 404);
      if (!p.careers.some((c) => c.code === body.code)) p.careers.push(body);
      if (p.careers.length > 50) p.careers.splice(0, p.careers.length - 50);
      await this.ctx.storage.put('profile', p);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}
