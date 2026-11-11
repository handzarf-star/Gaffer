// The pool controls in a real browser: the Balkan League default, countries, two pools at once, legends and eras, the "too thin" guard, and into the draft.
//   BASE=http://localhost:8787 node e2e/pools.mjs
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch();
const T = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(3); }, 120_000);
const errors = [];
const { defaultBrowserType, ...opts } = devices['iPhone 14'];
const page = await (await browser.newContext(opts)).newPage();
page.setDefaultTimeout(10_000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const note = () => page.locator('.pool__note').innerText();
const start = page.locator('.lobby__cta button');
const chip = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const pool = (name) => page.getByRole('button', { name, exact: true });
let step = 'start';
try {
  await page.goto(BASE);
  await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Start a league' }).click();
  await page.waitForURL(/\/r\/[A-Z]{4}$/);
  await page.locator('.lobby').waitFor();

  const waitNote = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.pool__note')?.textContent ?? ''), re.source);
  const count = async () => Number((await note()).match(/^(\d+)/)?.[1] ?? NaN);
  const changed = (n) => page.waitForFunction((n) => !document.querySelector('.pool__note')?.textContent?.startsWith(`${n} players`), n);

  step = 'balkan league';
  await waitNote(/^9\d\d players in the mix/);
  const league = await count();
  if ((await pool('Balkan League').getAttribute('aria-pressed')) !== 'true') throw new Error('the Balkan League should be the default pool');
  if (await page.getByRole('radio', { name: 'Legends too' }).count()) throw new Error("a league of today's squads has no legends to offer");
  console.log(`✓ Balkan League (the default): ${league} players, no legends switch`);

  step = 'countries';
  await page.getByText('All countries', { exact: true }).first().click();
  await chip('Serbia').click();
  await changed(league);
  const serbs = await count();
  if (!(serbs < league && serbs > 200)) throw new Error(`Serbia alone should be a few hundred players, got ${serbs}`);
  await chip('Croatia').click();
  await changed(serbs);
  if (!((await count()) > serbs)) throw new Error('a second country should add players');
  await page.getByRole('button', { name: 'Back to all countries' }).click();
  await waitNote(new RegExp(`^${league} players`));
  console.log(`✓ countries: Serbia alone is ${serbs} players; adding Croatia grows the mix; back to all`);

  step = 'premier league';
  await pool('Premier League').click();
  await changed(league);
  const both = await count();
  if (!(both > league)) throw new Error('adding a second pool should add players');
  await pool('Balkan League').click();
  await changed(both);
  const epl = await count();
  if (epl < 250) throw new Error(`only ${epl} Premier League players`);
  if (!(await chip('Up to the 70s').isDisabled())) throw new Error('an empty era should be greyed out');
  await chip('1990s').click();
  await changed(epl);
  const without90s = await count();
  if (!(without90s < epl)) throw new Error('turning an era off should shrink the pool');
  await chip('1990s').click();
  await waitNote(new RegExp(`^${epl} players`));
  console.log(`✓ two pools at once: ${both} players; Premier League alone ${epl}, ${without90s} without the 1990s`);

  step = 'legends switch';
  await page.getByRole('radio', { name: "Today's players only" }).click();
  await changed(epl);
  const today = await count();
  if (!(today < epl)) throw new Error("today's players only should be fewer");
  await page.getByRole('radio', { name: 'Legends too' }).click();
  await waitNote(new RegExp(`^${epl} players`));
  console.log(`✓ legends: ${epl} with them, ${today} without`);

  step = 'thin guard';
  for (const e of ['1990s', '2000s', '2010s', 'Today']) await chip(e).click(); // leaves only the 1980s
  await waitNote(/^Only \d+ players/);
  if (!(await start.isDisabled())) throw new Error('Start must be disabled for a thin mix');
  if (!/Too few players/.test(await start.innerText())) throw new Error('Start should say why');
  console.log('✓ a thin mix is refused, with the reason on screen and Start disabled');

  step = 'recover and draft';
  for (const e of ['1990s', '2000s', '2010s', 'Today']) await chip(e).click();
  await waitNote(new RegExp(`^${epl} players`));
  if (await start.isDisabled()) throw new Error('Start should be enabled again');
  await start.click();
  await page.locator('.draft').waitFor();
  await page.locator('.pack').first().waitFor();
  if ((await page.locator('.pack').count()) !== 3) throw new Error('expected three sealed packs');
  await page.locator('.pack').first().click();
  await page.locator('.board .pcard').first().waitFor();
  if ((await page.locator('.board .pcard').count()) !== 3) throw new Error('an opened pack holds three players');
  console.log('✓ themed draft starts: three sealed packs, open one, pick from three players');
} catch (e) {
  console.log(`FAILED at "${step}": ${e.message.split('\n')[0]}`);
  clearTimeout(T); await browser.close(); process.exit(2);
}
clearTimeout(T);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('POOLS OK');
