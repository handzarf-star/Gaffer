// "New version available": the build id handshake on the real runtime and in a real browser.
//   npm run check:update   (needs `npm run build` first)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 9000 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-update-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (c, m) => { if (!c) throw new Error(m); };
let server = null;

async function boot() {
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* booting */ } await sleep(500); }
  throw new Error('server did not start');
}
const kill = () => { if (server) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } server = null; } };
const foreground = (page) => page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });

let code = 0, browser;
try {
  await boot();
  browser = await chromium.launch();

  // 1. the server and the page agree on the build
  const health = await (await fetch(`${base}/api/health`)).json();
  const probe = await fetch(`${base}/api/me`);
  const html = await (await fetch(`${base}/`)).text();
  const mine = /<meta name="gaffer-build" content="([^"]+)"/.exec(html)?.[1];
  must(mine && /^[0-9a-f]{10}$/.test(mine), `index.html carries no build id (is dist built with this version?): ${mine}`);
  must(health.build === mine, `/api/health says ${health.build}, the page says ${mine}`);
  must(probe.headers.get('x-build') === mine, `x-build header is ${probe.headers.get('x-build')}, expected ${mine}`);
  console.log(`✓ build ${mine}: index.html, /api/health and the x-build header all agree`);

  // 2. the socket handshake carries it both ways
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage();
  const frames = { sent: [], received: [] };
  page.on('websocket', (ws) => { ws.on('framesent', (f) => frames.sent.push(String(f.payload))); ws.on('framereceived', (f) => frames.received.push(String(f.payload))); });
  await page.goto(base);
  await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Start a league' }).click();
  await page.waitForURL(/\/r\/[A-Z]{4}/);
  await page.getByText('Waiting for a friend').waitFor();
  const hello = frames.sent.map((s) => { try { return JSON.parse(s); } catch { return null; } }).find((m) => m?.t === 'hello');
  const welcome = frames.received.map((s) => { try { return JSON.parse(s); } catch { return null; } }).find((m) => m?.t === 'welcome');
  must(hello?.build === mine, `hello carried ${hello?.build}`);
  must(welcome?.build === mine, `welcome carried ${welcome?.build}`);
  must((await page.getByText('A new version is available.').count()) === 0, 'no banner when client and server agree');
  console.log('✓ the socket hello and welcome both carry the build; no banner when they agree');

  // 3. an open page is told about a newer deploy, and nothing reloads by itself
  const ctx2 = await browser.newContext();
  const stale = await ctx2.newPage();
  await stale.route('**/api/health', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, t: 0, build: 'ffffffffff' }) }));
  await stale.goto(base);
  await stale.getByLabel('Your name').fill('Sam');
  await stale.getByLabel('Your name').evaluate((el) => { window.__typed = el.value; });
  await foreground(stale);
  await stale.getByText('A new version is available.').waitFor({ timeout: 10_000 });
  must((await stale.evaluate(() => window.__typed)) === 'Sam' && (await stale.getByLabel('Your name').inputValue()) === 'Sam', 'the banner must not reload the page or wipe what was typed');
  console.log('✓ a newer deploy shows "New version available" and leaves the page alone');
  await Promise.all([stale.waitForNavigation(), stale.getByRole('button', { name: 'Reload' }).click()]);
  console.log('✓ Reload reloads on request');

  // 4. Bosnian
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => { try { localStorage.setItem('gaffer:lang', '"bs"'); } catch { /* ignore */ } });
  const bs = await ctx3.newPage();
  await bs.route('**/api/health', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, t: 0, build: 'ffffffffff' }) }));
  await bs.goto(base);
  await foreground(bs);
  await bs.getByText('Dostupna je nova verzija.').waitFor({ timeout: 10_000 });
  console.log('✓ the banner is in Bosnian when the page is');
  console.log('\nBUILD HANDSHAKE OK');
} catch (e) {
  console.log(`\n✗ BUILD HANDSHAKE FAILED: ${e.message}`);
  code = 1;
} finally {
  if (browser) await browser.close();
  kill();
  fs.rmSync(persist, { recursive: true, force: true });
}
process.exit(code);
