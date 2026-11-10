// Step 5: download every linked player's article and read the football infobox (caps, appearances, birth date).
// Output: data/derived/player-signals.json  {title -> {revid, ...infobox}}   NODE_USE_ENV_PROXY=1 node scripts/data/fetch-players.mjs
import fs from 'node:fs';
import path from 'node:path';
import { CLUBS } from './clubs.mjs';
import { get, ROOT, sleep } from './lib.mjs';
import { parseInfobox } from './wikitext.mjs';

const squads = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'derived', 'wikipedia-squads.json'), 'utf8'));
const titles = new Set();
for (const c of CLUBS) for (const p of squads.clubs[c.id]?.players ?? []) if (p.link) titles.add(p.link);
const list = [...titles];
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const out = {}, missing = [], noBox = [];
for (const [i, group] of chunk(list, 12).entries()) {
  const q = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: group.join('|'), redirects: '1', format: 'json', formatversion: '2' });
  const r = await get(`https://en.wikipedia.org/w/api.php?${q}`, { label: 'players' });
  const j = JSON.parse(r.body);
  const norm = new Map((j.query.normalized || []).map((x) => [x.from, x.to]));
  const redir = new Map((j.query.redirects || []).map((x) => [x.from, x.to]));
  for (const t of group) {
    const a = norm.get(t) || t, b = redir.get(a) || a;
    const page = j.query.pages.find((p) => p.title === b);
    if (!page || page.missing || !page.revisions) { missing.push(t); continue; }
    const rev = page.revisions[0];
    const box = parseInfobox(rev.slots.main.content);
    if (!box) { noBox.push(t); continue; }
    out[t] = { title: page.title, revid: rev.revid, revisionAt: rev.timestamp, fetchedAt: r.fetchedAt, ...box };
  }
  process.stdout.write(r.fromCache ? 'c' : '.');
  if (!r.fromCache) await sleep(2_000);
}
fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'player-signals.json'), JSON.stringify({ source: 'en.wikipedia.org player articles (CC BY-SA 4.0)', players: out, missing, noBox }, null, 1));
console.log(`\nlinked ${list.length}  with infobox ${Object.keys(out).length}  missing ${missing.length}  no infobox ${noBox.length}`);
