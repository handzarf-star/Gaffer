// Step 6: turn the sourced squads into the career world, with an estimated rating and its basis for every player.
//   node scripts/data/build-career.mjs        ->  data/derived/career-players.json, data/derived/ratings-report.md, src/shared/career/world.gen.ts
//
// THE RATING MODEL (every number below is a choice, written down here and nowhere else):
//   rating = clubLevel + offset(rank)
//   clubLevel  the club's team rating from the supplied team-rating file (data/club-strength.json), the only absolute anchor we have.
//   rank       the player's place inside his club, by a quality score built only from sourced facts:
//                0.40 senior national-team caps (log scale) + 0.45 senior club appearances (log scale) + 0.15 has a Wikipedia article.
//              REVISED ONCE: the first weights (0.45 / 0.30 / 0.15 plus 0.10 for "age in his prime") scored a within-club rank
//              correlation of 0.31 against the supplied lists. A per-signal check on those same players showed appearances (0.45) and
//              caps (0.41) carry signal while "prime age" does not (-0.09), so age was dropped from the score. Because the revision used
//              the same 32 players it is evaluated on, the agreement figures in the report are optimistic, not out-of-sample.
//              The article term cannot be tested on that sample (31 of 32 have one); it is a plausible prior for depth players.
//   offset(r)  how far the r-th best player sits above his team rating: 8.0 - 2.4 ln r up to r = 15 (read off the supplied lists, which
//              run to about rank 15 at the best club), then falling 0.55 a place (an EXTRAPOLATION: nothing supplied reaches below rank 15).
// These are estimates and are shown as such. Nothing here is an official rating.

import fs from 'node:fs';
import path from 'node:path';
import { CLUBS } from './clubs.mjs';
import { ROOT } from './lib.mjs';
import { fold } from './wikitext.mjs';

const D = path.join(ROOT, 'data', 'derived');
const merged = JSON.parse(fs.readFileSync(path.join(D, 'merged.json'), 'utf8'));
const squads = JSON.parse(fs.readFileSync(path.join(D, 'wikipedia-squads.json'), 'utf8'));
const signals = JSON.parse(fs.readFileSync(path.join(D, 'player-signals.json'), 'utf8')).players;

/* ───────────── club level (and, if the supplied file is here, the check against it) ───────────── */
const CSV_TEAM = {
  'dinamo-zagreb': 'GNK Dinamo Zagreb', 'crvena-zvezda': 'FK Crvena Zvezda Beograd', partizan: 'FK Partizan Beograd', hajduk: 'HNK Hajduk Split',
  zeljeznicar: 'FK Željezničar Sarajevo', sarajevo: 'FK Sarajevo', rijeka: 'HNK Rijeka', osijek: 'NK Osijek', varazdin: 'NK Varaždin', vojvodina: 'FK Vojvodina Novi Sad',
  cukaricki: 'FK Čukarički Beograd', imt: 'FK IMT Beograd', 'novi-pazar': 'FK Novi Pazar', zrinjski: 'HŠK Zrinjski Mostar', borac: 'FK Borac Banjaluka', 'siroki-brijeg': 'NK Široki Brijeg',
  'radnicki-1923': 'FK Radnički 1923 Kragujevac', 'zeleznicar-pancevo': 'FK Železničar Pančevo', 'ofk-beograd': 'OFK Beograd', gorica: 'HNK Gorica', javor: 'FK Javor Matis Ivanjica',
  spartak: 'FK Spartak Subotica', 'radnik-surdulica': 'FK Radnik Surdulica', tsc: 'FK TSC Bačka Topola', vukovar: 'HNK Vukovar 1991', 'slaven-belupo': 'NK Slaven Belupo Koprivnica',
  lokomotiva: 'NK Lokomotiva Zagreb', 'mladost-lucani': 'FK Mladost Lučani', istra: 'NK Istra 1961 Pula', 'radnicki-nis': 'FK Radnički Niš', napredak: 'FK Napredak Kruševac', velez: 'FK Velež Mostar',
};
const CSV_PATH = process.env.GAFFER_RATINGS_CSV || '/root/.claude/uploads/82da9fb2-0d3f-53d6-89cb-73731f0b9f66/c15e5027-kingfaruk_balkan_teams_and_players.csv';

