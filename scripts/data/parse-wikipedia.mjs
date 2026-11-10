// Step 2: turn the downloaded wikitext into squad rows with provenance. Pure parsing, no network.
//   node scripts/data/parse-wikipedia.mjs   ->  data/derived/wikipedia-squads.json
import fs from 'node:fs';
import path from 'node:path';
import { CLUBS } from './clubs.mjs';
import { RAW, ROOT } from './lib.mjs';
import { parseSquad } from './wikitext.mjs';

const index = JSON.parse(fs.readFileSync(path.join(RAW, 'wikipedia-index.json'), 'utf8'));
const out = { generatedFrom: 'Wikipedia article revisions (CC BY-SA 4.0)', clubs: {} };
for (const c of CLUBS) {
  const v = index[c.id];
  if (!v?.ok) { out.clubs[c.id] = { ok: false, why: v?.why ?? 'not fetched' }; continue; }
  const j = JSON.parse(fs.readFileSync(path.join(RAW, v.wikitextFile), 'utf8'));
  const wt = j.query.pages.find((p) => p.title === v.title).revisions[0].slots.main.content;
  const { rows, skipped } = parseSquad(wt);
  out.clubs[c.id] = {
    ok: true, name: c.name, country: c.country, league: c.league,
    source: { site: 'en.wikipedia.org', title: v.title, revid: v.revid, revisionAt: v.revisionAt, fetchedAt: v.fetchedAt, url: v.url },
    players: rows, skipped,
  };
  const sq = rows.filter((r) => r.section === 'squad'), lo = rows.filter((r) => r.section === 'loanedOut');
  const linked = rows.filter((r) => r.link).length;
  console.log(`${c.id.padEnd(14)} squad ${String(sq.length).padStart(2)}  loaned-out ${String(lo.length).padStart(2)}  linked ${String(linked).padStart(2)}/${rows.length}  skipped ${skipped.length}${skipped.length ? ' (' + [...new Set(skipped.map((s) => s.section))].join(', ') + ')' : ''}`);
}
fs.mkdirSync(path.join(ROOT, 'data', 'derived'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'wikipedia-squads.json'), JSON.stringify(out, null, 1));
