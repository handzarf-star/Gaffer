// Google sign-in under the REAL Content-Security-Policy. Boots the local runtime with a client id set (so the sign-in script is requested),
// serves a stub in place of Google's script, and checks that the browser (a) lets that exact script load and render its button,
// (b) reports no CSP violation for it, (c) still blocks scripts from any other origin, and (d) a rejected token shows an error, not a login.
//   npm run check:csp   (needs `npm run build` first)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-csp-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (c, m) => { if (!c) throw new Error(m); };
const CLIENT_ID = 'stub-client-id.apps.googleusercontent.com';
let server = null;

async function boot() {
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--var', `GOOGLE_CLIENT_ID:${CLIENT_ID}`], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* booting */ } await sleep(500); }
  throw new Error('server did not start');
}
const kill = () => { if (server) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } server = null; } };

const STUB = `
  window.__gsi = { initialized: null, rendered: false };
  window.google = { accounts: { id: {
    initialize(o) { window.__gsi.initialized = o; },
    renderButton(el) { el.innerHTML = '<button type="button" id="gsi-stub">Continue with Google (stub)</button>'; window.__gsi.rendered = true; },
  } } };`;

let code = 0;
let browser;
try {
  await boot();
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });

  const res = await page.goto(`${base}/career`);
  const header = res.headers()['content-security-policy'] ?? '';
  must(header.includes('https://accounts.google.com/gsi/client'), `the served CSP header does not allow Google's script: ${header.slice(0, 160)}`);
  await page.locator('#gsi-stub').waitFor({ timeout: 15_000 });
  const gsi = await page.evaluate(() => ({ id: window.__gsi.initialized?.client_id, nonce: window.__gsi.initialized?.nonce, rendered: window.__gsi.rendered }));
  must(gsi.rendered && gsi.id === CLIENT_ID, `the sign-in script ran but was not set up with our client id (${JSON.stringify(gsi)})`);
  must(typeof gsi.nonce === 'string' && gsi.nonce.split('.').length === 3, 'the sign-in was not given a server-issued nonce');
  const violations = await page.evaluate(() => window.__csp.slice());
  must(violations.length === 0, `CSP violations while loading sign-in: ${violations.join(' | ')}`);
  console.log('✓ Google sign-in script, button and nonce all work under the shipped CSP, with no violations');

  // the policy is still doing its job: a script from anywhere else is refused
  await page.evaluate(() => { const s = document.createElement('script'); s.src = 'https://cdn.example.net/evil.js'; document.head.appendChild(s); });
  await page.waitForFunction(() => window.__csp.some((v) => v.startsWith('script-src') && v.includes('cdn.example.net')), null, { timeout: 5000 });
  console.log('✓ a script from another origin is still blocked');

  // a bad token is rejected by the server and shown as an error; nobody is signed in
  await page.evaluate(() => window.__gsi.initialized.callback({ credential: 'not.a.token' }));
  await page.getByRole('alert').filter({ hasText: /Google sign-in did not work|sign-in/i }).first().waitFor({ timeout: 10_000 });
  const me = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user);
  must(me === null, 'a rejected Google token must not sign anybody in');
  console.log('✓ a forged Google token is refused and nobody is signed in');
  console.log('\nCSP + GOOGLE SIGN-IN OK');
} catch (e) {
  console.log(`\n✗ CSP CHECK FAILED: ${e.message}`);
  code = 1;
} finally {
  if (browser) await browser.close();
  kill();
  fs.rmSync(persist, { recursive: true, force: true });
}
process.exit(code);
