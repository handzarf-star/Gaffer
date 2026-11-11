import { describe, expect, it, vi } from 'vitest';
import { RoomHost, type Conn, type HostIO } from '../src/server/host';
import { RoomEngine, testDeps } from '../src/shared/room';
import type { RoomState, S2C } from '../src/shared/protocol';

function rig() {
  const sent: S2C[] = [];
  const persisted: RoomState[] = [];
  const raw = {};
  let id: string | null = null;
  const conn: Conn = { raw, getId: () => id, setId: (x) => { id = x; }, send: (d) => { sent.push(JSON.parse(d) as S2C); }, close: () => undefined };
  const io: HostIO = {
    conns: () => [conn], now: () => 1_000_000,
    persist: (s) => { persisted.push(structuredClone(s)); },
    schedule: () => undefined, destroy: () => undefined,
  };
  const engine = RoomEngine.create('ABCD', 1_000_000, testDeps('h'));
  const host = new RoomHost(engine, io);
  const say = (m: object) => host.onMessage(conn, JSON.stringify(m));
  return { host, engine, say, sent, persisted, errors: () => sent.filter((m): m is Extract<S2C, { t: 'err' }> => m.t === 'err') };
}

describe('a move that throws is rolled back', () => {
  it('puts the room back exactly as it was, tells the sender, saves the good state, and keeps working', async () => {
    const r = rig();
    await r.say({ t: 'hello', code: 'ABCD', name: 'Sam' });
    const before = JSON.stringify(r.engine.s);
    const realHandle = r.engine.handle.bind(r.engine);
    const spy = vi.spyOn(r.engine, 'handle').mockImplementationOnce(() => {
      // a half-applied move: several fields change, then the engine blows up
      r.engine.s.rev += 7; r.engine.s.settings.teams = 9; r.engine.s.seats[0]!.name = 'CORRUPTED'; r.engine.s.series.games = Number.NaN;
      throw new TypeError('cannot read properties of undefined');
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    r.persisted.length = 0;

    await expect(r.say({ t: 'name', name: 'Samuel' })).resolves.toBeUndefined(); // never rejects: the socket handler cannot crash
    expect(JSON.stringify(r.engine.s)).toBe(before); // byte for byte the room that existed before the move
    expect(r.engine.s.seats[0]!.name).toBe('Sam');
    expect(r.engine.s.settings.teams).toBe(JSON.parse(before).settings.teams);
    expect(Number.isNaN(r.engine.s.series.games)).toBe(false);
    expect(r.errors().at(-1)).toMatchObject({ t: 'err', code: 'internal' });
    for (const s of r.persisted) { expect(JSON.stringify(s)).not.toContain('CORRUPTED'); expect(JSON.stringify(s)).not.toContain('null,"games"'); }
    expect(quiet).toHaveBeenCalled();

    // and the very next move works normally
    spy.mockImplementation(realHandle);
    await r.say({ t: 'name', name: 'Samuel' });
    expect(r.engine.s.seats[0]!.name).toBe('Samuel');
    quiet.mockRestore();
  });

  it('a normal refusal is still just an error to the sender, with no rollback noise', async () => {
    const r = rig();
    await r.say({ t: 'hello', code: 'ABCD', name: 'Sam' });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await r.say({ t: 'pick', round: 1, card: 'x', slot: 'y' }); // nothing is being drafted: refused by the engine
    expect(r.errors().at(-1)).toMatchObject({ code: 'wrong_phase' });
    expect(quiet).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('a timer that throws is rolled back too, and does not stop the room from answering', async () => {
    const r = rig();
    await r.say({ t: 'hello', code: 'ABCD', name: 'Sam' });
    const before = JSON.stringify(r.engine.s);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(r.engine, 'tick').mockImplementationOnce(() => { r.engine.s.rev += 100; throw new Error('timer bug'); });
    await expect(r.host.onAlarm()).resolves.toBeUndefined();
    expect(r.engine.s.rev).toBeLessThan(100);
    expect(JSON.parse(before).seats).toEqual(JSON.parse(JSON.stringify(r.engine.s)).seats);
    spy.mockRestore();
    quiet.mockRestore();
  });
});
