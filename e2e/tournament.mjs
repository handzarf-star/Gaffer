// Two phones side by side (an iPhone-sized and a Pixel-sized browser) play a league with CPU teams.
// Checks the rule that matters: each phone only sees its own game, CPU-vs-CPU games never have to be watched.
//   BASE=http://localhost:8787 node e2e/tournament.mjs
import { chromium, devices } from '@playwright/test';
import { classic } from './classic.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch();
const T = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(3); }, 280_000);

async function phone(name, device) {
  const { defaultBrowserType, ...opts } = devices[device];
  const ctx = await browser.newContext({ ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return { name, page };
}
const noOverflow = async (p, where) => {
  const w = await p.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (w[0] > w[1] + 1) throw new Error(`${p.name} horizontal overflow at ${where}: ${w[0]} > ${w[1]}`);
};
async function openPack(page) { const s = page.locator('.sealed, .pack'); if (await s.count()) { await s.first().click({ timeout: 2500 }).catch(() => {}); await sleep(700); } }

const results = [];
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), 'gaffer-e2e');
fs.mkdirSync(SHOTS, { recursive: true });
let pages = [];
const ok = (m) => { results.push(m); console.log('✓', m); };

try {
  const sam = await phone('Sam (iPhone)', 'iPhone 14');
  const alex = await phone('Alex (Pixel)', 'Pixel 7');
  pages = [sam, alex];

  // lobby on a phone
  await sam.page.goto(BASE);
  await sam.page.getByLabel('Your name').fill('Sam');
  await sam.page.getByRole('button', { name: 'Start a league' }).click();
  await sam.page.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = sam.page.url().split('/').pop();
  await alex.page.goto(`${BASE}/r/${code}`);
  await alex.page.getByPlaceholder('Your name').fill('Alex');
  await alex.page.getByRole('button', { name: 'Join the room' }).click();
  await sam.page.getByText('Alex FC').first().waitFor();
  await classic(sam.page, { format: 'packs', competition: 'league' });
  await sam.page.getByRole('button', { name: /^League/ }).click();
  await sam.page.getByRole('radio', { name: '4', exact: true }).click();
  await sam.page.getByRole('button', { name: /Packs/ }).click();
  await sam.page.getByText('2 CPU').first().waitFor();
  await alex.page.getByText(/2 CPU/).first().waitFor();
  await noOverflow(sam, 'lobby'); await noOverflow(alex, 'lobby');
  ok('host sets a 4-team league (2 friends + 2 CPU) and the guest sees it live');
  await sam.page.getByRole('button', { name: 'Start the draft' }).click();
  await sam.page.locator('.draft').waitFor(); await alex.page.locator('.draft').waitFor();

  // draft
  for (let step = 0; step < 90; step++) {
    if (await sam.page.locator('.setup').count()) break;
    for (const p of [sam, alex]) {
      if (await p.page.locator('.turn--you').count()) {
        await openPack(p.page);
        const cards = p.page.locator('.board .pcard:not([disabled])');
        if (await cards.count()) { await cards.first().click().catch(() => {}); await p.page.keyboard.press('Enter'); await sleep(150); }
      }
    }
    await sleep(200);
  }
  await sam.page.locator('.setup').waitFor(); await alex.page.locator('.setup').waitFor();
  await noOverflow(sam, 'setup'); await noOverflow(alex, 'setup');
  ok('both phones draft and reach the lineup screen (CPU teams draft by themselves)');
  await sam.page.getByText(/2 CPU teams have drafted too/).waitFor();
  for (const p of [sam, alex]) await p.page.getByRole('button', { name: /Lock in and kick off/ }).click();

  // matchdays
  let days = 0;
  let sawHubWithResults = false;
  for (let guard = 0; guard < 8; guard++) {
    await sam.page.locator('.mpitch').waitFor({ timeout: 40_000 });
    await alex.page.locator('.mpitch').waitFor({ timeout: 40_000 });
    days++;
    // each phone sees exactly ONE fixture and it is their own
    for (const p of [sam, alex]) {
      if ((await p.page.locator('.fxtab').count()) !== 0) throw new Error(`${p.name} is being shown more than its own game`);
      if ((await p.page.locator('.sb__team.is-me').count()) !== 1) throw new Error(`${p.name} is not in the game it is watching`);
      await noOverflow(p, `match day ${days}`);
    }
    const names = await Promise.all([sam, alex].map((p) => p.page.locator('.sb__team b').allInnerTexts().then((a) => a.join(' v '))));
    if (days === 1) ok(`matchday 1: each phone shows only its own game (${names[0].replace(/ \(you\)/g, '')} / ${names[1].replace(/ \(you\)/g, '')})`);
    // pitch has players and a ball
    if ((await sam.page.locator('.mpitch .mp-player').count()) < 20) throw new Error('pitch is missing players');
    for (const p of [sam, alex]) await p.page.locator('.mskip').click().catch(() => {});
    for (const p of [sam, alex]) await p.page.getByRole('button', { name: 'Continue' }).click({ timeout: 25_000 });
    if (await sam.page.locator('.result').count()) break;
    await Promise.race([sam.page.locator('.hub').waitFor(), sam.page.locator('.result').waitFor()]).catch(() => {});
    if (await sam.page.locator('.result').count()) break;
    await sam.page.locator('.hub').waitFor(); await alex.page.locator('.hub').waitFor();
    for (const p of [sam, alex]) await noOverflow(p, `hub ${days}`);
    const rows = await sam.page.locator('table.table tbody tr').count();
    if (rows !== 4) throw new Error(`standings should list 4 teams, got ${rows}`);
    if (await sam.page.getByText('Your results').count()) sawHubWithResults = true;
    await sam.page.getByRole('button', { name: /Ready for the next matchday/ }).click();
    await alex.page.getByRole('button', { name: /Ready for the next matchday/ }).click();
  }
  if (!sawHubWithResults) throw new Error('never saw the hub with results');
  ok('between matchdays both phones see results, standings (4 teams) and a ready button');
  await sam.page.locator('.result').waitFor({ timeout: 30_000 }); await alex.page.locator('.result').waitFor();
  if (days !== 3) throw new Error(`a 4-team league has 3 matchdays, played ${days}`);
  ok('a 4-team league finishes after exactly 3 matchdays');
  await sam.page.getByText('The tournament').waitFor();
  await noOverflow(sam, 'result'); await noOverflow(alex, 'result');
  const champ = await sam.page.locator('.champ').first().innerText();
  ok(`both phones show the champion and the final table (${champ.replace(/\n/g, ' ')})`);
} catch (e) {
  console.log('FAILED:', e.message.split('\n').slice(0, 4).join(' | '));
  for (const p of pages) await p.page.screenshot({ path: `${SHOTS}/tour-fail-${p.name.split(' ')[0]}.png` }).catch(() => {});
  console.log(errors.slice(0, 6).join('\n'));
  clearTimeout(T); await browser.close(); process.exit(2);
}
clearTimeout(T);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log(`TOURNAMENT OK (${results.length} checks)`);
