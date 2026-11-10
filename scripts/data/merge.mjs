// Step 4: join Wikipedia squad rows with Wikidata facts, keep the provenance of each fact, and run the cross-checks.
//   node scripts/data/merge.mjs   ->  data/derived/merged.json  (+ coverage and discrepancy summary on stdout)
// A field is filled only from a fetched source. When the identity of a player is not certain the row simply has no Wikidata facts.
import fs from 'node:fs';
import path from 'node:path';
import { CLUBS } from './clubs.mjs';
import { ROOT } from './lib.mjs';
import { fold } from './wikitext.mjs';

const wp = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'derived', 'wikipedia-squads.json'), 'utf8'));
const wd = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'derived', 'wikidata.json'), 'utf8'));

// Code-system equivalents (not player facts): home nations play under GBR in ISO/IOC, NED/NLD, etc.
const ALIAS = { ENG: 'GBR', SCO: 'GBR', WAL: 'GBR', NIR: 'GBR', NED: 'NLD', SLO: 'SVN', CUW: 'CUR' };
const out = { builtFrom: { wikipedia: 'en.wikipedia.org revisions (CC BY-SA 4.0)', wikidata: 'Wikidata (CC0)', wikidataRetrievedAt: wd.retrievedAt }, clubs: {} };
const stat = { rows: 0, squad: 0, loanedOut: 0, viaLink: 0, viaClubName: 0, ambiguous: 0, noMatch: 0, dob: 0, dobExact: 0, natConflict: 0, clubMismatch: 0, notHuman: 0, ageOdd: 0, positions: 0 };
const problems = [];

for (const c of CLUBS) {
  const s = wp.clubs[c.id];
  if (!s?.ok) continue;
  const clubQ = wd.clubQid[c.id] ?? null;
  const byName = new Map();
  for (const m of wd.members[c.id]?.list ?? []) { const k = fold(m.label); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(m); }
  const players = [];
  for (const r of s.players) {
    stat.rows++; stat[r.section === 'squad' ? 'squad' : 'loanedOut']++;
    let item = null, how = null;
    if (r.link && wd.titleToQid[r.link] && wd.items[wd.titleToQid[r.link]]) { item = wd.items[wd.titleToQid[r.link]]; how = 'wikipedia-link'; stat.viaLink++; }
    else if (!r.link) {
      const cands = byName.get(fold(r.name)) ?? [];
      if (cands.length === 1) { item = cands[0]; how = 'club-membership+exact-name'; stat.viaClubName++; }
      else if (cands.length > 1) { how = 'ambiguous'; stat.ambiguous++; }
      else { how = 'no-match'; stat.noMatch++; }
    } else { how = 'link-unresolved'; stat.noMatch++; }

    const row = {
      club: c.id, name: r.name, no: r.no, pos: r.pos, nat: r.nat, section: r.section, captain: r.captain, loanFrom: r.loanFrom,
      born: null, bornPrecision: null, wikidata: null, positionsWd: [], identity: how, checks: {},
    };
    if (item) {
      row.wikidata = { qid: item.qid, modified: item.modified, url: `https://www.wikidata.org/wiki/${item.qid}` };
      row.positionsWd = item.positions;
      if (item.dob && item.dobPrecision != null && item.dobPrecision >= 9) { row.born = item.dobPrecision >= 11 ? item.dob : item.dob.slice(0, 4); row.bornPrecision = item.dobPrecision >= 11 ? 'day' : 'year'; }
      // cross-checks (each is true / false / null = could not be checked)
      row.checks.human = item.human;
      row.checks.nat = item.codes.length ? (item.codes.includes(r.nat) || item.codes.includes(ALIAS[r.nat])) : null;
      row.checks.club = item.currentClubs.length ? (clubQ ? item.currentClubs.includes(clubQ) : null) : null;
      const year = row.born ? Number(row.born.slice(0, 4)) : null;
      row.checks.age = year ? (new Date().getFullYear() - year >= 15 && new Date().getFullYear() - year <= 45) : null;
      if (row.checks.human === false) { stat.notHuman++; problems.push(`${c.id}: ${r.name} -> ${item.qid} is not a human item`); }
      if (row.checks.nat === false) { stat.natConflict++; problems.push(`${c.id}: ${r.name} [${r.nat}] wikidata citizenship/sport country ${item.codes.join('/')} (${item.qid})`); }
      if (row.checks.club === false && how === 'wikipedia-link') stat.clubMismatch++;
      if (row.checks.age === false) { stat.ageOdd++; problems.push(`${c.id}: ${r.name} born ${row.born} looks implausible (${item.qid})`); }
      if (row.born) { stat.dob++; if (row.bornPrecision === 'day') stat.dobExact++; }
      if (item.positions.length) stat.positions++;
    }
    players.push(row);
  }
  out.clubs[c.id] = { name: c.name, country: c.country, league: c.league, wikidataClub: clubQ, source: s.source, players };
}
fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'merged.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'problems.txt'), problems.join('\n') + '\n');

const pct = (n, d) => `${n}/${d} (${Math.round((n / d) * 100)}%)`;
const act = stat.squad;
console.log(stat);
console.log(`\nactive-squad rows ${act}: with a date of birth ${pct(out.activeDob = Object.values(out.clubs).flatMap((x) => x.players).filter((p) => p.section === 'squad' && p.born).length, act)}`);
console.log('per club (active squad): rows / with birth date / exact day');
for (const [id, cl] of Object.entries(out.clubs)) {
  const a = cl.players.filter((p) => p.section === 'squad');
  console.log(`  ${id.padEnd(14)} ${String(a.length).padStart(2)}  ${String(a.filter((p) => p.born).length).padStart(2)}  ${String(a.filter((p) => p.bornPrecision === 'day').length).padStart(2)}`);
}
console.log(`\ncross-check problems: ${problems.length} (data/derived/problems.txt)`);
for (const p of problems.slice(0, 25)) console.log('  ' + p);
