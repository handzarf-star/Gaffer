// Plays a complete two-player game through the real UI in two real browsers.
//   BASE=http://localhost:8787 SHOTS=/some/dir node e2e/flow.mjs
import { chromium } from '@playwright/test';
import { classic } from './classic.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const SHOTS = process.env.SHOTS ?? '';
const FORMAT = process.env.FORMAT ?? 'duel';
const MOBILE = process.env.MOBILE === '1';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openPack(page) { const s = page.locator('.sealed, .pack'); if (await s.count()) { await s.first().click({ timeout: 3000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 750)); } }

const browser = await chromium.launch();
const viewport = MOBILE ? { width: 390, height: 844 } : { width: 1360, height: 900 };

async function player(name, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: scheme, isMobile: MOBILE, hasTouch: MOBILE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`${name} requestfailed: ${r.url()}`));
  return { name, ctx, page };
}
const shot = async (p, file) => { if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/${MOBILE ? 'm-' : ''}${file}.png`, fullPage: false }); };

let host, guest;
process.on('unhandledRejection', (e) => { throw e; });
async function dump(tag) {
  for (const p of [host, guest]) {
    if (!p) continue;
    try {
      if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/FAIL-${tag}-${p.name}.png` });
      console.log(`--- ${p.name} page text ---\n` + (await p.page.evaluate(() => document.body.innerText)).slice(0, 700));
    } catch {}
  }
}

host = await player('Sam', 'light');
guest = await player('Alex', 'dark');

try {
// 1) Home
await host.page.goto(BASE);
await host.page.getByLabel('Your name').fill('Sam');
await shot(host, '01-home');
await host.page.getByRole('button', { name: 'Start a league' }).click();
await host.page.waitForURL(/\/r\/[A-Z]{4}$/);
const code = host.page.url().split('/').pop();
log('room', code);
await host.page.getByText('Waiting for a friend').waitFor();

// 2) Guest joins by link, with a name prompt
await guest.page.goto(`${BASE}/r/${code}`);
await guest.page.getByPlaceholder('Your name').fill('Alex');
await guest.page.getByRole('button', { name: 'Join the room' }).click();
await host.page.getByText('Alex FC').first().waitFor();
await sleep(400);
await shot(host, '02-lobby');
await shot(guest, '02-lobby-guest');

// 3) Settings + start (these flows cover the draft styles from before League Night: reached through Advanced)
await classic(host.page, { format: FORMAT === 'packs' ? 'packs' : FORMAT === 'turns' ? 'turns' : 'duel' });
if (FORMAT === 'packs') await host.page.getByRole('button', { name: /Packs/ }).click();
if (FORMAT === 'turns') await host.page.getByRole('button', { name: /^Take turns/ }).click();
await host.page.getByRole('radio', { name: 'Numbers' }).click();
await sleep(300);
await host.page.getByRole('button', { name: 'Start the draft' }).click();
await host.page.locator('.draft').waitFor();
await guest.page.locator('.draft').waitFor();
log('draft started');
if (FORMAT === 'turns') {
  // the friend watches the host's pack and pitch live; nobody is ever up at the same time
  await guest.page.getByText(/Sam is picking/).first().waitFor({ timeout: 8000 });
  await guest.page.locator('.draft__board[aria-label="Sam\'s pack"]').waitFor();
  await guest.page.getByRole('tab', { name: /Sam/, selected: true }).waitFor();
  if ((await guest.page.locator('.pack').count()) !== 3) throw new Error('the friend cannot see the packs being chosen from');
  if ((await guest.page.locator('.pack:not([disabled])').count()) !== 0) throw new Error('the friend must not be able to open the host\'s packs');
  await sleep(500);
  await shot(guest, '03b-watching-guest');
  log('turns: the friend watches the host draft');
}

// 4) Draft
const both = [host, guest];
let shotsTaken = 0;
for (let step = 0; step < 80; step++) {
  if (await host.page.locator('.setup').count()) break;
  let acted = false;
  if (FORMAT === 'turns' && (await host.page.locator('.turn--you').count()) && (await guest.page.locator('.turn--you').count())) throw new Error('both players are up at the same time');
  for (const p of both) {
    const mine = p.page.locator('.turn--you');
    if (await mine.count()) {
      if (shotsTaken === 0 && (await p.page.locator('.pack').count())) { await sleep(700); await shot(p, '03a-choose-pack'); }
      await openPack(p.page);
      const cards = p.page.locator('.board .pcard:not([disabled])');
      if (await cards.count()) {
        if (shotsTaken === 0) { await sleep(900); await shot(p, '03-draft-turn'); }
        await cards.first().click();
        if (shotsTaken === 0) { await sleep(300); await shot(p, '04-draft-selected'); shotsTaken++; }
        await p.page.keyboard.press('Enter');
        acted = true;
        await sleep(250);
      }
    }
  }
  if (!acted) await sleep(300);
  if (FORMAT === 'turns' && step === 5) await shot(guest, '03c-watching-guest-mid');
  if (step === 14) { await shot(host, '05-draft-mid'); await shot(guest, '05-draft-mid-guest'); }
}
await host.page.locator('.setup').waitFor({ timeout: 20000 });
await guest.page.locator('.setup').waitFor({ timeout: 20000 });
log('setup reached');
await sleep(600);
await shot(host, '06-setup');
await shot(guest, '06-setup-guest');

// 5) Setup -> match
await host.page.getByRole('button', { name: /Lock in and kick off/ }).click();
await guest.page.getByRole('button', { name: /Lock in and kick off/ }).click();
await host.page.locator('.match').waitFor({ timeout: 15000 });
await sleep(1000);
await shot(host, '07-tape');
await sleep(9000);
await shot(host, '08-match-live');
await sleep(12000);
await shot(host, '09-match-late');
// skip to the end on both
for (const p of both) await p.page.getByRole('button', { name: /Skip to the end/ }).click({ timeout: 3000 }).catch(() => {});
await host.page.locator('.fulltime').waitFor({ timeout: 10000 });
await guest.page.locator('.fulltime').waitFor({ timeout: 10000 });
await sleep(500);
await shot(host, '10-fulltime');
await host.page.getByRole('button', { name: 'See the result' }).click();
await sleep(500);
await shot(host, '10b-waiting-for-other');
await guest.page.getByRole('button', { name: 'See the result' }).click();
await host.page.locator('.result').waitFor({ timeout: 20000 });
await sleep(1500);
await shot(host, '11-result');
await shot(guest, '11-result-guest');
log('result reached');

// 6) rematch
await host.page.getByRole('button', { name: 'Play again' }).click();
await guest.page.getByRole('button', { name: 'Play again' }).click();
await host.page.locator('.draft').waitFor({ timeout: 10000 });
log('rematch started');

} catch (e) { console.log('FAILED:', e.message.split('\n')[0]); await dump('flow'); await browser.close(); process.exit(2); }

await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('FLOW OK');
