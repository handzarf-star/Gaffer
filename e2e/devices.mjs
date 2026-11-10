// One person, one phone, a tournament against CPU teams, at the awkward sizes.
// Plays groups+knockout and knockout from lobby to the final screen and checks at every screen that nothing
// scrolls sideways and the match controls stay on screen.
//   BASE=http://localhost:8787 node e2e/devices.mjs            (all sizes)
//   BASE=... ONLY=small node e2e/devices.mjs                   (one size)
// Chromium emulation only: it checks layout, touch and viewport rules, not WebKit rendering.
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ONLY = process.env.ONLY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), 'gaffer-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

const SIZES = [
  { id: 'small', label: 'iPhone SE 320×568', device: 'iPhone SE', comp: 'knockout', teams: 4 },
  { id: 'android', label: 'Galaxy S9+ 320×658', device: 'Galaxy S9+', comp: 'groups', teams: 8 },
  { id: 'big', label: 'iPhone 14 Pro Max 430×932', device: 'iPhone 14 Pro Max', comp: 'knockout', teams: 8 },
  { id: 'land', label: 'Pixel 7 landscape', device: 'Pixel 7 landscape', comp: 'knockout', teams: 4 },
].filter((s) => !ONLY || s.id === ONLY);

const browser = await chromium.launch();
const T = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(3); }, 560_000);
let failures = 0;

async function run(size) {
  const base = devices[size.device] ?? devices['Pixel 7'];
  const { defaultBrowserType, ...opts } = base;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const seen = new Set();
  const vp = page.viewportSize();
  const check = async (screen) => {
    if (seen.has(screen)) return;
    seen.add(screen);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (sw > iw + 1) { await page.screenshot({ path: `${SHOTS}/dev-${size.id}-${screen}-overflow.png` }); throw new Error(`horizontal overflow on ${screen}: ${sw} > ${iw}`); }
    // iOS zooms the whole page when a field under 16px takes focus
    const small = await page.evaluate(() => [...document.querySelectorAll('input,textarea,select')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.className || e.type));
    if (small.length) throw new Error(`form fields under 16px on ${screen} (iOS will zoom): ${small.join(', ')}`);
    if (screen === 'match') {
      const box = await page.locator('.mpitch').boundingBox();
      if (!box || box.x < -1 || box.x + box.width > vp.width + 1) throw new Error(`pitch leaves the screen (${JSON.stringify(box)})`);
      const skip = await page.locator('.mskip').boundingBox();
      if (!skip || skip.y + skip.height > vp.height + 1 || skip.x + skip.width > vp.width + 1) throw new Error(`Skip button is off screen (${JSON.stringify(skip)})`);
      if (skip.height < 32) throw new Error(`Skip button too small to tap (${skip.height}px)`);
      await page.screenshot({ path: `${SHOTS}/dev-${size.id}-match.png` });
    }
  };

  // Regression: a new event must only add a row. Rows used to remount (and replay their fade-in) on every event.
  const feedStaysPut = async () => {
    try {
      await page.waitForFunction(() => document.querySelectorAll('.feed__row').length >= 2, null, { timeout: 25_000 });
      const n0 = await page.evaluate(() => { const rows = [...document.querySelectorAll('.feed__row')]; rows.forEach((r) => { r.dataset.mk = '1'; }); return rows.length; });
      await page.waitForFunction((n) => document.querySelectorAll('.feed__row').length > n, n0, { timeout: 25_000 });
      const kept = await page.evaluate(() => [...document.querySelectorAll('.feed__row')].filter((r) => r.dataset.mk === '1').length);
      if (kept < n0) throw new Error(`event feed remounted ${n0 - kept} of ${n0} rows when a new event arrived`);
    } catch (e) {
      if (!/Timeout/.test(e.message)) throw e;
    }
  };

  try {
    await page.goto(BASE);
    await page.getByLabel('Your name').fill('Sam');
    await page.getByRole('button', { name: 'Create a room' }).click();
    await page.waitForURL(/\/r\/[A-Z]{4}$/);
    await page.getByRole('button', { name: new RegExp(`^${size.comp === 'groups' ? 'Groups' : 'Knockout'}`) }).click();
    await page.getByRole('radiogroup', { name: 'Teams' }).getByRole('radio', { name: String(size.teams), exact: true }).click();
    await page.getByRole('button', { name: /Packs/ }).click();
    await page.getByText(`${size.teams - 1} CPU teams`).first().waitFor();
    await check('lobby');
    await page.getByRole('button', { name: /^Start: you vs/ }).click();

    let matches = 0;
    let lastBeat = Date.now();
    for (let i = 0; i < 900; i++) {
      if (await page.locator('.result').count()) break;
      if (Date.now() - lastBeat > 60_000) throw new Error('stalled for 60s');
      if (await page.locator('.turn--you').count()) {
        await check('draft');
        const s = page.locator('.sealed, .pack');
        if (await s.count()) { await s.first().click({ timeout: 2000 }).catch(() => {}); await sleep(600); }
        const cards = page.locator('.board .pcard:not([disabled])');
        if (await cards.count()) { await cards.first().click().catch(() => {}); await page.keyboard.press('Enter'); lastBeat = Date.now(); await sleep(150); }
      } else if (await page.locator('.setup').count()) {
        await check('lineup');
        await page.getByRole('button', { name: /Lock in and kick off/ }).click().catch(() => {});
        lastBeat = Date.now();
      } else if (await page.locator('.mpitch').count()) {
        const first = !seen.has('match');
        await check('match');
        lastBeat = Date.now();
        if (first) await feedStaysPut();
        if (first && process.env.MID) { await sleep(Number(process.env.MID) * 1000); await page.screenshot({ path: `${SHOTS}/dev-${size.id}-mid.png` }); }
        if (await page.locator('.mskip').count()) await page.locator('.mskip').click().catch(() => {});
        const c = page.getByRole('button', { name: 'Continue' });
        if (await c.count()) { await c.click().catch(() => {}); matches++; }
      } else if (await page.locator('.hub').count()) {
        await check('hub');
        lastBeat = Date.now();
        const rdy = page.getByRole('button', { name: /Ready for the next/ });
        if (await rdy.count()) await rdy.click().catch(() => {});
      }
      await sleep(250);
    }
    await page.locator('.result').waitFor();
    await check('result');
    await page.screenshot({ path: `${SHOTS}/dev-${size.id}-result.png` });
    if (!(await page.locator('.champ').count())) throw new Error('no champion banner');
    if (matches < 1) throw new Error('never watched a match');
    if (errors.length) throw new Error(errors.slice(0, 3).join(' / '));
    console.log(`✓ ${size.label}: ${size.comp} with ${size.teams} teams, ${matches} of my matches, screens ${[...seen].join(', ')}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${size.label}: ${e.message.split('\n').slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: `${SHOTS}/dev-${size.id}-fail.png` }).catch(() => {});
  }
  await ctx.close();
}

for (const s of SIZES) await run(s);
clearTimeout(T);
await browser.close();
process.exit(failures ? 1 : 0);
