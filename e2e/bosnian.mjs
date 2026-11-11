// Walks the main screens on a phone in Bosnian and reports (a) any sideways scrolling, (b) visible text that is still an
// English dictionary key (a string that was never wrapped in t()), (c) lines that look like leftover English.
// Screenshots go to <tmp>/gaffer-e2e/bs-*.png.     BASE=http://localhost:8787 npx tsx e2e/bosnian.mjs
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dictOf } from '../src/shared/i18n/index.ts';
import '../src/shared/i18n/bs.ts';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = path.join(os.tmpdir(), 'gaffer-e2e');
fs.mkdirSync(OUT, { recursive: true });
const bs = dictOf('bs');
const english = new Map(Object.entries(bs).filter(([k, v]) => typeof v === 'string' && v !== k).map(([k]) => [k, true]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FUNCTION_WORDS = /\b(the|and|you|your|to|of|is|are|for|with|this|that|from|will|can|has|have|not)\b/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'bs-BA' });
await ctx.addInitScript(() => { try { localStorage.setItem('gaffer:lang', '"bs"'); localStorage.setItem('gaffer:name', '"Sam"'); } catch { /* ignore */ } });
const page = await ctx.newPage();
page.setDefaultTimeout(15_000);

let problems = 0;
async function check(label) {
  await sleep(500);
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  const r = await page.evaluate(() => {
    const lines = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t.length > 2) lines.push(t);
    }
    const attrs = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((e) => ['aria-label', 'title', 'placeholder'].map((a) => e.getAttribute(a)).filter(Boolean));
    return { lines, attrs, sw: document.documentElement.scrollWidth, iw: window.innerWidth, lang: document.documentElement.lang };
  });
  const leaks = [...new Set([...r.lines, ...r.attrs].filter((t) => english.has(t)))];
  const looksEnglish = [...new Set(r.lines.filter((t) => t.split(' ').length >= 4 && /^[\x20-\x7e]+$/.test(t) && FUNCTION_WORDS.test(t)))].slice(0, 12);
  const overflow = r.sw > r.iw + 1;
  if (overflow || leaks.length) problems++;
  console.log(`${overflow || leaks.length ? '✗' : '✓'} ${label}${overflow ? `  SIDEWAYS SCROLL ${r.sw}>${r.iw}` : ''}  html lang=${r.lang}`);
  for (const l of leaks) console.log(`     untranslated (a key exists): ${JSON.stringify(l)}`);
  for (const l of looksEnglish) console.log(`     looks English? ${JSON.stringify(l)}`);
  await page.screenshot({ path: path.join(OUT, `bs-${label.replace(/\W+/g, '-')}.png`), fullPage: false });
}

await page.goto(BASE);
await check('home');
await page.getByRole('button', { name: /Pokreni ligu/ }).click();
await page.waitForURL(/\/r\/[A-Z]{4}/);
await check('lobby');
// the options most people never open, then the new draft: sealed packs, an opened pack, "what you missed"
await page.locator('details.advanced summary').click();
await page.locator('details.advanced').scrollIntoViewIfNeeded();
await check('lobby-advanced');
await page.getByRole('button', { name: /^Počni/ }).click();
await page.locator('.draft').waitFor();
await page.locator('.pack--same:not([disabled])').first().waitFor({ timeout: 90_000 });
await check('draft-packs');
await page.locator('.pack--same:not([disabled])').first().click();
await page.locator('.board--spot .pcard').first().waitFor();
await check('draft-opened');
for (let i = 0; i < 60 && (await page.locator('.stealbar').count()); i++) await sleep(100);
await page.locator('.board--spot .pcard').first().click();
await page.locator('.board--spot .pcard').first().click().catch(() => undefined);
await page.locator('.missed').waitFor();
await check('draft-missed');
await page.goto(`${BASE}/how-to-play`);
await check('how-to-play');
await page.goto(`${BASE}/cup`);
await sleep(800);
await check('cup-start');
await page.goto(`${BASE}/career`);
await check('career-home');
await browser.close();
console.log(problems ? `\n${problems} screen(s) with problems` : '\nBOSNIAN PAGES OK (no sideways scroll, no untranslated dictionary text)');
process.exit(problems ? 1 : 0);
