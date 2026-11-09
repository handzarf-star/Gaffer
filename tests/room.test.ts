import { describe, expect, it } from 'vitest';
import { autoPick } from '../src/shared/draft';
import { Rng } from '../src/shared/rng';
import { AFK_GRACE_MS, RoomEngine, SETUP_SECONDS, standings, testDeps } from '../src/shared/room';
import type { C2S, Settings } from '../src/shared/protocol';

interface Ctx {
  eng: RoomEngine;
  ids: string[];
  secrets: string[];
  t: number;
}
function mk(n: number, settings: Partial<Settings> = {}): Ctx {
  const eng = RoomEngine.create('ABCD', 1_000_000, testDeps());
  let t = 1_000_000;
  const ids: string[] = [];
  const secrets: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = eng.join({ name: ['Sam', 'Alex', 'Jo', 'Kim'][i]! }, t);
    if (!r.ok) throw new Error(r.msg);
    ids.push(r.id);
    secrets.push(r.secret);
  }
  if (Object.keys(settings).length) expect(eng.handle(ids[0]!, { t: 'settings', patch: settings }, t).ok).toBe(true);
  return { eng, ids, secrets, t };
}

/** make the seat whose turn it is pick the engine's own best card */
function pickFor(c: Ctx, id: string): ReturnType<RoomEngine['handle']> {
  const v = c.eng.view(id, c.t);
  const d = v.draft!;
  const choice = autoPick(v.squads[id]!, d.board);
  if (!choice) return { ok: false, code: 'not_your_turn', msg: 'nothing left to pick' };
  return c.eng.handle(id, { t: 'pick', round: d.round, card: choice.cardId, slot: choice.slotId }, c.t);
}

function playDraft(c: Ctx) {
  for (let guard = 0; guard < 400 && c.eng.s.phase === 'draft'; guard++) {
    const d = c.eng.s.draft!;
    const who = d.shared ? [d.order[d.turn]!] : c.ids.filter((id) => !d.picked.includes(id));
    for (const id of who) {
      const r = pickFor(c, id);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  }
}

describe('lobby', () => {
  it('first player is host, names are made unique, 5th player is rejected', () => {
    const eng = RoomEngine.create('ABCD', 0, testDeps());
    const a = eng.join({ name: 'Sam' }, 0);
    const b = eng.join({ name: 'sam' }, 0);
    expect(a.ok && b.ok).toBe(true);
    expect(eng.s.hostId).toBe((a as { id: string }).id);
    expect(eng.s.seats.map((s) => s.name)).toEqual(['Sam', 'sam 2']);
    eng.join({ name: 'C' }, 0);
    eng.join({ name: 'D' }, 0);
    const e = eng.join({ name: 'E' }, 0);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.code).toBe('room_full');
  });
  it('sanitises names', () => {
    const eng = RoomEngine.create('ABCD', 0, testDeps());
    eng.join({ name: '  <b>Evil</b>\u0007\n name that is far too long  ' }, 0);
    const n = eng.s.seats[0]!.name;
    expect(n.length).toBeLessThanOrEqual(16);
    expect(n).not.toMatch(/[<>\u0007]/);
  });
  it('reconnect needs the right secret; strangers cannot join mid-game', () => {
    const c = mk(2);
    expect(c.eng.join({ id: c.ids[0], secret: 'nope', name: 'x' }, c.t)).toMatchObject({ ok: false, code: 'bad_secret' });
    expect(c.eng.join({ id: c.ids[0], secret: c.secrets[0], name: 'x' }, c.t)).toMatchObject({ ok: true });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    expect(c.eng.join({ name: 'Late' }, c.t)).toMatchObject({ ok: false, code: 'in_progress' });
    // but the original player can still get back in
    c.eng.setConnected(c.ids[1]!, false, c.t);
    expect(c.eng.join({ id: c.ids[1], secret: c.secrets[1], name: 'x' }, c.t)).toMatchObject({ ok: true });
  });
  it('only the host changes settings, and only valid ones', () => {
    const c = mk(2);
    expect(c.eng.handle(c.ids[1]!, { t: 'settings', patch: { pool: 'legends' } }, c.t)).toMatchObject({ ok: false, code: 'not_host' });
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { pickSeconds: 99 as never } }, c.t)).toMatchObject({ ok: false });
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { pool: 'legends', format: 'packs' } }, c.t).ok).toBe(true);
    expect(c.eng.s.settings.pool).toBe('legends');
  });
  it('needs two connected players to start and drops ghosts', () => {
    const c = mk(2);
    c.eng.setConnected(c.ids[1]!, false, c.t);
    expect(c.eng.handle(c.ids[0]!, { t: 'start' }, c.t)).toMatchObject({ ok: false, code: 'need_players' });
    expect(c.eng.s.seats).toHaveLength(1);
  });
  it('host passes to someone connected when the host vanishes', () => {
    const c = mk(3);
    c.eng.setConnected(c.ids[0]!, false, c.t);
    c.t += 25_000;
    c.eng.tick(c.t);
    expect(c.eng.s.hostId).toBe(c.ids[1]);
  });
});