function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.filter((r) => r.length > 10).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

const STRENGTH_FILE = path.join(ROOT, 'data', 'club-strength.json');
let csv = null;
if (fs.existsSync(CSV_PATH)) csv = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
let strength;
if (csv) {
  const teams = new Map(csv.filter((r) => r.Record_Type === 'Team').map((r) => [r.Team_Name, Number(r.Team_Overall)]));
  strength = {};
  for (const c of CLUBS) {
    const v = teams.get(CSV_TEAM[c.id]);
    if (v === undefined) throw new Error(`club ${c.id}: "${CSV_TEAM[c.id]}" is not in the team-rating file`);
    strength[c.id] = v;
  }
  fs.writeFileSync(STRENGTH_FILE, JSON.stringify({ note: 'Club level only (one number per club) from the team-rating file supplied by the project owner. No player ratings are stored.', strength }, null, 1));
} else strength = JSON.parse(fs.readFileSync(STRENGTH_FILE, 'utf8')).strength;

/* ───────────── the model ───────────── */
const W = { caps: 0.40, apps: 0.45, article: 0.15 };
const offset = (r) => (r <= 15 ? 8.0 - 2.4 * Math.log(r) : 8.0 - 2.4 * Math.log(15) - 0.55 * (r - 15));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r1 = (x) => Math.round(x * 10) / 10;

function age(born, today) {
  if (!born || born.length < 10) return null;
  const [y, m, d] = born.split('-').map(Number);
  let a = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) a--;
  return a;
}
const TODAY = new Date(Date.UTC(2026, 10, 10)); // the retrieval date of the squads

/** Map free text from Wikidata / the infobox to one of the game's ten positions; coarse fallback from the squad table. */
export function posFrom(coarse, texts, key) {
  const t = texts.join(' ; ').toLowerCase();
  if (coarse === 'GK' || /goalkeeper/.test(t)) return 'GK';
  const side = /left/.test(t) && !/right/.test(t) ? 'L' : /right/.test(t) && !/left/.test(t) ? 'R' : null;
  if (/centre-back|center-back|central defender|sweeper|stopper/.test(t)) return 'CB';
  if (/full-back|fullback|wing-back|wingback|left-back|right-back|left back|right back/.test(t)) return side === 'R' ? 'RB' : side === 'L' ? 'LB' : (key % 2 ? 'RB' : 'LB');
  if (/defensive midfield|holding midfield|anchor|midfielder.*defensive|deep-lying/.test(t)) return 'CDM';
  if (/attacking midfield|playmaker|second striker|number 10|trequartista/.test(t)) return 'CAM';
  if (/winger|wide midfield|left midfield|right midfield|wing\b/.test(t)) return side === 'R' ? 'RW' : side === 'L' ? 'LW' : (key % 2 ? 'RW' : 'LW');
  if (/striker|centre-forward|center-forward|forward/.test(t)) return 'ST';
  if (/midfield/.test(t)) return 'CM';
  if (/defender|defence/.test(t)) return 'CB';
  return { DF: 'CB', MF: 'CM', FW: 'ST' }[coarse] ?? 'CM';
}

const hashKey = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const out = { model: { weights: W, offset: 'ratings = clubLevel + (8.0 - 2.4 ln rank), then -0.55 per place after rank 15 (extrapolated)' }, clubs: [] };
const usedIds = new Set();
const modelRank = {}; // clubId -> [{ name, rank }] for the check against the supplied lists

