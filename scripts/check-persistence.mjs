// Hard-kills the local Cloudflare runtime (SIGKILL, no graceful shutdown) in the middle of a draft and in the middle of
// a tournament, boots it again on the same storage, and checks every room comes back exactly as it was and can still be
// played to the end. This is what a redeploy or a Durable Object eviction looks like to a room.
//   npm run check:persistence        (needs `npm run build` first)
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8700 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-persist-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;

async function boot() {
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* booting */ }
    await sleep(500);
  }
  throw new Error('server did not start');
}
function kill() {
  if (!server) return;
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
  server = null;
}
async function restart() { kill(); await sleep(1500); await boot(); }

function open(code, hello) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/${code}`);
    const st = { ws, view: null, id: null, secret: null };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', code, ...hello })));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') { st.id = m.id; st.secret = m.secret; }
      if (m.t === 'state') { st.view = m.s; res(st); }
      if (m.t === 'fatal') rej(new Error(`fatal ${m.code}`));
    });
    ws.on('error', rej);
  });
}
const send = (st, msg) => st.ws.send(JSON.stringify(msg));
const newRoom = async () => (await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()).code;
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Pick for the one human (packs): try cards and slots until the server accepts one. */
async function pickNow(st) {
  const d = st.view.draft;
  const empty = Object.entries(st.view.squads[st.id].slots).filter(([, p]) => !p).map(([k]) => k);
  const before = st.view.rev;
  for (const card of d.board.slice(0, 5)) {
    for (const slot of empty) {
      send(st, { t: 'pick', round: d.round, card, slot });
      for (let i = 0; i < 15 && st.view.rev === before; i++) await sleep(20);
      if (st.view.rev !== before) return;
    }
  }
}

/** Keep clicking whatever the current phase wants until `done(view)`. */
async function advance(st, done, ms = 150_000) {
  const t0 = Date.now();
  while (!done(st.view)) {
    if (Date.now() - t0 > ms) throw new Error(`stalled in phase ${st.view.phase}`);
    const v = st.view;
    if (v.phase === 'draft') {
      const mine = v.draft.shared ? v.draft.order[v.draft.turn] === st.id : !v.draft.picked.includes(st.id);
      if (mine) await pickNow(st);
    } else if (v.phase === 'setup' || v.phase === 'hub') send(st, { t: 'ready', ready: true });
    else if (v.phase === 'match') send(st, { t: 'seen' });
    await sleep(250);
  }
}

const snap = (v) => ({ phase: v.phase, comp: JSON.stringify(v.comp), round: v.draft?.round, turn: v.draft?.turn, picks: v.draft?.log.length, board: v.draft?.board.length, seats: v.seats.length });
// `rev` counts every change, presence included (sockets closing and reconnecting), so it may only go up
function sameSnap(label, a, b, revA, revB) {
  must(revB >= revA, `${label}: revision went backwards (${revA} -> ${revB})`);
  if (a.comp !== b.comp) {
    let i = 0; while (a.comp[i] === b.comp[i]) i++;
    console.log(`  first difference at char ${i}:\n    before: …${a.comp.slice(Math.max(0, i - 90), i + 130)}\n    after:  …${b.comp.slice(Math.max(0, i - 90), i + 130)}`);
  }
  for (const k of Object.keys(a)) must(a[k] === b[k], `${label}: "${k}" changed across the restart (${String(a[k]).slice(0, 80)} -> ${String(b[k]).slice(0, 80)})`);
}

async function draftScenario() {
  const code = await newRoom();
  const a = await open(code, { name: 'Sam' });
  const b = await open(code, { name: 'Alex' });
  send(a, { t: 'settings', patch: { format: 'duel', pickSeconds: 15 } });
  await sleep(200);
  send(a, { t: 'start' });
  await sleep(300);
  const who = a.view.draft.order[0] === a.id ? a : b;
  await pickNow(who);
  await sleep(200);
  const before = snap(a.view);
  const revBefore = a.view.rev;
  must(before.phase === 'draft' && before.picks === 1, 'draft did not reach the first pick');
  const ids = { a: { id: a.id, secret: a.secret }, b: { id: b.id, secret: b.secret } };
  a.ws.close(); b.ws.close();
  await restart();
  const a2 = await open(code, { name: 'Sam', ...ids.a });
  const b2 = await open(code, { name: 'Alex', ...ids.b });
  sameSnap('draft', before, snap(a2.view), revBefore, a2.view.rev);
  must(a2.id === ids.a.id && b2.id === ids.b.id, 'seats were not restored');
  // and the draft goes on from where it was
  const next = a2.view.draft.order[a2.view.draft.turn] === a2.id ? a2 : b2;
  const picksBefore = a2.view.draft.log.length;
  await pickNow(next);
  await sleep(200);
  must(a2.view.draft.log.length === picksBefore + 1, 'the draft could not continue after the restart');
  a2.ws.close(); b2.ws.close();
  console.log('✓ draft: killed mid-draft, same round, turn, picks and board afterwards, and the next pick works');
}

async function tournamentScenario() {
  const code = await newRoom();
  let st = await open(code, { name: 'Sam' });
  send(st, { t: 'settings', patch: { format: 'packs', competition: 'league', teams: 4, pickSeconds: 0 } });
  await sleep(250);
  must(st.view.settings.competition === 'league' && st.view.settings.teams === 4, 'lobby settings did not apply');
  send(st, { t: 'start' });
  const ids = () => ({ id: st.id, secret: st.secret });

  // kill #1: in the middle of matchday 1
  await advance(st, (v) => v.phase === 'match');
  await sleep(400);
  let before = snap(st.view);
  let revBefore = st.view.rev;
  must(before.comp !== 'null', 'no competition state in the match phase');
  let me = ids(); st.ws.close();
  await restart();
  st = await open(code, { name: 'Sam', ...me });
  sameSnap('match day 1', before, snap(st.view), revBefore, st.view.rev);
  console.log('✓ tournament: killed during matchday 1, fixtures and table identical afterwards');

  // kill #2: at the hub between matchdays, with CPU results on the table
  await advance(st, (v) => v.phase === 'hub');
  await sleep(400);
  before = snap(st.view);
  revBefore = st.view.rev;
  must(JSON.parse(before.comp).days.length >= 1, 'hub has no played matchday');
  me = ids(); st.ws.close();
  await restart();
  st = await open(code, { name: 'Sam', ...me });
  sameSnap('hub', before, snap(st.view), revBefore, st.view.rev);
  console.log('✓ tournament: killed at the hub, results and standings identical afterwards');

  // and the tournament still finishes with a champion
  await advance(st, (v) => v.phase === 'result');
  const comp = st.view.comp;
  must(comp.champion, 'no champion after the restarts');
  must(comp.days.length === 3, `a 4-team league has 3 matchdays, got ${comp.days.length}`);
  console.log('✓ tournament: played on to the end after two restarts (3 matchdays, champion crowned)');
  st.ws.close();
}

let code = 0;
try {
  await boot();
  await draftScenario();
  await tournamentScenario();
  console.log('\nPERSISTENCE OK');
} catch (e) {
  console.log(`\n✗ PERSISTENCE FAILED: ${e.message}`);
  code = 1;
} finally {
  kill();
  fs.rmSync(persist, { recursive: true, force: true });
}
process.exit(code);
