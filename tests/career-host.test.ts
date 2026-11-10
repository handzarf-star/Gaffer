import { describe, expect, it } from 'vitest';
import { CareerHost, type CareerIO, type Stored } from '../src/server/career-host';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function memoryIO(start = 1_800_000_000_000) {
  const mem: { stored: Stored | null; alarm: number | null; destroyed: boolean; now: number } = { stored: null, alarm: null, destroyed: false, now: start };
  const io: CareerIO = {
    now: () => mem.now,
    load: async () => (mem.stored ? structuredClone(mem.stored) : null),
    save: async (s) => { mem.stored = structuredClone(s); },
    schedule: async (at) => { mem.alarm = at; },
    destroy: async () => { mem.stored = null; mem.alarm = null; mem.destroyed = true; },
  };
  return { mem, io };
}
const join = (h: CareerHost, acct: string, name = 'Sam', id = 'zeljeznicar') => h.act(acct, { t: 'join', name, choice: { kind: 'real', id } });

describe('who may do what', () => {
  it('lets two accounts join, keeps the account ids out of every view, and only the owner can start', async () => {
    const { io } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    const a = await join(h, 'g_accountA');
    expect(a).toMatchObject({ ok: true });
    const b = await join(h, 'u_accountB', 'Alex', 'sarajevo');
    expect(b).toMatchObject({ ok: true });
    const view = JSON.stringify((await h.view('u_accountB')).view);
    expect(view).not.toContain('accountA');
    expect(view).not.toContain('accountB');
    expect(await h.act('u_accountB', { t: 'start' })).toMatchObject({ ok: false, code: 'owner_only', status: 403 });
    expect(await h.act('u_accountB', { t: 'settings', patch: { dayHours: 2 } })).toMatchObject({ ok: false, code: 'owner_only' });
    expect(await h.act('g_accountA', { t: 'settings', patch: { dayHours: 2 } })).toMatchObject({ ok: true });
    expect(h.state.settings.dayHours).toBe(2);
    expect(await h.act('g_accountA', { t: 'start' })).toMatchObject({ ok: true });
    expect(h.state.phase).not.toBe('lobby');
  });
  it('refuses a second join by the same account, and actions by someone who never joined', async () => {
    const { io } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_accountA');
    expect(await join(h, 'g_accountA', 'Sam again', 'sarajevo')).toMatchObject({ ok: false, code: 'joined' });
    expect(await h.act('g_stranger', { t: 'start' })).toMatchObject({ ok: false, code: 'not_member', status: 403 });
    expect(await h.act('g_stranger', { t: 'ready', ready: true })).toMatchObject({ ok: false, code: 'not_member' });
    const v = (await h.view('g_stranger')).view!;
    expect(v.me).toBeNull();
    expect(v.mine).toBeNull();
  });
  it('rejects malformed and over-long input instead of passing it to the engine', async () => {
    const { io } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    expect(await h.act('g_a', { t: 'nonsense' })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await h.act('g_a', { t: 'join', name: '', choice: { kind: 'real', id: 'x' } })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await h.act('g_a', { t: 'join', name: 'x'.repeat(100), choice: { kind: 'real', id: 'x' } })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await h.act('g_a', { t: 'join', name: 'Sam', choice: { kind: 'real', id: 'zeljeznicar' }, badge: { shape: 'x', mark: 'star', c1: '#fff', c2: 'red' } })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await h.act('g_a', { t: 'join', name: 'Sam', choice: { kind: 'custom', name: '<img src=x onerror=alert(1)>' } })).toMatchObject({ ok: false, code: 'club_name' });
  });
  it('rate-limits a flood from one account but not a different one', async () => {
    const { io } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_a');
    let limited = 0;
    for (let i = 0; i < 40; i++) { const r = await h.act('g_a', { t: 'ready', ready: true }); if (!r.ok && r.code === 'rate_limited') limited++; }
    expect(limited).toBeGreaterThan(10);
    expect(await join(h, 'g_b', 'Bo', 'sarajevo')).toMatchObject({ ok: true });
  });
});

describe('persistence and time', () => {
  it('survives a restart: reloading the saved state gives the same league', async () => {
    const { io, mem } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_a');
    await h.act('g_a', { t: 'start' });
    const before = JSON.stringify(h.state);
    const again = await CareerHost.load(io);
    expect(again).not.toBeNull();
    expect(JSON.stringify(again!.state)).toBe(before);
    // and the account mapping survived, so the same account is still the same manager
    expect((await again!.view('g_a')).view!.me).not.toBeNull();
    expect(mem.alarm).not.toBeNull();
  });
  it('plays the matchday at its deadline from the alarm, with nobody online', async () => {
    const { io, mem } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_a');
    await h.act('g_a', { t: 'start' });
    // the human's pick clock runs out, then the matchday deadline
    for (let i = 0; i < 400 && h.state.phase === 'draft'; i++) { mem.now = mem.alarm! + 1; await h.onAlarm(); }
    expect(h.state.phase).toBe('play');
    expect(h.state.day).toBe(0);
    mem.now = mem.alarm! + 1;
    await h.onAlarm();
    expect(h.state.day).toBe(1);
    expect(mem.alarm).toBeGreaterThan(mem.now);
  });
  it('a polling client gets "unchanged" when nothing happened', async () => {
    const { io } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_a');
    const first = await h.view('g_a');
    const second = await h.view('g_a', first.rev);
    expect(second.view).toBeNull();
    expect(second.rev).toBe(first.rev);
  });
  it('deletes a league nobody has visited for 120 days, but not one that is merely quiet', async () => {
    const { io, mem } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_a');
    mem.now += 100 * DAY;
    expect(await h.onAlarm()).toBe(false);
    mem.now += 30 * DAY;
    expect(await h.onAlarm()).toBe(true);
    expect(mem.destroyed).toBe(true);
  });
  it('a manager looking in resets the expiry clock', async () => {
    const { io, mem } = memoryIO();
    const h = await CareerHost.create('ABCD', 'seed', io);
    await join(h, 'g_a');
    mem.now += 100 * DAY;
    await h.view('g_a');
    mem.now += 100 * DAY;
    expect(await h.onAlarm()).toBe(false);
  });
});
