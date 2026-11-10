// Boots the real local Cloudflare runtime and walks the career API: guest sign-in, a league, join, start, then a SIGKILL and restart
// to prove the account, the signing secret and the league all survive. Also pokes the security edges (no cookie, forged cookie,
// cross-site POST, Google sign-in when not configured).    npm run check:career   (needs `npm run build` first)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8800 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-career-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
const must = (c, m) => { if (!c) throw new Error(m); };

async function boot() {
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* booting */ } await sleep(500); }
  throw new Error('server did not start');
}
function kill() { if (server) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } server = null; } }

const jar = { cookie: '' };
async function call(method, url, body, { cookie = jar.cookie, origin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = res.headers.get('set-cookie');
  if (set && cookie === jar.cookie) { const c = set.split(';')[0]; if (c.endsWith('=')) jar.cookie = ''; else jar.cookie = c; }
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data, set };
}

let code = 0;
try {
  await boot();

  // --- signed out
  let r = await call('GET', '/api/me');
  must(r.status === 200 && r.data.user === null, 'signed-out /api/me');
  must(r.data.googleClientId === null, 'google should be off by default');
  r = await call('POST', '/api/career', {});
  must(r.status === 401, `creating a league without signing in should be 401, got ${r.status}`);
  r = await call('POST', '/api/auth/google', { credential: 'a.b.c' });
  must(r.status === 501, `google sign-in with no client id should be 501, got ${r.status}`);
  r = await call('POST', '/api/auth/guest', { name: 'Sam' }, { origin: 'https://evil.example' });
  must(r.status === 403, 'a cross-site POST must be refused');

  // --- guest sign-in
  r = await call('POST', '/api/auth/guest', { name: 'Sam <b>' });
  must(r.status === 200 && r.data.user.kind === 'guest', 'guest sign-in');
  must(/HttpOnly/i.test(r.set) && /SameSite=Lax/i.test(r.set), 'cookie must be HttpOnly and SameSite');
  must(!/Secure/i.test(r.set), 'plain-http dev should not set Secure (it would be dropped)');
  must(!/[<>]/.test(r.data.user.name), 'display name must be cleaned');
  const goodCookie = jar.cookie;
  r = await call('GET', '/api/me');
  must(r.data.user?.kind === 'guest', 'cookie should sign us in');
  r = await call('GET', '/api/me', undefined, { cookie: goodCookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) });
  must(r.data.user === null, 'a tampered cookie must count as signed out');

  // --- a league
  r = await call('POST', '/api/career', {});
  must(r.status === 201 && /^[A-Z]{4}$/.test(r.data.code), 'create league');
  const league = r.data.code;
  r = await call('POST', `/api/career/${league}/act`, { t: 'start' }, { cookie: '' });
  must(r.status === 401, `acting without a cookie should be 401, got ${r.status}`);
  r = await call('POST', `/api/career/${league}/act`, { t: 'join', name: 'Sam', choice: { kind: 'real', id: 'zeljeznicar' } });
  must(r.status === 200 && r.data.view.me?.clubId === 'zeljeznicar', 'join');
  must(!('joined' in r.data), 'the member handle must not be handed back separately');
  r = await call('GET', '/api/my/careers');
  must(r.data.careers.length === 1 && r.data.careers[0].code === league, 'my careers lists the league');
  r = await call('POST', `/api/career/${league}/act`, { t: 'start' });
  must(r.status === 200 && r.data.view.phase === 'draft', `start -> draft, got ${JSON.stringify(r.data).slice(0, 120)}`);
  const rev = r.data.view.rev;
  r = await call('GET', `/api/career/${league}?since=${rev}`);
  must(r.data.same === true, 'unchanged state should answer "same"');
  r = await call('GET', `/api/career/${league}`, undefined, { cookie: '' });
  must(r.data.view.me === null && r.data.view.mine === null, 'a spectator sees no private block');
  console.log('✓ guest sign-in, league, join, start; tampered cookie, no cookie and cross-site POST all refused; Google off by default');

  // --- hard kill, restart, same cookie
  kill(); await sleep(1500); await boot();
  r = await call('GET', '/api/me', undefined, { cookie: goodCookie });
  must(r.data.user?.kind === 'guest', 'the same cookie must still work after a restart (the signing secret survived)');
  r = await call('GET', `/api/career/${league}`, undefined, { cookie: goodCookie });
  must(r.data.view?.me?.clubId === 'zeljeznicar' && r.data.view.phase === 'draft', 'the league and our seat survived the restart');
  console.log('✓ SIGKILL and restart: same cookie, same account, same league and seat');
  console.log('\nCAREER API OK');
} catch (e) {
  console.log(`\n✗ CAREER API FAILED: ${e.message}`);
  code = 1;
} finally {
  kill();
  fs.rmSync(persist, { recursive: true, force: true });
}
process.exit(code);