for (const c of CLUBS) {
  const m = merged.clubs[c.id];
  if (!m) throw new Error(`no merged data for ${c.id}`);
  const wpClub = squads.clubs[c.id];
  const linkByName = new Map(wpClub.players.map((p) => [`${p.name}|${p.no}`, p.link]));
  const rows = m.players.filter((p) => p.section === 'squad').map((p) => {
    const link = linkByName.get(`${p.name}|${p.no}`) ?? null;
    const sig = link ? signals[link] : null;
    const a = age(p.born && p.bornPrecision === 'day' ? p.born : sig?.born ?? null, TODAY);
    const caps = sig?.intlCaps ?? 0;
    const apps = sig?.clubApps ?? 0;
    const score = W.caps * (Math.log1p(caps) / Math.log1p(100)) + W.apps * (Math.log1p(apps) / Math.log1p(400)) + W.article * (sig ? 1 : 0);
    return { p, sig, a, caps, apps, score, link, texts: [...(p.positionsWd ?? []), sig?.position ?? ''] };
  });
  rows.sort((x, y) => y.score - x.score || (x.p.no ?? 99) - (y.p.no ?? 99) || x.p.name.localeCompare(y.p.name));
  const level = strength[c.id];
  const players = rows.map((r, i) => {
    const rank = i + 1;
    let id = `k-${slugify(r.p.name)}`;
    if (usedIds.has(id)) id = `${id}-${c.id}`;
    usedIds.add(id);
    const ovr = clamp(r1(level + offset(rank)), 45, 86);
    const ageKnown = r.a !== null;
    return {
      id, name: r.p.name, nat: r.p.nat, pos: posFrom(r.p.pos, r.texts, hashKey(r.p.name)), coarse: r.p.pos, ovr, age: ageKnown ? r.a : null,
      no: r.p.no, club: c.id,
      basis: { caps: r.caps, apps: r.apps, article: r.sig ? 1 : 0, rank, ageSource: ageKnown ? (r.p.born && r.p.bornPrecision === 'day' ? 'wikidata' : 'wikipedia') : null },
      sources: { wikipedia: wpClub.source.url, wikidata: r.p.wikidata?.qid ?? null, article: r.sig ? `https://en.wikipedia.org/?oldid=${r.sig.revid}` : null },
    };
  });
  modelRank[c.id] = players.map((p) => ({ name: p.name, rank: p.basis.rank }));
  out.clubs.push({ id: c.id, name: c.name, country: c.country, league: c.league, level, players });
}

/* ───────────── how good is it? (only possible with the supplied file; nothing from it is stored) ───────────── */
let report = '';
if (csv) {
  const listed = {};
  for (const r of csv.filter((x) => x.Record_Type === 'Player')) (listed[r.Team_Name] ??= []).push({ name: r.Player_Name, ovr: Number(r.Player_Overall) });
  const clubOf = Object.fromEntries(Object.entries(CSV_TEAM).map(([id, n]) => [n, id]));
  const pairs = []; // [true rank among matched, model rank among matched, true ovr, model ovr]
  let absErr = 0, n = 0, within2 = 0, within3 = 0;
  const per = [];
  for (const [team, list] of Object.entries(listed)) {
    const id = clubOf[team];
    if (!id) continue;
    const cl = out.clubs.find((c) => c.id === id);
    const matched = list.map((x) => ({ ...x, mine: cl.players.find((p) => fold(p.name) === fold(x.name)) })).filter((x) => x.mine);
    if (matched.length < 2) { for (const x of matched) { const e = Math.abs(x.mine.ovr - x.ovr); absErr += e; n++; if (e <= 2) within2++; if (e <= 3) within3++; } continue; }
    const trueOrder = [...matched].sort((a, b) => b.ovr - a.ovr).map((x) => x.name);
    const modelOrder = [...matched].sort((a, b) => a.mine.basis.rank - b.mine.basis.rank).map((x) => x.name);
    const d2 = trueOrder.reduce((s, nm, i) => s + (i - modelOrder.indexOf(nm)) ** 2, 0);
    const k = matched.length;
    per.push({ id, k, rho: k > 1 ? 1 - (6 * d2) / (k * (k * k - 1)) : 1 });
    for (const x of matched) { const e = Math.abs(x.mine.ovr - x.ovr); absErr += e; n++; if (e <= 2) within2++; if (e <= 3) within3++; }
  }
  const rho = per.length ? per.reduce((s, x) => s + x.rho * x.k, 0) / per.reduce((s, x) => s + x.k, 0) : NaN;
  report = [
    '# Rating model: how well does it agree with the supplied ratings?', '',
    `Compared on the ${n} players that appear in both the current Wikipedia squads and the supplied lists. Two caveats: the supplied lists only cover each club's best players, so this says little about depth players; and the score weights were revised once after looking at these same players, so these figures are in-sample (optimistic).`, '',
    `* mean absolute error: **${(absErr / n).toFixed(1)} rating points**`,
    `* within 2 points: ${within2}/${n}, within 3 points: ${within3}/${n}`,
    `* within-club ordering (Spearman, weighted by players per club): **${rho.toFixed(2)}** over ${per.length} clubs with 2+ matches`, '',
    ...per.map((x) => `  - ${x.id}: ${x.k} players, rho ${x.rho.toFixed(2)}`),
  ].join('\n');
  console.log(report);
}

