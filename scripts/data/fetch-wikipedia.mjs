// Step 1: download the wikitext of every club article (one API call per few titles, cached, throttle-aware).
// Writes data/raw/wikipedia-*.json (the untouched API answers) and data/raw/wikipedia-index.json (title -> revision).
//   NODE_USE_ENV_PROXY=1 node scripts/data/fetch-wikipedia.mjs   (the flag makes Node's fetch use the sandbox proxy; harmless elsewhere)
import fs from 'node:fs';
import path from 'node:path';
import { CLUBS } from './clubs.mjs';
import { get, RAW, sleep } from './lib.mjs';

const BATCH = 4; // content queries are heavy; small batches keep us well inside the API limits
const index = {};
for (let i = 0; i < CLUBS.length; i += BATCH) {
  const group = CLUBS.slice(i, i + BATCH);
  const q = new URLSearchParams({
    action: 'query', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main',
    titles: group.map((c) => c.page).join('|'), redirects: '1', format: 'json', formatversion: '2',
  });
  const r = await get(`https://en.wikipedia.org/w/api.php?${q}`, { label: 'wikipedia' });
  const j = JSON.parse(r.body);
  const redirects = new Map((j.query.redirects || []).map((x) => [x.from, x.to]));
  const normalized = new Map((j.query.normalized || []).map((x) => [x.from, x.to]));
  for (const c of group) {
    const t0 = normalized.get(c.page) || c.page;
    const title = redirects.get(t0) || t0;
    const p = j.query.pages.find((x) => x.title === title);
    if (!p || p.missing || !p.revisions) { index[c.id] = { ok: false, asked: c.page, why: 'no such article' }; continue; }
    const rev = p.revisions[0];
    index[c.id] = {
      ok: true, asked: c.page, title: p.title, pageid: p.pageid, revid: rev.revid, revisionAt: rev.timestamp,
      fetchedAt: r.fetchedAt, bytes: rev.slots.main.content.length,
      url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(p.title.replace(/ /g, '_'))}&oldid=${rev.revid}`,
      wikitextFile: path.basename(r.file),
    };
  }
  console.log(`${r.fromCache ? 'cache' : 'fetched'} ${group.map((c) => c.id).join(', ')}`);
  if (!r.fromCache) await sleep(2_500);
}
fs.writeFileSync(path.join(RAW, 'wikipedia-index.json'), JSON.stringify(index, null, 2));
const bad = Object.entries(index).filter(([, v]) => !v.ok);
console.log(`\n${Object.keys(index).length - bad.length}/${Object.keys(index).length} articles resolved`);
for (const [id, v] of bad) console.log(`  MISSING ${id}: "${v.asked}" (${v.why})`);
