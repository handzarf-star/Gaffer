// Step 3: resolve Wikipedia article links to Wikidata items and read birth date, position, citizenship and current clubs.
// Two routes, both recorded:
//   (a) by article link:  title -> wikibase_item (Wikipedia pageprops) -> item facts (SPARQL)
//   (b) by club:          every item with "member of sports team" = the club, no end date -> label + facts
// Country codes: citizenship (P27) and country-for-sport (P1532), as IOC + ISO-3 codes (Wikidata has no FIFA codes on country items).
// Wikidata is CC0. Output: data/derived/wikidata.json.   NODE_USE_ENV_PROXY=1 node scripts/data/fetch-wikidata.mjs
import fs from 'node:fs';
import path from 'node:path';
import { CLUBS } from './clubs.mjs';
import { get, ROOT, sleep } from './lib.mjs';

const squads = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'derived', 'wikipedia-squads.json'), 'utf8'));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const qidOf = (uri) => uri?.split('/').pop() ?? null;

// ---- 1. titles -> QIDs
const titles = new Set();
for (const c of CLUBS) { const s = squads.clubs[c.id]; if (s?.ok) { titles.add(s.source.title); for (const p of s.players) if (p.link) titles.add(p.link); } }
const titleToQid = {}, unresolved = [];
for (const group of chunk([...titles], 40)) {
  const q = new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: group.join('|'), redirects: '1', format: 'json', formatversion: '2' });
  const r = await get(`https://en.wikipedia.org/w/api.php?${q}`, { label: 'pageprops' });
  const j = JSON.parse(r.body);
  const norm = new Map((j.query.normalized || []).map((x) => [x.from, x.to]));
  const redir = new Map((j.query.redirects || []).map((x) => [x.from, x.to]));
  for (const t of group) {
    const a = norm.get(t) || t, b = redir.get(a) || a;
    const page = j.query.pages.find((p) => p.title === b);
    const qid = page?.pageprops?.wikibase_item;
    if (qid) titleToQid[t] = qid; else unresolved.push({ title: t, why: page?.missing ? 'article does not exist' : page?.pageprops?.disambiguation !== undefined ? 'disambiguation page' : 'no wikidata item' });
  }
  if (!r.fromCache) await sleep(2_000);
}
console.log(`titles ${titles.size}  -> QIDs ${Object.keys(titleToQid).length}  unresolved ${unresolved.length}`);

// ---- 2. SPARQL helpers
async function sparql(query, label) {
  const r = await get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, { label, accept: 'application/sparql-results+json' });
  if (!r.fromCache) await sleep(1_500);
  return JSON.parse(r.body).results.bindings;
}
const FIELDS = `
  OPTIONAL { ?p p:P569/psv:P569 ?dn . ?dn wikibase:timeValue ?dob ; wikibase:timePrecision ?prec . }
  OPTIONAL { ?p wdt:P413 ?pos . ?pos rdfs:label ?posL . FILTER(LANG(?posL)="en") }
  OPTIONAL { { ?p wdt:P27 ?cty } UNION { ?p wdt:P1532 ?cty } OPTIONAL { ?cty wdt:P984 ?ioc } OPTIONAL { ?cty wdt:P298 ?iso } }
  OPTIONAL { ?p p:P54 ?st . ?st ps:P54 ?club . FILTER NOT EXISTS { ?st pq:P582 ?end } }
  OPTIONAL { ?p wdt:P31 ?inst }
  OPTIONAL { ?p schema:dateModified ?mod }`;
const AGG = `(SAMPLE(?dob) AS ?dob) (SAMPLE(?prec) AS ?prec) (GROUP_CONCAT(DISTINCT ?posL; separator="|") AS ?poss)
  (GROUP_CONCAT(DISTINCT ?ioc; separator="|") AS ?iocs) (GROUP_CONCAT(DISTINCT ?iso; separator="|") AS ?isos)
  (GROUP_CONCAT(DISTINCT STR(?club); separator="|") AS ?clubs) (GROUP_CONCAT(DISTINCT STR(?inst); separator="|") AS ?insts) (SAMPLE(?mod) AS ?mod)`;
const shape = (b) => ({
  qid: qidOf(b.p.value), label: b.pl?.value ?? null,
  dob: b.dob?.value?.slice(0, 10) ?? null, dobPrecision: b.prec ? Number(b.prec.value) : null, // 11 = exact day, 9 = year only
  positions: b.poss?.value ? b.poss.value.split('|') : [], codes: [...new Set([...(b.iocs?.value ? b.iocs.value.split('|') : []), ...(b.isos?.value ? b.isos.value.split('|') : [])])],
  currentClubs: b.clubs?.value ? b.clubs.value.split('|').map(qidOf) : [], human: (b.insts?.value ?? '').split('|').some((u) => u.endsWith('/Q5')), modified: b.mod?.value ?? null,
});

// ---- 3. facts for every linked item
const items = {};
const qids = [...new Set(Object.values(titleToQid))];
for (const [i, group] of chunk(qids, 40).entries()) {
  const rows = await sparql(`SELECT ?p ?pl ${AGG} WHERE { VALUES ?p { ${group.map((q) => 'wd:' + q).join(' ')} } ?p rdfs:label ?pl . FILTER(LANG(?pl)="en") ${FIELDS} } GROUP BY ?p ?pl`, `items-${i}`);
  for (const b of rows) { const s = shape(b); items[s.qid] = s; }
  process.stdout.write('.');
}
console.log(`\nitems with facts: ${Object.keys(items).length}/${qids.length}`);

// ---- 4. current members per club (catches players without a linked article)
const clubQid = {};
for (const c of CLUBS) { const s = squads.clubs[c.id]; if (s?.ok && titleToQid[s.source.title]) clubQid[c.id] = titleToQid[s.source.title]; }
const members = {};
for (const c of CLUBS) {
  const cq = clubQid[c.id];
  if (!cq) { members[c.id] = { ok: false, why: 'club has no wikidata item' }; continue; }
  const rows = await sparql(`SELECT ?p ?pl ${AGG} WHERE { ?p p:P54 ?s . ?s ps:P54 wd:${cq} . FILTER NOT EXISTS { ?s pq:P582 ?e } ?p rdfs:label ?pl . FILTER(LANG(?pl)="en") ${FIELDS} } GROUP BY ?p ?pl`, `members-${c.id}`);
  members[c.id] = { ok: true, club: cq, list: rows.map(shape) };
  console.log(`${c.id.padEnd(14)} ${cq}  wikidata current members: ${rows.length}`);
}
fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'wikidata.json'), JSON.stringify({ license: 'Wikidata (CC0)', retrievedAt: new Date().toISOString(), titleToQid, unresolved, clubQid, items, members }, null, 1));
