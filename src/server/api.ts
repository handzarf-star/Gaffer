// HTTP API for accounts and career leagues. Everything that changes state requires a same-origin request and a signed cookie.
import { ROOM_CODE_RE } from '../shared/protocol';
import { randomRoomCode } from '../shared/rng';
import {
  AuthError, SESSION_COOKIE, checkNonce, clearCookie, cleanDisplayName, googleAccountId, makeNonce, randomId, readCookie, sessionCookie, signSession, verifyGoogleIdToken, verifySession,
  type GoogleKey, type Session,
} from './auth';
import type { Account, CareerRoom, Env, Profile } from './career-do';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

let secretCache: string | null = null;
async function secretOf(env: Env): Promise<string> {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 24) return env.SESSION_SECRET;
  if (secretCache) return secretCache;
  const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('__config__'));
  const r = (await (await stub.fetch('https://acct/secret')).json()) as { secret: string };
  secretCache = r.secret;
  return secretCache;
}

let jwksCache: { keys: GoogleKey[]; at: number } | null = null;
async function googleKeys(refresh: boolean): Promise<GoogleKey[]> {
  if (!refresh && jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new AuthError('keys', 'Could not check your Google sign-in right now.');
  const body = (await res.json()) as { keys: GoogleKey[] };
  jwksCache = { keys: body.keys, at: Date.now() };
  return body.keys;
}

const acct = (env: Env, id: string) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName(id));
async function profile(env: Env, id: string): Promise<Profile | null> {
  const r = await acct(env, id).fetch('https://acct/profile');
  return r.ok ? ((await r.json()) as Profile) : null;
}

async function sessionOf(request: Request, env: Env): Promise<Session | null> {
  return verifySession(await secretOf(env), readCookie(request.headers.get('cookie'), SESSION_COOKIE), Date.now());
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  return !origin || new URL(origin).host === url.host;
}