fs.writeFileSync(path.join(D, 'career-players.json'), JSON.stringify(out, null, 1));
if (report) fs.writeFileSync(path.join(D, 'ratings-report.md'), report + '\n');
const total = out.clubs.reduce((s, c) => s + c.players.length, 0);
console.log(`\n${out.clubs.length} clubs, ${total} players. rating range ${Math.min(...out.clubs.flatMap((c) => c.players.map((p) => p.ovr)))}-${Math.max(...out.clubs.flatMap((c) => c.players.map((p) => p.ovr)))}`);

/* ───────────── the module the game imports ───────────── */
// Club colours are cosmetic starting points for the badge picker (the badge itself is always generated, never a real crest).
const COLORS = {
  'crvena-zvezda': ['#c8102e', '#ffffff'], partizan: ['#111111', '#ffffff'], 'dinamo-zagreb': ['#0b3d91', '#ffffff'],
  hajduk: ['#ffffff', '#0b3d91'], zeljeznicar: ['#1d4ed8', '#ffffff'], sarajevo: ['#7a0f2e', '#ffffff'],
};
const clubRows = out.clubs.map((c) => [c.id, c.name, c.country, c.league, COLORS[c.id] ?? null]);
const playerRows = out.clubs.flatMap((c, ci) => c.players.map((p) => [p.id, p.name, p.nat, p.pos, p.ovr, p.age, ci, p.no]));
const basisRows = out.clubs.flatMap((c) => c.players.map((p) => [p.basis.caps, p.basis.apps, p.basis.article, p.basis.rank]));
const gen = `// GENERATED by scripts/data/build-career.mjs from data/derived/career-players.json. Do not edit by hand.
// Squads: Wikipedia club articles (CC BY-SA 4.0, credit: Wikipedia contributors). Birth dates: Wikidata (CC0) or the player's Wikipedia infobox.
// Ratings are ESTIMATES from a published formula (see data/README.md), not official ratings.
import type { Pos } from '../players';

export const CLUB_ROWS: ReadonlyArray<[id: string, name: string, country: string, league: 1 | 2, colors: [string, string] | null]> = ${JSON.stringify(clubRows)};

export const PLAYER_ROWS: ReadonlyArray<[id: string, name: string, nat: string, pos: Pos, ovr: number, age: number | null, clubIndex: number, no: number | null]> = ${JSON.stringify(playerRows)};

/** why each rating is what it is: [senior caps, club appearances, has a Wikipedia article (1/0), rank inside the club]. Same order as PLAYER_ROWS. */
export const BASIS_ROWS: ReadonlyArray<[caps: number, apps: number, article: 0 | 1, rank: number]> = ${JSON.stringify(basisRows)};
`;
fs.mkdirSync(path.join(ROOT, 'src', 'shared', 'career'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'shared', 'career', 'world.gen.ts'), gen);
console.log(`wrote src/shared/career/world.gen.ts (${(gen.length / 1024).toFixed(0)} KB)`);
