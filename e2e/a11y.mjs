// Automated WCAG 2.x A/AA audit (axe-core) over every screen reachable solo, in light and dark.
//   BASE=http://localhost:8787 node e2e/a11y.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openPack(page) { const s = page.locator('.sealed, .pack'); if (await s.count()) { await s.first().click({ timeout: 3000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 750)); } }
let total = 0;
const seen = new Map();

async function audit(page, label) {
  await page.locator('.goalflash').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
  await sleep(450);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
  });
  for (const v of res.violations) {
    total += v.nodes.length;
    const key = `${v.id}`;
    const entry = seen.get(key) ?? { impact: v.impact, help: v.help, where: [], sample: v.nodes[0].html.slice(0, 140) };
    entry.where.push(`${label} (${v.nodes.length})`);
    seen.set(key, entry);
  }
  console.log(`${res.violations.length ? '✗' : '✓'} ${label}: ${res.violations.length} violation type(s)`);
}

// One person against CPU teams in a 4-team league: audits the lobby with competition settings, the lineup with CPU
// teams, the live pitch, the between-matchdays hub and the final table.
async function tournament(page, scheme) {
  await page.goto(BASE); await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Create a room' }).click(); await page.getByText('Waiting for a friend').waitFor();
  await page.getByRole('button', { name: /^League/ }).click();
  await page.getByRole('button', { name: /Packs/ }).click();
  await page.getByText(/3 CPU teams/).first().waitFor(); await sleep(300);
  await audit(page, `${scheme}: lobby (league + CPU teams)`);
  await page.getByRole('button', { name: /^Start: you vs/ }).click();
  const done = new Set();
  const once = async (name, fn) => { if (!done.has(name)) { done.add(name); await fn(); } };
  for (let i = 0; i < 700 && !(await page.locator('.result').count()); i++) {
    if (await page.locator('.turn--you').count()) {
      if (await page.locator('.pack').count()) await once('packs', () => audit(page, `${scheme}: choose a pack (three sealed packs with clues)`));
      await openPack(page);
      const cards = page.locator('.board .pcard:not([disabled])');
      if (await cards.count()) { await cards.first().click().catch(() => {}); await page.keyboard.press('Enter'); await sleep(120); }
    } else if (await page.locator('.setup').count()) {
      await once('setup', () => audit(page, `${scheme}: lineup (CPU teams drafted)`));
      await page.getByRole('button', { name: /Lock in and kick off/ }).click().catch(() => {});
    } else if (await page.locator('.mpitch').count()) {
      await once('match', async () => { await sleep(7000); await audit(page, `${scheme}: tournament match (pitch)`); });
      await page.locator('.mskip').click().catch(() => {});
      const c = page.getByRole('button', { name: 'Continue' });
      if (await c.count()) await c.click().catch(() => {});
    } else if (await page.locator('.hub').count()) {
      await once('hub', () => audit(page, `${scheme}: between matchdays (results + table)`));
      const r = page.getByRole('button', { name: /Ready for the next/ });
      if (await r.count()) await r.click().catch(() => {});
    }
    await sleep(250);
  }
  await page.locator('.result').waitFor({ timeout: 20_000 });
  await audit(page, `${scheme}: tournament result (champion + table)`);
}

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true });
  const page = await ctx.newPage();
  await page.goto(BASE); await page.getByLabel('Your name').fill('Sam'); await sleep(300);
  await audit(page, `${scheme}: home`);
  await page.goto(`${BASE}/how-to-play`); await sleep(300); await audit(page, `${scheme}: how to play`);
  // lobby
  await page.goto(BASE); await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Create a room' }).click(); await page.getByText('Waiting for a friend').waitFor(); await sleep(400);
  await audit(page, `${scheme}: lobby`);
  // solo cup
  await page.goto(`${BASE}/cup`); await page.evaluate(() => localStorage.clear()); await page.reload(); await sleep(300);
  await audit(page, `${scheme}: cup intro`);
  await page.getByRole('radio', { name: 'Numbers' }).click();
  await page.getByRole('button', { name: 'Start drafting' }).click(); await audit(page, `${scheme}: sealed pack`); await openPack(page); await page.locator('.board .pcard').first().waitFor(); await sleep(900);
  await audit(page, `${scheme}: draft (cards, empty pitch)`);
  await page.locator('.board .pcard').first().click(); await sleep(300);
  await audit(page, `${scheme}: draft (card selected, fit rings)`);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10; i++) { await sleep(350); await openPack(page); await page.locator('.board .pcard').first().click(); await page.keyboard.press('Enter'); }
  await page.locator('.setup').waitFor({ timeout: 8000 }); await sleep(500);
  await audit(page, `${scheme}: setup`);
  await page.getByRole('button', { name: /Kick off/ }).click(); await sleep(1500);
  await audit(page, `${scheme}: match countdown`);
  await sleep(6000); await audit(page, `${scheme}: match live`);
  await page.getByRole('button', { name: /Skip to the end/ }).click(); await sleep(600);
  await audit(page, `${scheme}: full time`);
  await tournament(page, scheme);
  await ctx.close();
}
await browser.close();
if (seen.size) {
  console.log('\nVIOLATIONS');
  for (const [id, e] of seen) console.log(`- [${e.impact}] ${id}: ${e.help}\n    in: ${e.where.join(', ')}\n    e.g. ${e.sample}`);
  process.exit(1);
}
console.log(`\nA11Y OK: 0 WCAG A/AA violations across all audited screens`);
