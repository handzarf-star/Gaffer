// League Night on two real phone browsers against the real local runtime: start a league from the home page, name a club,
// a friend joins by link, the spotlight draft (identical packs, a steal each way, "what you missed"), a league of four with CPU teams,
// the mid-season transfer window, a switch to time limits, sealed results, and the end of the season. Screens are audited with
// axe-core and checked for sideways scrolling.      BASE=http://localhost:8787 node e2e/league-night.mjs
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
async function phone(name, device = 'iPhone 13') {
  const ctx = await browser.newContext({ ...devices[device], locale: 'en-GB' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => { throw new Error(`${name} page error: ${e.message}`); });
  return { ctx, page, name };
}

let violations = 0;
async function audit(page, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(700); // let entrance animations finish: a card mid-flip is not a contrast failure
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
  for (const v of res.violations) { violations += v.nodes.length; console.log(`  ✗ ${label}: ${v.id} (${v.impact}) ${v.help} :: ${v.nodes[0].html.slice(0, 140)}`); }
  console.log(`${res.violations.length ? '✗' : '✓'} a11y ${label}`);
}
async function noSideScroll(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  must(w.sw <= w.iw + 1, `${label}: page scrolls sideways (${w.sw} > ${w.iw})`);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ln-${name}.png`) });
const phaseOf = (page) => page.evaluate(() => {
  if (document.querySelector('.window')) return 'window';
  if (document.querySelector('.draft')) return 'draft';
  if (document.querySelector('.lobby')) return 'lobby';
  if (document.querySelector('.hub')) return 'hub';
  if (document.querySelector('.result')) return 'result';
  if (document.querySelector('.setup, .setupgrid, .readybar')) return 'setup';
  if (document.querySelector('.mp, [class*="scoreboard"], .sb')) return 'match';
  return 'other';
});

/** If it is this phone's turn: open a pack (when sealed), wait out the steal window, sign the first card. Returns true if it acted. */
async function takeTurn(p) {
  const { page } = p;
  const pack = page.locator('.pack--same:not([disabled])').first();
  if (await pack.count()) {
    await pack.click();
    await page.locator('.board--spot .pcard').first().waitFor();
  }
  const mine = await page.locator('.turn--you').count();
  const cards = page.locator('.board--spot .pcard:not([disabled])');
  if (!mine || !(await cards.count())) return false;
  // the steal window: the cards are there but the pick is refused until it closes
  for (let i = 0; i < 60 && (await page.locator('.stealbar').count()); i++) await sleep(100);
  const card = page.locator('.board--spot .pcard').first();
  await card.click();           // choose
  await card.click().catch(() => undefined); // tap again: sign him where the pitch suggests
  await sleep(250);
  return true;
}

let failed = 0;
try {
  const A = await phone('Sam');
  const B = await phone('Alex', 'Pixel 7');

  // ── the front door
  await A.page.goto(BASE + '/');
  must((await A.page.getByRole('button', { name: 'Start a league' }).count()) === 1, 'the home page should have one primary action');
  must(!(await A.page.getByRole('button', { name: 'Start a run' }).isVisible().catch(() => false)), 'Solo Cup should be under "More", not on the front');
  await audit(A.page, 'home');
  await noSideScroll(A.page, 'home');
  await shot(A.page, 'home');
  await A.page.getByText('More ways to play').click();
  for (const m of ['Solo Cup', 'Daily Draft', 'Career mode']) await A.page.getByText(m, { exact: true }).waitFor();
  console.log('✓ home: one way in; Solo Cup, Daily and Career are under "More ways to play"');
  await A.page.getByLabel('Your name').fill('Sam');
  await A.page.getByRole('button', { name: 'Start a league' }).click();
  await A.page.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = A.page.url().split('/').pop();
  await A.page.locator('.lobby').waitFor();

  // ── lobby: a League Night by default, the pool up front, the rest in Advanced
  await A.page.getByRole('button', { name: 'Balkan League' }).waitFor();
  must((await A.page.getByRole('button', { name: 'Balkan League' }).getAttribute('aria-pressed')) === 'true', 'the Balkan League should be the default pool');
  must(!(await A.page.getByText('Draft style').isVisible()), 'draft style belongs in Advanced, closed by default');
  await A.page.getByText('7 CPU teams', { exact: true }).waitFor();
  await A.page.locator('#clubname').fill('Sunday Rovers');
  await A.page.locator('#clubname').blur();
  await A.page.locator('.seat b', { hasText: 'Sunday Rovers' }).waitFor();
  await A.page.getByText('Change the badge').click();
  await A.page.getByRole('radio', { name: 'Diamond' }).click();
  await audit(A.page, 'lobby (host)');
  await noSideScroll(A.page, 'lobby');
  await shot(A.page, 'lobby');
  // countries: narrowing the mix shows in the count
  const before = await A.page.locator('.pool__note').innerText();
  await A.page.getByText('All countries', { exact: true }).first().click();
  await A.page.getByRole('button', { name: /^Bosnia/ }).click();
  await A.page.getByText('1 country chosen').waitFor();
  must((await A.page.locator('.pool__note').innerText()) !== before, 'choosing a country should change how many players are in the mix');
  await A.page.getByRole('button', { name: 'Back to all countries' }).click();
  await A.page.getByRole('radio', { name: '4', exact: true }).click(); // a league of four keeps this run short
  await A.page.getByText('3 CPU teams', { exact: true }).waitFor();
  console.log(`✓ lobby ${code}: Balkan League by default, club renamed, badge edited, country filter works, CPU teams fill the league`);

  // ── a friend joins by link
  await B.page.goto(`${BASE}/r/${code}`);
  await B.page.getByRole('textbox').first().fill('Alex');
  await B.page.getByRole('button', { name: 'Join the room' }).click();
  await B.page.locator('.lobby').waitFor();
  await A.page.locator('.seat b', { hasText: 'Alex FC' }).waitFor();
  await B.page.getByText('Waiting for Sam to start').waitFor();
  await audit(B.page, 'lobby (guest)');
  await A.page.getByRole('button', { name: 'Start the draft' }).click();
  for (const p of [A, B]) await p.page.locator('.draft').waitFor();
  console.log('✓ a friend joined by link; the host started the draft');

  // ── the spotlight draft
  await A.page.locator('.pack--same').first().waitFor();
  must((await A.page.locator('.pack--same').count()) === 3, 'three sealed packs');
  must((await A.page.locator('.pack--same:not([disabled])').count()) === 3, 'the manager on the clock can open any of them');
  must((await B.page.locator('.pack--same:not([disabled])').count()) === 0, 'the manager who is watching cannot');
  // what the eye gets: the label a sighted person reads, the wrapper and its glow (the hidden screen-reader text is allowed to differ)
  const faces = await A.page.locator('.pack--same').evaluateAll((els) => els.map((e) => (e.querySelector('.pack__tap')?.textContent ?? '') + '|' + getComputedStyle(e).backgroundImage + '|' + getComputedStyle(e).boxShadow + '|' + e.getBoundingClientRect().width.toFixed(0)));
  must(new Set(faces).size === 1, 'the three packs must look exactly the same');
  must(!(await A.page.locator('.pack__chip, .pack__rumour, .pack__name').count()), 'no clues on the packs');
  await audit(A.page, 'draft: three sealed packs');
  await noSideScroll(A.page, 'draft');
  await shot(A.page, 'packs');

  // A opens a pack; B, who is watching, steals a card out of it
  await A.page.locator('.pack--same').nth(1).click();
  await B.page.locator('.board--spot .pcard').first().waitFor();
  must((await B.page.locator('.board--spot .pcard').count()) === 3, 'everyone sees the three players of the opened pack');
  await B.page.getByRole('button', { name: 'Steal' }).first().waitFor({ timeout: 3000 });
  await shot(B.page, 'steal');
  const target = (await B.page.locator('.board--spot .pcard__name').first().innerText()).trim();
  await B.page.getByRole('button', { name: 'Steal' }).first().click();
  await A.page.getByText(/Stolen!/).first().waitFor();
  await A.page.waitForFunction(() => document.querySelectorAll('.board--spot .pcard').length === 2);
  console.log(`✓ steal: Alex took ${target} out of Sam's pack; Sam picks from the two that are left`);
  must(await takeTurn(A), 'Sam should be able to pick after the steal');
  await A.page.locator('.missed').waitFor();
  must((await A.page.locator('.missed .pcard').count()) >= 6, '"what you missed" should show the two packs left sealed');
  await shot(A.page, 'missed');
  await audit(A.page, 'draft: what you missed');

  // the rest of the draft: A steals once from B on the way, to prove it works both ways
  let stoleBack = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    const [pa, pb] = [await phaseOf(A.page), await phaseOf(B.page)];
    if (pa !== 'draft' && pb !== 'draft') break;
    if (!stoleBack && (await A.page.getByRole('button', { name: 'Steal' }).count())) {
      await A.page.getByRole('button', { name: 'Steal' }).first().click().catch(() => undefined);
      stoleBack = true;
      await sleep(300);
      continue;
    }
    const acted = (await takeTurn(A)) || (await takeTurn(B));
    if (!acted) await sleep(150);
  }
  must(stoleBack, 'Sam never got the chance to steal back');
  for (const p of [A, B]) await p.page.getByRole('button', { name: 'Lock in and kick off' }).waitFor({ timeout: 30_000 });
  console.log('✓ draft finished on both phones (eleven each, a steal each way)');

  // ── line-ups, then matchday 1 (live: both watch at once)
  await audit(A.page, 'line-up');
  for (const p of [A, B]) await p.page.getByRole('button', { name: 'Lock in and kick off' }).click();
  for (const p of [A, B]) await p.page.getByRole('button', { name: /Skip/ }).waitFor({ timeout: 20_000 });
  await shot(A.page, 'match');
  for (const p of [A, B]) { await p.page.getByRole('button', { name: /Skip/ }).click(); await p.page.getByRole('button', { name: 'Continue' }).click(); }

  // ── the transfer window (after matchday 1 of 3)
  for (const p of [A, B]) await p.page.locator('.window').waitFor({ timeout: 20_000 });
  await audit(A.page, 'transfer window');
  await noSideScroll(A.page, 'window');
  let signed = false;
  for (let turn = 0; turn < 2; turn++) {
    const who = (await A.page.locator('.pack--same:not([disabled])').count()) ? A : B;
    const other = who === A ? B : A;
    await who.page.locator('.pack--same:not([disabled])').first().click();
    await other.page.locator('.window .board--spot .pcard').first().waitFor(); // played live: the other manager watches the pack open
    if (!signed) {
      await who.page.locator('.window .board--spot .pcard').first().click();
      await who.page.locator('.swaplist__row').first().waitFor();
      await shot(who.page, 'window');
      await who.page.locator('.swaplist__row').first().click();
      signed = true;
    } else {
      await who.page.getByRole('button', { name: 'Keep my squad' }).click();
    }
    await sleep(400);
  }
  for (const p of [A, B]) await p.page.locator('.hub').waitFor({ timeout: 20_000 });
  await A.page.getByText('Transfer window').first().waitFor();
  console.log('✓ transfer window: bottom of the table first, one signed a player, one kept their squad, then the table');
  await audit(A.page, 'table after the window');
  await noSideScroll(A.page, 'hub');

  // ── the evening is over: carry on with time limits
  must(!(await B.page.getByRole('button', { name: 'Finish later with time limits' }).count()), 'only the host can change the pace');
  await A.page.getByRole('button', { name: 'Finish later with time limits' }).click();
  for (const p of [A, B]) await p.page.getByText(/On a time limit: 24 hours/).waitFor();
  for (const p of [A, B]) await p.page.getByRole('button', { name: 'Ready for the next matchday' }).click();
  // on a time limit the matchday is played at once and each manager finds their match waiting
  for (const p of [A, B]) await p.page.getByText('Your match has been played').waitFor({ timeout: 20_000 });
  await audit(A.page, 'your match has been played');
  await shot(A.page, 'played');
  // B takes the score; A has not watched yet, so A's match is sealed on B's phone (unless they played each other)
  await B.page.getByRole('button', { name: 'Just show me the score' }).click();
  await B.page.locator('.hub').waitFor();
  const playedEachOther = (await B.page.locator('.fxrow.is-mine').count()) > 0 && (await B.page.locator('.fxrow.is-sealed').count()) === 0;
  if (!playedEachOther) {
    must((await B.page.locator('.fxrow.is-sealed').count()) >= 1, "Sam's unwatched match should be sealed on Alex's phone");
    await B.page.getByText('The score is sealed').first().waitFor();
    await shot(B.page, 'sealed');
  }
  await A.page.getByRole('button', { name: 'Watch the match' }).click();
  await A.page.getByRole('button', { name: /Skip/ }).click({ timeout: 20_000 });
  await A.page.getByRole('button', { name: 'Continue' }).click();
  await A.page.locator('.hub').waitFor();
  await B.page.waitForFunction(() => document.querySelectorAll('.fxrow.is-sealed').length === 0, null, { timeout: 15_000 });
  console.log(`✓ time limits: the matchday was played without waiting; ${playedEachOther ? 'they played each other' : "Sam's score stayed sealed on Alex's phone until Sam watched"}`);

  // ── the last matchday: the result waits until both have watched
  for (const p of [A, B]) await p.page.getByRole('button', { name: 'Ready for the next matchday' }).click();
  for (const p of [A, B]) await p.page.getByText('Your match has been played').waitFor({ timeout: 20_000 });
  await A.page.getByRole('button', { name: 'Just show me the score' }).click();
  await A.page.getByText('The season is over').waitFor();
  must(!(await A.page.locator('.result').count()), 'the result must wait for the last manager');
  await audit(A.page, 'season over, waiting');
  await B.page.getByRole('button', { name: 'Just show me the score' }).click();
  for (const p of [A, B]) await p.page.locator('.result').waitFor({ timeout: 20_000 });
  await A.page.getByText(/champion/i).first().waitFor();
  await audit(A.page, 'result');
  await shot(A.page, 'result');
  console.log('✓ season over: the result appeared only when both had seen their last match');

  await A.ctx.close(); await B.ctx.close();
  if (violations) throw new Error(`${violations} accessibility violation(s)`);
  console.log('\nLEAGUE NIGHT E2E OK');
} catch (e) {
  console.log(`\n✗ LEAGUE NIGHT E2E FAILED: ${e.message}`);
  failed = 1;
} finally {
  await browser.close();
}
process.exit(failed);
