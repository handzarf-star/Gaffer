import { ROOM_CODE_RE } from '../shared/protocol';
import { randomRoomCode } from '../shared/rng';
import { Room } from './room-do';
import { Account, CareerRoom, type Env } from './career-do';
import { accountOf, handleApi } from './api';
import { currentBuild } from './build';

export { Room, CareerRoom, Account };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Every API answer names the build that produced it, so a page left open across a deploy can tell it is out of date. */
async function withBuild(res: Response, env: Env): Promise<Response> {
  if (res.status === 101 || res.webSocket) return res;
  const out = new Response(res.body, res);
  out.headers.set('x-build', await currentBuild(env.ASSETS));
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await route(request, env);
    return new URL(request.url).pathname.startsWith('/api/') ? withBuild(res, env) : res;
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/health') return json({ ok: true, t: Date.now(), build: await currentBuild(env.ASSETS) });

  const api = await handleApi(request, env);
  if (api) return api;

  if (path === '/api/rooms' && request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return json({ error: 'forbidden' }, 403);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomRoomCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const res = await stub.fetch('https://room/init', { method: 'POST', headers: { 'x-room-code': code } });
      if (res.status === 201) return json({ code }, 201);
      if (res.status !== 409) break; // 409 = code collision, try another one
    }
    return json({ error: 'could not create a room, please try again' }, 503);
  }

  const info = path.match(/^\/api\/rooms\/([A-Z]+)$/);
  if (info && request.method === 'GET') {
    const code = info[1]!;
    if (!ROOM_CODE_RE.test(code)) return json({ exists: false });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room/info');
    // a missing room is an answer, not an error: keep the browser console clean
    return res.status === 404 ? json({ exists: false }) : res;
  }

  const ws = path.match(/^\/ws\/([A-Z]+)$/);
  if (ws) {
    const code = ws[1]!;
    if (!ROOM_CODE_RE.test(code)) return new Response('No such room.', { status: 404 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    // The room is told which account is knocking (a silent guest account is enough), so a seat can be reclaimed on a browser that
    // lost its seat secret. The header is set here and nowhere else: whatever a client sent under that name is dropped, and a socket
    // opened by another site's page is not given the visitor's account.
    const headers = new Headers(request.headers);
    headers.delete('x-account');
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host === url.host) {
      const account = await accountOf(request, env).catch(() => null);
      if (account) headers.set('x-account', account);
    }
    return stub.fetch(new Request(request, { headers }));
  }

  if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
  return env.ASSETS.fetch(request);
}