async function readJson(request: Request, max = 8192): Promise<unknown | null> {
  const text = await request.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Handles /api/me, /api/auth/*, /api/my/*, /api/career*. Returns null for anything else. */
export async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!/^\/api\/(me|auth|my|career)/.test(path)) return null;
  const secure = url.protocol === 'https:';
  const post = request.method === 'POST';
  if (post && !sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);

  if (path === '/api/me' && request.method === 'GET') {
    const s = await sessionOf(request, env);
    const p = s ? await profile(env, s.a) : null;
    return json({ user: p ? { name: p.name, kind: p.kind === 'g' ? 'google' : 'guest' } : null, googleClientId: env.GOOGLE_CLIENT_ID || null });
  }

  if (path === '/api/auth/nonce' && request.method === 'GET') return json({ nonce: await makeNonce(await secretOf(env), Date.now()) });

  if (path === '/api/auth/google' && post) {
    const body = (await readJson(request)) as { credential?: unknown } | null;
    if (!body || typeof body.credential !== 'string') return json({ error: 'bad_request' }, 400);
    const secret = await secretOf(env);
    try {
      const claims = await verifyGoogleIdToken(body.credential, { clientId: env.GOOGLE_CLIENT_ID ?? '', now: Date.now(), keys: googleKeys, expectNonce: (n) => checkNonce(secret, n, Date.now()) });
      const id = await googleAccountId(claims.sub);
      const existing = await profile(env, id);
      const name = existing?.name ?? cleanDisplayName(claims.given_name ?? claims.name, 'Manager');
      await acct(env, id).fetch('https://acct/profile', { method: 'PUT', body: JSON.stringify({ id, kind: 'g', name }) });
      const token = await signSession(secret, { a: id, k: 'g' }, Date.now());
      return json({ user: { name, kind: 'google' } }, 200, { 'set-cookie': sessionCookie(token, 'g', secure) });
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.code, msg: e.message }, e.code === 'not_configured' ? 501 : 401);
      throw e;
    }
  }

  if (path === '/api/auth/guest' && post) {
    const existing = await sessionOf(request, env);
    if (existing && (await profile(env, existing.a))) return json({ error: 'already_signed_in' }, 409);
    const body = ((await readJson(request)) ?? {}) as { name?: unknown };
    const id = `u_${randomId(16)}`;
    const name = cleanDisplayName(typeof body.name === 'string' ? body.name : '', 'Guest');
    await acct(env, id).fetch('https://acct/profile', { method: 'PUT', body: JSON.stringify({ id, kind: 'u', name }) });
    const token = await signSession(await secretOf(env), { a: id, k: 'u' }, Date.now());
    return json({ user: { name, kind: 'guest' } }, 200, { 'set-cookie': sessionCookie(token, 'u', secure) });
  }

  if (path === '/api/auth/logout' && post) return json({ ok: true }, 200, { 'set-cookie': clearCookie(secure) });

  const session = await sessionOf(request, env);

  if (path === '/api/auth/name' && post) {
    if (!session) return json({ error: 'signin' }, 401);
    const body = (await readJson(request)) as { name?: unknown } | null;
    const p = await profile(env, session.a);
    if (!p || !body || typeof body.name !== 'string') return json({ error: 'bad_request' }, 400);
    p.name = cleanDisplayName(body.name, p.name);
    await acct(env, session.a).fetch('https://acct/profile', { method: 'PUT', body: JSON.stringify({ id: p.id, kind: p.kind, name: p.name }) });
    return json({ user: { name: p.name, kind: p.kind === 'g' ? 'google' : 'guest' } });
  }

  if (path === '/api/my/careers' && request.method === 'GET') {
    if (!session) return json({ careers: [] });
    const p = await profile(env, session.a);
    return json({ careers: (p?.careers ?? []).slice().reverse() });
  }

  if (path === '/api/career' && post) {
    if (!session || !(await profile(env, session.a))) return json({ error: 'signin', msg: 'Sign in or play as a guest first.' }, 401);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomRoomCode();
      const stub = env.CAREERS.get(env.CAREERS.idFromName(code));
      const res = await stub.fetch('https://career/init', { method: 'POST', headers: { 'x-code': code } });
      if (res.status === 201) return json({ code }, 201);
      if (res.status !== 409) break;
    }
    return json({ error: 'busy', msg: 'Could not create a league, please try again.' }, 503);
  }

  const m = path.match(/^\/api\/career\/([A-Z]+)(?:\/(act|match|info))?$/);
  if (m) {
    const code = m[1]!;
    if (!ROOM_CODE_RE.test(code)) return json({ exists: false }, 404);
    const stub: DurableObjectStub<CareerRoom> = env.CAREERS.get(env.CAREERS.idFromName(code));
    const headers: Record<string, string> = session ? { 'x-account': session.a } : {};
    const sub = m[2] ?? 'view';
    if (sub === 'act' && post) {
      const res = await stub.fetch('https://career/act', { method: 'POST', headers, body: await request.text() });
      const body = (await res.json()) as { ok?: boolean; joined?: string; view?: { me?: { clubId: string } | null } };
      if (res.ok && body.joined && session) {
        const club = body.view?.me?.clubId ?? '';
        await acct(env, session.a).fetch('https://acct/careers', { method: 'POST', body: JSON.stringify({ code, memberId: body.joined, club, at: Date.now() }) });
      }
      // never hand the member handle of the join to the client twice; the view already says who "me" is
      if (body.joined) delete body.joined;
      return json(body, res.status);
    }
    if (request.method === 'GET') {
      const q = sub === 'view' ? `?since=${url.searchParams.get('since') ?? ''}` : '';
      const res = await stub.fetch(`https://career/${sub}${q}`, { headers });
      if (res.status === 404) return json({ exists: false }, 404);
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
  }
  return json({ error: 'not found' }, 404);
}
