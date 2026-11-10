// Real sockets against a real host. By default spawns the Node host; set GAFFER_URL=http://localhost:8787
// to run the very same test against `wrangler dev` (Cloudflare's actual runtime).
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { autoPick } from '../src/shared/draft';
import type { RoomView, S2C, C2S } from '../src/shared/protocol';

let base = process.env.GAFFER_URL ?? '';
let child: ChildProcess | null = null;

beforeAll(async () => {
  if (base) return;
  const port = 18700 + Math.floor(Math.random() * 500);
  base = `http://localhost:${port}`;
  child = spawn('npx', ['tsx', 'src/server/node-dev.ts'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}, 30_000);
afterAll(() => child?.kill());

class Client {
  ws!: WebSocket;
  view: RoomView | null = null;
  id = '';
  secret = '';
  errors: S2C[] = [];
  fatal: S2C | null = null;
  emotes: S2C[] = [];
  closed = false;
  constructor(readonly code: string, readonly name: string) {}
  connect(identity?: { id: string; secret: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closed = false;
      this.ws = new WebSocket(base.replace('http', 'ws') + '/ws/' + this.code);
      this.ws.on('open', () => this.send({ t: 'hello', code: this.code, name: this.name, ...(identity ?? {}) }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as S2C;
        if (m.t === 'welcome') { this.id = m.id; this.secret = m.secret; }
        if (m.t === 'state') { this.view = m.s; resolve(); }
        if (m.t === 'err') this.errors.push(m);
        if (m.t === 'fatal') { this.fatal = m; resolve(); }
        if (m.t === 'emote') this.emotes.push(m);
      });
      this.ws.on('close', () => { this.closed = true; });
      this.ws.on('error', reject);
    });
  }
  send(m: C2S) { this.ws.send(JSON.stringify(m)); }
  async until(pred: (v: RoomView) => boolean, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (this.view && pred(this.view)) return this.view; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error(`timeout waiting; phase=${this.view?.phase} round=${this.view?.draft?.round}`);
  }
  close() { this.ws.close(); }
}

async function newRoom(): Promise<string> {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  expect(res.status).toBe(201);
  const { code } = (await res.json()) as { code: string };
  expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  return code;
}

describe('over real WebSockets', () => {
  it('knows which rooms exist', async () => {
    const code = await newRoom();
    expect(((await (await fetch(`${base}/api/rooms/${code}`)).json()) as { exists: boolean }).exists).toBe(true);
    expect(((await (await fetch(`${base}/api/rooms/ZZZZ`)).json()) as { exists: boolean }).exists).toBe(false);
  });

  it('plays a full duel to a result, survives a mid-draft disconnect, and keeps the series for a rematch', async () => {
    const code = await newRoom();
    const a = new Client(code, 'Sam');
    const b = new Client(code, 'Alex');
    await a.connect();
    await b.connect();
    await a.until((v) => v.seats.length === 2);
    a.send({ t: 'settings', patch: { format: 'duel', pickSeconds: 15 } });
    await b.until((v) => v.settings.pickSeconds === 15);
    b.send({ t: 'settings', patch: { pool: 'all' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(b.errors.some((e) => e.t === 'err' && e.code === 'not_host')).toBe(true);
    a.send({ t: 'start' });
    await a.until((v) => v.phase === 'draft');

    const clients = [a, b];
    let dropped = false;
    for (let step = 0; step < 60; step++) {
      const v = (await a.until(() => true)) as RoomView;
      if (v.phase !== 'draft') break;
      const d = v.draft!;
      const turnId = d.order[d.turn]!;
      const c = clients.find((x) => x.id === turnId)!;
      // Alex's connection dies in round 3; he reconnects with his saved identity a moment later
      if (!dropped && d.round === 3) {
        dropped = true;
        const saved = { id: b.id, secret: b.secret };
        b.ws.terminate();
        await new Promise((r) => setTimeout(r, 300));
        await b.connect(saved);
        expect(b.fatal).toBeNull();
        expect(b.id).toBe(saved.id);
        continue;
      }
      const cv = (c.view ?? v)!;
      const choice = autoPick(cv.squads[c.id]!, cv.draft!.board);
      if (!choice) { await new Promise((r) => setTimeout(r, 30)); continue; }
      c.send({ t: 'pick', round: d.round, card: choice.cardId, slot: choice.slotId });
      await a.until((x) => x.rev > v.rev || x.phase !== 'draft').catch(() => undefined);
    }
    await a.until((v) => v.phase === 'setup');
    await b.until((v) => v.phase === 'setup');
    expect(Object.keys(a.view!.squads)).toEqual([a.id]); // opponent lineup hidden in setup
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await a.until((v) => v.phase === 'match');
    expect(Object.keys(a.view!.squads).sort()).toEqual([a.id, b.id].sort());
    expect(a.view!.comp!.days[0]!.fixtures[0]!.result!.winner).not.toBeNull();
    a.send({ t: 'seen' });
    b.send({ t: 'seen' });
    await a.until((v) => v.phase === 'result');
    expect(a.view!.series.games).toBe(1);
    a.send({ t: 'rematch', want: true });
    b.send({ t: 'rematch', want: true });
    await a.until((v) => v.phase === 'draft' && v.game === 2);
    expect(a.view!.series.games).toBe(1);
    a.close();
    b.close();
  }, 40_000);

  it('rejects strangers mid-game and wrong secrets, replaces duplicate connections', async () => {
    const code = await newRoom();
    const a = new Client(code, 'Sam');
    const b = new Client(code, 'Alex');
    await a.connect();
    await b.connect();
    await a.until((v) => v.seats.length === 2);
    a.send({ t: 'start' });
    await a.until((v) => v.phase === 'draft');
    const late = new Client(code, 'Late');
    await late.connect();
    expect(late.fatal).toMatchObject({ t: 'fatal', code: 'in_progress' });
    const thief = new Client(code, 'Thief');
    await thief.connect({ id: a.id, secret: 'wrong' });
    expect(thief.fatal).toMatchObject({ t: 'fatal', code: 'bad_secret' });
    // same identity opens a second connection (second tab): the old one is closed, the new one works
    const again = new Client(code, 'Sam');
    await again.connect({ id: a.id, secret: a.secret });
    expect(again.fatal).toBeNull();
    for (let i = 0; i < 50 && !a.closed; i++) await new Promise((r) => setTimeout(r, 20));
    expect(a.closed).toBe(true);
    again.close();
    b.close();
  });

  it('ignores garbage and oversize messages without dying, and relays emotes', async () => {
    const code = await newRoom();
    const a = new Client(code, 'Sam');
    const b = new Client(code, 'Alex');
    await a.connect();
    await b.connect();
    a.ws.send('not json');
    a.ws.send(JSON.stringify({ t: 'pick', round: 'x' }));
    a.ws.send('x'.repeat(10_000));
    a.send({ t: 'emote', e: '🔥' });
    await new Promise((r) => setTimeout(r, 200));
    expect(a.errors.length).toBeGreaterThanOrEqual(2);
    expect(b.emotes.length).toBe(1);
    // still alive
    a.send({ t: 'name', name: 'Samuel' });
    await b.until((v) => v.seats.some((s) => s.name === 'Samuel'));
    a.close();
    b.close();
  });
});