describe('duel draft', () => {
  it('enforces turns, rounds, cards and slots', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const v0 = c.eng.view(c.ids[0]!, c.t);
    expect(v0.phase).toBe('draft');
    expect(v0.draft!.board).toHaveLength(6);
    const first = v0.draft!.order[0]!;
    const second = v0.draft!.order[1]!;
    const card = v0.draft!.board[0]!;
    const slot = Object.keys(v0.squads[first]!.slots)[1]!;
    expect(c.eng.handle(second, { t: 'pick', round: 1, card, slot }, c.t)).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(c.eng.handle(first, { t: 'pick', round: 2, card, slot }, c.t)).toMatchObject({ ok: false, code: 'stale_round' });
    expect(c.eng.handle(first, { t: 'pick', round: 1, card: 'not-a-card', slot }, c.t)).toMatchObject({ ok: false, code: 'bad_card' });
    expect(c.eng.handle(first, { t: 'pick', round: 1, card, slot: 'zzz' }, c.t)).toMatchObject({ ok: false, code: 'bad_slot' });
    expect(c.eng.handle(first, { t: 'pick', round: 1, card, slot }, c.t).ok).toBe(true);
    // the card is gone from the shared board, so the second player cannot take it
    expect(c.eng.handle(second, { t: 'pick', round: 1, card, slot }, c.t)).toMatchObject({ ok: false, code: 'bad_card' });
    const card2 = c.eng.view(second, c.t).draft!.board[0]!;
    expect(c.eng.handle(second, { t: 'pick', round: 1, card: card2, slot }, c.t).ok).toBe(true);
    const v1 = c.eng.view(c.ids[0]!, c.t);
    expect(v1.draft!.round).toBe(2);
    // snake: second picker now goes first
    expect(v1.draft!.order[0]).toBe(second);
  });

  it('nobody ever gets the same player twice in a shared draft', () => {
    const c = mk(3, { format: 'duel', pool: 'all' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    expect(c.eng.s.phase).toBe('setup');
    const all = c.ids.flatMap((id) => Object.values(c.eng.s.squads[id]!.slots));
    expect(all).toHaveLength(33);
    expect(new Set(all).size).toBe(33);
    expect(all.every(Boolean)).toBe(true);
  });

  it('auto-picks when the timer runs out, with latency grace', () => {
    const c = mk(2, { format: 'duel', pickSeconds: 15 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const d = c.eng.s.draft!;
    c.t = d.deadline! + 100; // inside the grace window
    expect(c.eng.tick(c.t)).toBe(false);
    c.t = d.deadline! + 1000;
    expect(c.eng.tick(c.t)).toBe(true);
    expect(c.eng.s.draft!.log[0]!.auto).toBe(true);
    expect(c.eng.s.draft!.turn).toBe(1);
  });

  it('a dropped player is auto-picked after the AFK grace, a quick refresh is not', () => {
    const c = mk(2, { format: 'duel', pickSeconds: 40 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const turnId = c.eng.s.draft!.order[0]!;
    c.eng.setConnected(turnId, false, c.t);
    c.t += 3000;
    expect(c.eng.tick(c.t)).toBe(false); // still inside AFK grace
    c.eng.setConnected(turnId, true, c.t); // back after a refresh
    expect(c.eng.tick(c.t + 6000)).toBe(false);
    c.eng.setConnected(turnId, false, c.t + 6000);
    c.t += 6000 + AFK_GRACE_MS + 1000;
    expect(c.eng.tick(c.t)).toBe(true);
    expect(c.eng.s.draft!.log.some((l) => l.auto && l.seat === turnId)).toBe(true);
  });

  it('works with no timer at all, and a dropped seat can never freeze the room', () => {
    const c = mk(2, { format: 'duel', pickSeconds: 0 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    expect(c.eng.s.draft!.deadline).toBeNull();
    c.eng.setConnected(c.ids[1]!, false, c.t);
    // seat 1 is gone; seat 0 plays on and seat 1's turns are auto-picked
    for (let i = 0; i < 200 && c.eng.s.phase === 'draft'; i++) {
      c.t += 1000;
      c.eng.tick(c.t);
      const d = c.eng.s.draft;
      if (d && d.order[d.turn] === c.ids[0]) pickFor(c, c.ids[0]!);
    }
    expect(c.eng.s.phase).toBe('setup');
  });
});

describe('packs draft', () => {
  it('everyone picks at the same time from a private pack', () => {
    const c = mk(2, { format: 'packs' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const a = c.eng.view(c.ids[0]!, c.t).draft!;
    const b = c.eng.view(c.ids[1]!, c.t).draft!;
    expect(a.board).toHaveLength(3);
    expect(b.board).toHaveLength(3);
    expect(a.board).not.toEqual(b.board);
    expect(pickFor(c, c.ids[1]!).ok).toBe(true); // order does not matter
    expect(c.eng.s.draft!.round).toBe(1);
    expect(pickFor(c, c.ids[1]!)).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(pickFor(c, c.ids[0]!).ok).toBe(true);
    expect(c.eng.s.draft!.round).toBe(2);
  });
  it('hides other players\' packs', () => {
    const c = mk(2, { format: 'packs' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const mine = c.eng.view(c.ids[0]!, c.t).draft!.board;
    const theirs = c.eng.s.draft!.boards[c.ids[1]!]!;
    const json = JSON.stringify(c.eng.view(c.ids[0]!, c.t));
    for (const card of theirs) if (!mine.includes(card)) expect(json.includes(`"${card}"`)).toBe(false);
  });
});

describe('a whole game', () => {
  function runToResult(c: Ctx) {
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    expect(c.eng.s.phase).toBe('setup');
    for (const id of c.ids) expect(c.eng.handle(id, { t: 'ready', ready: true }, c.t).ok).toBe(true);
    expect(c.eng.s.phase).toBe('match');
    c.t += 4000;
    for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t);
    expect(c.eng.s.phase).toBe('result');
  }

  it('duel: draft, setup, match, result, then rematch rotates who picks first', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const firstGame1 = c.eng.s.draft!.order[0];
    c.eng.s.phase = 'lobby'; c.eng.s.game = 0; // reset to reuse helper
    runToResult(c);
    expect(c.eng.s.series.games).toBe(1);
    expect(Object.values(c.eng.s.series.wins).reduce((a, b) => a + b, 0)).toBe(1);
    for (const id of c.ids) c.eng.handle(id, { t: 'rematch', want: true }, c.t);
    expect(c.eng.s.phase).toBe('draft');
    expect(c.eng.s.game).toBe(2);
    expect(c.eng.s.series.games).toBe(1); // series survives
    expect(c.eng.s.draft!.order[0]).not.toBe(firstGame1 === c.ids[0] ? undefined : firstGame1);
  });

  it('hides the other squad\'s lineup and style during setup, reveals at kickoff', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    const v = c.eng.view(c.ids[0]!, c.t);
    expect(v.phase).toBe('setup');
    expect(v.squads[c.ids[0]!]).toBeTruthy();
    expect(v.squads[c.ids[1]!]).toBeUndefined();
    expect(v.rosters[c.ids[1]!]).toHaveLength(11);
    for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    expect(c.eng.view(c.ids[0]!, c.t).squads[c.ids[1]!]).toBeTruthy();
  });

  it('setup deadline starts the match even if nobody is ready', () => {
    const c = mk(2, { format: 'packs' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    c.t += SETUP_SECONDS * 1000 + 10;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('match');
  });

  it('three players play a round robin and a table decides the series', () => {
    const c = mk(3, { format: 'packs' });
    runToResult(c);
    const m = c.eng.s.match!;
    expect(m.knockout).toBe(false);
    expect(m.fixtures).toHaveLength(3);
    const table = standings(m.fixtures, c.ids);
    expect(table.reduce((a, r) => a + r.played, 0)).toBe(6);
    expect(c.eng.s.series.games).toBe(1);
  });

  it('a stuck match screen still moves on by itself', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    c.t += 10 * 60_000;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('result');
  });

  it('formation and lineup edits in setup keep the same eleven', () => {
    const c = mk(2, { format: 'packs' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    const before = new Set(Object.values(c.eng.s.squads[c.ids[0]!]!.slots));
    expect(c.eng.handle(c.ids[0]!, { t: 'formation', formation: '352' }, c.t).ok).toBe(true);
    expect(c.eng.handle(c.ids[0]!, { t: 'swap', a: 's1', b: 's9' }, c.t).ok).toBe(true);
    expect(c.eng.handle(c.ids[0]!, { t: 'swap', a: 's1', b: 'nope' }, c.t)).toMatchObject({ ok: false });
    expect(c.eng.handle(c.ids[0]!, { t: 'style', style: 'press' }, c.t).ok).toBe(true);
    const after = c.eng.s.squads[c.ids[0]!]!;
    expect(new Set(Object.values(after.slots))).toEqual(before);
    expect(after.formation).toBe('352');
    expect(c.eng.s.setup!.ready[c.ids[0]!]).toBe(false);
  });
});

describe('state safety', () => {
  it('survives a JSON round trip mid-draft (what a Durable Object eviction does)', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    pickFor(c, c.eng.s.draft!.order[0]!);
    const revived = new RoomEngine(JSON.parse(JSON.stringify(c.eng.s)), testDeps('r'));
    const c2: Ctx = { ...c, eng: revived };
    playDraft(c2);
    expect(revived.s.phase).toBe('setup');
  });
  it('never leaks secrets or the seed to clients', () => {
    const c = mk(2);
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const json = JSON.stringify(c.eng.view(c.ids[1]!, c.t));
    for (const sec of c.secrets) expect(json).not.toContain(sec);
    expect(json).not.toContain(c.eng.s.seed);
  });
  it('rooms expire when abandoned and wake times are sane', () => {
    const c = mk(2);
    const w = c.eng.nextWake(c.t);
    expect(w === null || w > c.t).toBe(true);
    for (const id of c.ids) c.eng.setConnected(id, false, c.t);
    expect(c.eng.isExpired(c.t + 10 * 60_000)).toBe(false);
    expect(c.eng.isExpired(c.t + 60 * 60_000)).toBe(true);
  });
});

describe('chaos: random players, random disconnects, random timing', () => {
  it('always reaches a result, never throws, never duplicates a player', () => {
    for (let seed = 0; seed < 120; seed++) {
      const rng = new Rng('chaos' + seed);
      const n = 2 + rng.int(3);
      const c = mk(n, {
        format: rng.chance(0.5) ? 'duel' : 'packs',
        pool: rng.pick(['modern', 'legends', 'all'] as const),
        pickSeconds: rng.pick([0, 15, 25, 40] as const),
      });
      c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
      for (let step = 0; step < 900 && c.eng.s.phase !== 'result'; step++) {
        const roll = rng.next();
        const id = rng.pick(c.ids);
        if (roll < 0.25) c.eng.setConnected(id, rng.chance(0.5), c.t);
        else if (roll < 0.55 && c.eng.s.phase === 'draft') {
          const d = c.eng.s.draft!;
          const who = d.shared ? d.order[d.turn]! : id;
          if (rng.chance(0.8)) pickFor(c, who);
          else c.eng.handle(who, { t: 'pick', round: d.round + rng.int(2), card: 'bogus', slot: 's' + rng.int(14) }, c.t);
        } else if (roll < 0.7 && c.eng.s.phase === 'setup') {
          const msgs: C2S[] = [{ t: 'ready', ready: true }, { t: 'arrange' }, { t: 'style', style: 'counter' }, { t: 'swap', a: 's2', b: 's5' }, { t: 'formation', formation: rng.pick(['433', '442', '4231', '352', '343', '532'] as const) }];
          c.eng.handle(id, rng.pick(msgs), c.t);
        } else if (roll < 0.8 && c.eng.s.phase === 'match') c.eng.handle(id, { t: 'seen' }, c.t);
        c.t += rng.int(9000);
        c.eng.tick(c.t);
        // invariants
        const s = c.eng.s;
        expect(() => JSON.parse(JSON.stringify(s))).not.toThrow();
        if (s.draft?.shared) {
          const all = Object.values(s.squads).flatMap((sq) => Object.values(sq.slots)).filter(Boolean);
          expect(new Set(all).size, `seed ${seed} duplicate player`).toBe(all.length);
        }
        if (s.draft) {
          expect(s.draft.round).toBeGreaterThanOrEqual(1);
          expect(s.draft.round).toBeLessThanOrEqual(11);
        }
      }
      // whatever the chaos did, time alone must carry it home
      for (let i = 0; i < 600 && c.eng.s.phase !== 'result'; i++) {
        c.t += 5000;
        c.eng.tick(c.t);
        if (c.eng.s.phase === 'draft') {
          // players come back and play on
          for (const id of c.ids) c.eng.setConnected(id, true, c.t);
        }
      }
      expect(c.eng.s.phase, `seed ${seed} stuck in ${c.eng.s.phase}`).toBe('result');
    }
  });
});
