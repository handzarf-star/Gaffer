// Captures the README screenshots from the running app. BASE=http://localhost:8787 node scripts/screenshots.mjs
import { chromium } from '@playwright/test';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = 'docs/screens';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
async function ctx(scheme, mobile = false) {
  return browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
}
async function openPack(page) { const s = page.locator('.sealed'); if (await s.count()) { await s.first().click({ timeout: 3000 }).catch(() => {}); await sleep(900); } }

// light desktop: home + selected card
let c = await ctx('light'); let p = await c.newPage();
await p.goto(BASE); await p.getByLabel('Your name').fill('Sam'); await sleep(400);
await p.screenshot({ path: `${OUT}/home.png` });
await p.goto(`${BASE}/cup`); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.getByRole('radio', { name: 'Numbers' }).click();
await p.getByRole('button', { name: 'Start drafting' }).click(); await sleep(1500);
await p.screenshot({ path: `${OUT}/sealed-pack.png` });
await openPack(p);
for (let i = 0; i < 6; i++) { await p.locator('.board .pcard').first().click(); await p.keyboard.press('Enter'); await sleep(450); await openPack(p); }
await p.locator('.board .pcard').nth(1).click(); await sleep(500);
await p.screenshot({ path: `${OUT}/draft.png` });
for (let i = 0; i < 5; i++) { await p.keyboard.press('Escape'); await p.locator('.board .pcard').first().click(); await p.keyboard.press('Enter'); await sleep(450); await openPack(p); }
await p.locator('.setup').waitFor(); await sleep(600);
await p.screenshot({ path: `${OUT}/setup.png` });
await c.close();

// dark desktop: match
c = await ctx('dark'); p = await c.newPage();
await p.goto(`${BASE}/cup`); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.getByRole('button', { name: 'Start drafting' }).click();
for (let i = 0; i < 11; i++) { await openPack(p); await p.locator('.board .pcard').first().click(); await p.keyboard.press('Enter'); await sleep(450); }
await p.locator('.setup').waitFor(); await sleep(400);
await p.screenshot({ path: `${OUT}/setup-dark.png` });
await p.getByRole('button', { name: /Kick off/ }).click(); await sleep(14000);
await p.locator('.goalflash').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
await p.screenshot({ path: `${OUT}/match-dark.png` });
await c.close();

// mobile light: draft
c = await ctx('light', true); p = await c.newPage();
await p.goto(`${BASE}/cup`); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.getByRole('button', { name: 'Start drafting' }).click(); await sleep(1200);
await p.screenshot({ path: `${OUT}/mobile-sealed.png` });
await openPack(p); await p.locator('.board .pcard').first().click(); await sleep(400);
await p.screenshot({ path: `${OUT}/mobile-draft.png` });
await c.close();
await browser.close();
console.log('screenshots written to', OUT);
