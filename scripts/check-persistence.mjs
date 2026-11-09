import WebSocket from 'ws';
const base = 'http://localhost:8787';
const mode = process.argv[2];
const open = (code, hello) => new Promise((res, rej) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/' + code); const st = { ws, view: null, id: null, secret: null };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', code, ...hello })));
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'welcome') { st.id = m.id; st.secret = m.secret; } if (m.t === 'state') { st.view = m.s; res(st); } if (m.t === 'fatal') rej(new Error('fatal ' + m.code)); });
  ws.on('error', rej);
});
if (mode === 'before') {
  const { code } = await (await fetch(base + '/api/rooms', { method: 'POST' })).json();
  const a = await open(code, { name: 'Sam' }); const b = await open(code, { name: 'Alex' });
  a.ws.send(JSON.stringify({ t: 'settings', patch: { format: 'duel', pickSeconds: 15 } }));
  await new Promise(r => setTimeout(r, 200));
  a.ws.send(JSON.stringify({ t: 'start' })); await new Promise(r => setTimeout(r, 300));
  const v = a.view; const first = v.draft.order[0]; const who = first === a.id ? a : b;
  const card = v.draft.board[0]; const slot = Object.keys(v.squads[who.id].slots)[1];
  who.ws.send(JSON.stringify({ t: 'pick', round: 1, card, slot })); await new Promise(r => setTimeout(r, 300));
  console.log(JSON.stringify({ code, a: { id: a.id, secret: a.secret }, b: { id: b.id, secret: b.secret }, round: a.view.draft.round, turn: a.view.draft.turn, picks: a.view.draft.log.length, rev: a.view.rev }));
  process.exit(0);
} else {
  const s = JSON.parse(process.argv[3]);
  const a = await open(s.code, { name: 'Sam', id: s.a.id, secret: s.a.secret });
  console.log(JSON.stringify({ phase: a.view.phase, round: a.view.draft?.round, turn: a.view.draft?.turn, picks: a.view.draft?.log.length, rev: a.view.rev, seats: a.view.seats.length, boardSize: a.view.draft?.board.length }));
  process.exit(0);
}
