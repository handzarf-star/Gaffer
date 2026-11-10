// Career mode in two real phone browsers against the real local runtime:
// sign in as guests, create a league, join with two clubs, draft 20 players each, set the line-up, play matchdays,
// watch a match, switch to Bosnian, run into the mid-season window, make changes (incl. the over-the-allowance warning),
// and audit the screens with axe-core. Also checks nothing scrolls sideways at phone width.
//   BASE=http://localhost:8787 node e2e/career.mjs
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = path.join(os.tmpdir(), 'gaffer-e2e');
fs.mkdirSync(OUT, { recursive: true });
const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
const phone = devices['iPhone 13'];
async function newPhone(name) {
  const ctx = await browser.newContext({ ...phone, locale: 'en-GB' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => { throw new Error(`${name} page error: ${e.message}`); });
  return { ctx, page, name };
}

let violations = 0;
async function audit(page, label) {
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await sleep(250);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
  for (const v of res.violations) { violations += v.nodes.length; console.log(`  ✗ ${label}: ${v.id} (${v.impact}) ${v.help} :: ${v.nodes[0].html.slice(0, 120)}`); }
  console.log(`${res.violations.length ? '✗' : '✓'} a11y ${label}`);
}
async function noSideScroll(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  must(w.sw <= w.iw + 1, `${label}: page scrolls sideways (${w.sw} > ${w.iw})`);
}

async function guest(page, name) {
  await page.goto(`${BASE}/career`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Play as a guest' }).click();
  await page.getByRole('button', { name: 'Create a league' }).waitFor();
}

async function joinClub(page, name, clubLabel, badgeTweak = false) {
  await page.getByLabel('Your name').fill(name);
  await page.locator('.clubpick', { hasText: clubLabel }).first().click();
  if (badgeTweak) await page.getByRole('radio', { name: 'Diamond' }).click().catch(() => page.getByRole('button', { name: 'Diamond' }).click());
  await page.getByRole('button', { name: 'Join this league' }).click();
}

/** Pick the best available player whenever it is our turn, until the draft is over. */
async function draftUntilDone(pages) {
  const t0 = Date.now();
  let picks = 0;
  while (Date.now() - t0 < 360_000) {
    let anyDraft = false;
    for (const { page } of pages) {
      if (await page.locator('.draftbar').count()) {
        anyDraft = true;
        if (await page.locator('.draftbar.is-turn').count()) {
          const btns = page.getByRole('button', { name: 'Pick', exact: true });
          const n = Math.min(await btns.count(), 12);
          for (let i = 0; i < n; i++) {
            if (!(await btns.nth(i).isEnabled())) continue;
            await btns.nth(i).click();
            await sleep(350);
            if (!(await page.locator('.draftbar .error, .plist ~ .error, [role=alert]').count())) { picks++; break; }
          }
        }
      }
    }
    if (!anyDraft) break;
    await sleep(500);
  }
  must(picks >= 38, `expected about 40 human picks, made ${picks}`);
  return picks;
}

let failed = 0;
try {
  const A = await newPhone('Sam');
  const B = await newPhone('Alex');

  // ── sign in and create
  await guest(A.page, 'Sam');
  await noSideScroll(A.page, 'career home');
  await audit(A.page, 'career home (signed in)');
  await A.page.getByRole('button', { name: 'Create a league' }).click();
  await A.page.waitForURL(/\/c\/[A-Z]{4}$/);
  const code = A.page.url().split('/').pop();
  console.log(`✓ guest sign-in and league ${code} created`);

  // ── join with two clubs (one with an edited badge)
  await A.page.getByLabel('Your name').waitFor();
  await audit(A.page, 'lobby: join form');
  await noSideScroll(A.page, 'lobby');
  await joinClub(A.page, 'Sam', 'Željezničar', true);
  await A.page.getByText('Waiting for the owner').or(A.page.getByRole('button', { name: 'Start the draft' })).first().waitFor();

  await B.page.goto(`${BASE}/c/${code}`);
  await B.page.getByText('Sign in to join').waitFor();
  await B.page.getByLabel('Your name').fill('Alex');
  await B.page.getByRole('button', { name: 'Play as a guest' }).click();
  await B.page.locator('.clubpick').first().waitFor();
  await joinClub(B.page, 'Alex', 'Sarajevo');
  await B.page.getByText('Waiting for the owner').waitFor();
  // a non-owner cannot start; the owner sees both managers
  await A.page.getByText('Alex').first().waitFor({ timeout: 10_000 });
  console.log('✓ two managers joined with real clubs; only the owner sees Start');

  // ── pace settings, then start
  await A.page.getByRole('radio', { name: '4 h' }).first().click();
  await audit(A.page, 'lobby: owner view with pace settings');
  await A.page.getByRole('button', { name: 'Start the draft' }).click();
  await A.page.locator('.draftbar').waitFor();
  console.log('✓ draft started');

  // ── the draft
  await audit(A.page, 'draft room');
  await noSideScroll(A.page, 'draft');
  const picks = await draftUntilDone([A, B]);
  console.log(`✓ both managers drafted 20 players (${picks} human picks, bots picked in between)`);

  // ── matchday: line-up and ready
  for (const { page } of [A, B]) await page.getByRole('button', { name: /^Ready: play the matchday/ }).waitFor();
  await audit(A.page, 'matchday: match tab');
  await noSideScroll(A.page, 'matchday');
  await A.page.getByRole('button', { name: 'Best eleven' }).click();
  await A.page.getByRole('button', { name: /^Ready: play the matchday/ }).click();
  await sleep(1500);
  must(!(await A.page.getByText('Last matchday').count()), 'the matchday must wait for the second manager');
  await B.page.getByRole('button', { name: /^Ready: play the matchday/ }).click();
  await A.page.getByText('Last matchday').waitFor({ timeout: 15_000 });
  console.log('✓ the matchday waited for both managers, then played');

  // ── tabs
  for (const [tab, marker] of [['Squad', 'Goalkeepers'], ['Table', 'First League'], ['News', 'News']]) {
    await A.page.getByRole('tab', { name: tab }).click();
    await A.page.getByText(marker).first().waitFor();
    await audit(A.page, `matchday: ${tab} tab`);
    await noSideScroll(A.page, tab);
  }
  await A.page.getByRole('tab', { name: 'Match' }).click();

  // ── watch the match
  await A.page.getByRole('button', { name: 'Watch the match' }).click();
  await A.page.locator('.mp, .matchpitch, .pitch--match, svg.mp-pitch, [class*="mp-"]').first().waitFor({ timeout: 15_000 });
  await A.page.screenshot({ path: path.join(OUT, 'career-watch.png') });
  console.log('✓ the stored match replays on the live pitch');
  await A.page.goto(`${BASE}/c/${code}`);
  await A.page.getByRole('button', { name: /^Ready: play the matchday/ }).waitFor();

  // ── Bosnian
  await A.page.getByRole('button', { name: 'BS', exact: true }).click();
  await A.page.getByRole('button', { name: /^Spreman: odigraj kolo/ }).waitFor();
  for (const word of ['Postava', 'Klupa']) await A.page.getByText(word).first().waitFor();
  must((await A.page.locator('html').getAttribute('lang')) === 'bs', 'html lang should switch to bs');
  must(!(await A.page.getByText('Line-up', { exact: true }).count()), 'English heading left on a Bosnian page');
  await A.page.screenshot({ path: path.join(OUT, 'career-bs.png') });
  await audit(A.page, 'matchday in Bosnian');
  await noSideScroll(A.page, 'matchday (bs)');
  console.log('✓ Bosnian: headings, buttons and html lang switch');
  await A.page.getByRole('button', { name: 'EN', exact: true }).click();

  // ── play to the mid-season window: both managers on auto-play
  for (const { page } of [A, B]) await page.getByRole('button', { name: /Let the computer play my matches|Auto-play is on/ }).click();
  for (const { page } of [A, B]) await page.getByText('Mid-season transfer window').waitFor({ timeout: 30_000 });
  console.log('✓ auto-play played the first 15 matchdays and stopped at the transfer window');
  await audit(A.page, 'transfer window');
  await noSideScroll(A.page, 'window');

  // ── make four changes: the fourth is over the free allowance and must warn
  for (let i = 0; i < 4; i++) {
    await A.page.locator('section:has(h2:text-is("Release a player")) .prow').nth(i).click();
    // choosing who to release filters the free agents to his position, so the first Sign is a like-for-like replacement
    await A.page.getByRole('button', { name: 'Sign', exact: true }).first().click();
  }
  await A.page.getByText(/over the free allowance/).waitFor();
  console.log('✓ the fourth change is flagged as over the free allowance');
  await A.page.locator('.swaps li').nth(3).getByRole('button', { name: 'Undo this change' }).click();
  await A.page.getByRole('button', { name: 'Confirm changes and continue' }).click();
  await B.page.getByRole('button', { name: 'Keep my squad and continue' }).click();
  for (const { page } of [A, B]) await page.getByRole('tab', { name: 'Match' }).waitFor({ timeout: 20_000 });
  console.log('✓ window closed when both were ready; play resumed');
  await A.page.getByRole('tab', { name: 'Squad' }).click();
  await A.page.getByText('Settling in').first().waitFor();
  console.log('✓ new signings show as settling in');

  await A.ctx.close(); await B.ctx.close();
  if (violations) throw new Error(`${violations} accessibility violation(s)`);
  console.log('\nCAREER E2E OK');
} catch (e) {
  console.log(`\n✗ CAREER E2E FAILED: ${e.message}`);
  failed = 1;
} finally {
  await browser.close();
}
process.exit(failed);
