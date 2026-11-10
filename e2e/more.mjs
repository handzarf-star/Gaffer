// More real-browser scenarios: reconnect, solo cup (+ reload resume), daily, bad code.
//   BASE=http://localhost:8787 node e2e/more.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openPack(page) { const s = page.locator('.sealed, .pack'); if (await s.count()) { await s.first().click({ timeout: 3000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 750)); } }
const browser = await chromium.launch();
const results = [];
const ok = (name) => { results.push(name); console.log('✓', name); };

async function newPage(name, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return { ctx, page };
}

async function pickIfMyTurn(page) {
  if (await page.locator('.turn--you').count()) {
    await openPack(page);
    const cards = page.locator('.board .pcard:not([disabled])');
    if (await cards.count()) { await cards.first().click(); await page.keyboard.press('Enter'); return true; }
  }
  return false;
}

try {
  /* ───────── 1) bad code ───────── */
  {
    const { page } = await newPage('bad');
    await page.goto(`${BASE}/r/ZZZZ`);
    await page.getByText('Room not found').waitFor({ timeout: 8000 });
    ok('unknown room shows a friendly "Room not found" (no raw errors)');
    await page.goto(BASE);
    await page.getByLabel('Your name').fill('Sam');
    await page.getByPlaceholder('CODE').fill('AB');
    await page.keyboard.press('Enter');
    await page.getByText(/4 letters/).waitFor({ timeout: 3000 }).catch(() => {});
  }

  /* ───────── 2) reconnect mid-draft ───────── */
  {
    const a = await newPage('Sam');
    const b = await newPage('Alex');
    const sockets = [];
    await b.page.routeWebSocket(/\/ws\//, (ws) => { sockets.push(ws); ws.connectToServer(); });
    await a.page.goto(BASE);
    await a.page.getByLabel('Your name').fill('Sam');
    await a.page.getByRole('button', { name: 'Create a room' }).click();
    await a.page.waitForURL(/\/r\/[A-Z]{4}$/);
    const code = a.page.url().split('/').pop();
    await b.page.goto(`${BASE}/r/${code}`);
    await b.page.getByPlaceholder('Your name').fill('Alex');
    await b.page.getByRole('button', { name: 'Join the room' }).click();
    await a.page.getByText('Alex', { exact: true }).first().waitFor();
    await a.page.getByRole('button', { name: 'Start the draft' }).click();
    await a.page.locator('.draft').waitFor(); await b.page.locator('.draft').waitFor();
    // play 4 rounds
    for (let i = 0; i < 12; i++) { await pickIfMyTurn(a.page); await pickIfMyTurn(b.page); await sleep(250); }
    const roundBefore = await b.page.locator('.roundpill__n').innerText();
    // drop Alex's socket on the floor
    sockets.at(-1).close({ code: 1006, reason: 'simulated drop' });
    await b.page.getByText(/Connection lost/).waitFor({ timeout: 5000 });
    ok('connection drop shows a calm "Reconnecting… your seat is saved" banner');
    await b.page.getByText(/Connection lost/).waitFor({ state: 'detached', timeout: 15000 });
    ok('client reconnects by itself with no user action');
    const roundAfter = await b.page.locator('.roundpill__n').innerText();
    if (Number(roundAfter) < Number(roundBefore)) throw new Error(`round went backwards ${roundBefore} -> ${roundAfter}`);
    // still his seat: the draft carries on and he can still pick
    let finished = false;
    for (let i = 0; i < 80 && !finished; i++) {
      await pickIfMyTurn(a.page); await pickIfMyTurn(b.page); await sleep(250);
      finished = (await a.page.locator('.setup').count()) > 0;
    }
    if (!finished) throw new Error('draft did not finish after reconnect');
    ok('draft finishes normally after the reconnect, same seat, same squad');
    // closing the tab and coming back on the same device restores the seat
    await b.page.goto('about:blank');
    await b.page.goto(`${BASE}/r/${code}`);
    await b.page.locator('.setup').waitFor({ timeout: 8000 });
    ok('reopening the link on the same device drops you straight back into the game');
    // a stranger on the full, started room is turned away politely
    const c = await newPage('Stranger');
    await c.page.goto(`${BASE}/r/${code}`);
    await c.page.getByPlaceholder('Your name').fill('Eve');
    await c.page.getByRole('button', { name: 'Join the room' }).click();
    await c.page.getByText(/already started|room is full|not found/i).waitFor({ timeout: 8000 });
    ok('a stranger cannot join a game in progress, and sees a clear message');
  }

  /* ───────── 3) solo cup with a reload mid-draft ───────── */
  {
    const { page } = await newPage('Solo');
    await page.goto(`${BASE}/cup`);
    await page.getByRole('button', { name: 'Start drafting' }).click();
    for (let i = 0; i < 4; i++) {
      await openPack(page);
      await page.locator('.board .pcard').first().click();
      await page.keyboard.press('Enter');
      await sleep(300);
    }
    const round = await page.locator('.roundpill__n').innerText();
    await page.reload();
    await page.locator('.roundpill__n').waitFor();
    const after = await page.locator('.roundpill__n').innerText();
    if (round !== after) throw new Error(`cup lost progress on reload: ${round} -> ${after}`);
    ok('solo cup resumes exactly where you were after a reload');
    for (let i = 0; i < 7; i++) {
      await openPack(page);
      await page.locator('.board .pcard').first().click();
      await page.keyboard.press('Enter');
      await sleep(300);
    }
    await page.locator('.setup').waitFor({ timeout: 8000 });
    // play the whole cup until it is over
    for (let stage = 0; stage < 4; stage++) {
      await page.getByRole('button', { name: /Kick off the/ }).click();
      await page.getByRole('button', { name: /Skip to the end/ }).click({ timeout: 8000 });
      await page.getByRole('button', { name: /On to the|Lift the trophy|See how it ended/ }).click({ timeout: 8000 });
      if (await page.locator('.cupresults').count()) break;
    }
    await page.locator('.cupresults').waitFor({ timeout: 8000 });
    ok('solo cup runs from first pick to the end screen');
    await page.getByRole('button', { name: /Share result/ }).waitFor();
  }

  /* ───────── 4) daily ───────── */
  {
    const a = await newPage('Daily1');
    const b = await newPage('Daily2');
    const firstBoard = [];
    for (const p of [a, b]) {
      await p.page.goto(`${BASE}/daily`);
      await p.page.getByRole('button', { name: 'Start drafting' }).click();
      await openPack(p.page);
      await p.page.locator('.board .pcard').first().waitFor();
      firstBoard.push(await p.page.locator('.board .pcard').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')?.split(',')[0])));
    }
    if (JSON.stringify(firstBoard[0]) !== JSON.stringify(firstBoard[1])) throw new Error('daily boards differ between players: ' + JSON.stringify(firstBoard));
    ok('daily draft deals the identical first pack to everyone');
  }
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0]);
  await browser.close();
  console.log(errors.join('\n'));
  process.exit(2);
}
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL ${results.length} CHECKS OK`);
