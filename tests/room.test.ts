import { describe, expect, it } from 'vitest';
import { autoPick } from '../src/shared/draft';
import { Rng } from '../src/shared/rng';
import { AFK_GRACE_MS, DROP_GRACE_MS, HUB_SECONDS, ROOM_ABANDONED_MS, RoomEngine, SETUP_SECONDS, testDeps } from '../src/shared/room';
import { tables, currentDay } from '../src/shared/competition';
import type { C2S, RoomState, Settings } from '../src/shared/protocol';

interface Ctx {
  eng: RoomEngine;
  ids: string[];
  secrets: string[];
  t: number;
}
function mk(n: number, settings: Partial<Settings> = {}, prefix = 't'): Ctx {
  const eng = RoomEngine.create('ABCD', 1_000_000, testDeps(prefix));
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
  let v = c.eng.view(id, c.t);
  let d = v.draft!;
  // packs formats: choose a sealed pack first, then pick from what is inside
  if (d.board.length === 0 && d.packs?.length) {
    const r = c.eng.handle(id, { t: 'pack', round: d.round, index: 0 }, c.t);
    if (!r.ok) return r;
    v = c.eng.view(id, c.t);
    d = v.draft!;
  }
  const choice = autoPick(v.squads[id]!, d.board);
  if (!choice) return { ok: false, code: 'not_your_turn', msg: 'nothing left to pick' };
  return c.eng.handle(id, { t: 'pick', round: d.round, card: choice.cardId, slot: choice.slotId }, c.t);
}

function playDraft(c: Ctx) {
  for (let guard = 0; guard < 400 && c.eng.s.phase === 'draft'; guard++) {
    const d = c.eng.s.draft!;
    const who = d.shared || d.turns ? [d.order[d.turn]!] : c.ids.filter((id) => !d.picked.includes(id));
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
  it('drops disconnected ghosts at start, and a lone human plays a CPU team', () => {
    const c = mk(2);
    c.eng.setConnected(c.ids[1]!, false, c.t);
    expect(c.eng.handle(c.ids[0]!, { t: 'start' }, c.t).ok).toBe(true);
    expect(c.eng.s.seats.filter((x) => !x.bot)).toHaveLength(1);
    expect(c.eng.s.seats.filter((x) => x.bot)).toHaveLength(1);
    expect(c.eng.s.phase).toBe('draft');
  });
  it('settings stay consistent: competition changes reset team counts, 3 friends get a league', () => {
    const c = mk(2);
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { competition: 'knockout' } }, c.t).ok).toBe(true);
    expect(c.eng.s.settings.teams).toBe(4);
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { teams: 8 } }, c.t).ok).toBe(true);
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { teams: 6 } }, c.t)).toMatchObject({ ok: false, code: 'bad_settings' });
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { competition: 'groups' } }, c.t).ok).toBe(true);
    expect(c.eng.s.settings.teams).toBe(8);
    const three = RoomEngine.create('ABCD', 0, testDeps());
    for (const n of ['A', 'B', 'C']) three.join({ name: n }, 0);
    expect(three.s.settings.competition).toBe('league');
    expect(three.s.settings.teams).toBeGreaterThanOrEqual(4);
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
    for (const id of c.ids) c.eng.handle(id, { t: 'pack', round: 1, index: 0 }, c.t);
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
    for (const id of c.ids) c.eng.handle(id, { t: 'pack', round: 1, index: 0 }, c.t);
    const mine = c.eng.view(c.ids[0]!, c.t).draft!.board;
    const theirs = c.eng.s.draft!.boards[c.ids[1]!]!;
    const json = JSON.stringify(c.eng.view(c.ids[0]!, c.t));
    for (const card of theirs) if (!mine.includes(card)) expect(json.includes(`"${card}"`)).toBe(false);
  });
});

/** drive any game to its result by having every human do the obvious thing at every stage */
function playToResult(c: Ctx, onPhase?: (phase: string) => void) {
  let guard = 0;
  while (c.eng.s.phase !== 'result' && guard++ < 400) {
    const ph = c.eng.s.phase;
    onPhase?.(ph);
    if (ph === 'draft') playDraft(c);
    else if (ph === 'setup' || ph === 'hub') for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    else if (ph === 'match') {
      c.t += 4000;
      for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t);
    } else break;
  }
  expect(c.eng.s.phase).toBe('result');
}

describe('a whole game', () => {
  it('duel: draft, setup, match, result, then rematch rotates who picks first', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const firstGame1 = c.eng.s.draft!.order[0];
    playToResult(c);
    expect(c.eng.s.series.games).toBe(1);
    expect(c.eng.s.comp!.champion).toBeTruthy();
    for (const id of c.ids) c.eng.handle(id, { t: 'rematch', want: true }, c.t);
    expect(c.eng.s.phase).toBe('draft');
    expect(c.eng.s.game).toBe(2);
    expect(c.eng.s.series.games).toBe(1); // series survives
    expect(c.eng.s.draft!.order[0]).not.toBe(firstGame1);
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

  it('setup deadline starts the match even if nobody is ready, and a stuck match screen moves on by itself', () => {
    const c = mk(2, { format: 'packs' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    c.t += SETUP_SECONDS * 1000 + 10;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('match');
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

describe('CPU teams and tournaments', () => {
  it('one human vs a CPU: the human drafts alone, the CPU squad appears at setup, nobody shares a player', () => {
    const c = mk(1, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    expect(c.eng.s.seats.filter((x) => x.bot)).toHaveLength(1);
    expect(c.eng.s.draft!.order).toEqual([c.ids[0]]);
    playDraft(c);
    const bot = c.eng.s.seats.find((x) => x.bot)!;
    const mine = Object.values(c.eng.s.squads[c.ids[0]!]!.slots);
    const theirs = Object.values(c.eng.s.squads[bot.id]!.slots);
    expect(theirs).toHaveLength(11);
    expect(theirs.every(Boolean)).toBe(true);
    expect(theirs.filter((p) => mine.includes(p))).toHaveLength(0);
    playToResult(c);
    expect(c.eng.s.series.games).toBe(1);
  });

  it('league with two humans and two CPUs: you only watch games a human plays; CPU-vs-CPU is just a result', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const humanIds = new Set(c.ids);
    let days = 0;
    playToResult(c, (ph) => {
      if (ph !== 'match') return;
      days++;
      const day = currentDay(c.eng.s.comp!);
      for (const f of day.fixtures) {
        if (f.humans.length) {
          expect(f.result, 'a human fixture keeps its full story').toBeTruthy();
          expect(f.humans.every((h) => humanIds.has(h))).toBe(true);
        } else {
          expect(f.result, 'a CPU-only fixture is just a result').toBeNull();
          expect(f.lite).toBeTruthy();
        }
      }
      // nobody plays twice in a matchday
      const teams = day.fixtures.flatMap((f) => [f.a, f.b]);
      expect(new Set(teams).size).toBe(teams.length);
      // every human is in a fixture (4 teams, no byes), so each must watch their own
      for (const id of c.ids) expect(day.fixtures.some((f) => f.humans.includes(id))).toBe(true);
    });
    expect(days).toBe(3); // 4 teams: 3 matchdays
    expect(tables(c.eng.s.comp!)[0]!.rows.reduce((a, r) => a + r.played, 0)).toBe(12);
    expect(c.eng.s.comp!.champion).toBeTruthy();
  });

  it('two humans in different fixtures on the same matchday each watch their own, and the day waits for both', () => {
    // find a draw where the humans do not face each other on matchday 1
    for (let attempt = 0; attempt < 30; attempt++) {
      const c = mk(2, { format: 'packs', competition: 'league', teams: 4 }, 'sep' + attempt);
      c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
      playDraft(c);
      for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
      const day = currentDay(c.eng.s.comp!);
      const separate = day.fixtures.filter((f) => f.humans.length === 1);
      if (separate.length < 2) continue;
      expect(c.eng.s.phase).toBe('match');
      c.t += 4000;
      c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t);
      expect(c.eng.s.phase).toBe('match'); // still waiting for the other phone
      c.eng.handle(c.ids[1]!, { t: 'seen' }, c.t);
      expect(c.eng.s.phase).toBe('hub');
      expect(c.eng.s.hub!.played).toEqual([0]);
      return;
    }
    throw new Error('never found a draw with separate fixtures');
  });

  it('the hub lets you change tactics between matchdays and starts the next matchday when everyone is ready', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    c.t += 4000;
    for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t);
    expect(c.eng.s.phase).toBe('hub');
    expect(c.eng.handle(c.ids[0]!, { t: 'style', style: 'fortress' }, c.t).ok).toBe(true);
    expect(c.eng.handle(c.ids[0]!, { t: 'formation', formation: '532' }, c.t).ok).toBe(true);
    expect(c.eng.s.squads[c.ids[0]!]!.style).toBe('fortress');
    for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    expect(c.eng.s.phase).toBe('match');
    expect(c.eng.s.comp!.day).toBe(1);
  });

  it('a hub nobody touches moves on after its deadline', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    c.t += 4000;
    for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t);
    c.t += HUB_SECONDS * 1000 + 50;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('match');
  });

  it('knockout of 8 with two humans: when both are knocked out the CPU rounds resolve instantly', () => {
    let sawBothOut = false;
    for (let seed = 0; seed < 25 && !sawBothOut; seed++) {
      const c = mk(2, { format: 'packs', competition: 'knockout', teams: 8 }, 'ko' + seed);
      c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
      let humanDays = 0;
      playToResult(c, (ph) => { if (ph === 'match') humanDays++; });
      const comp = c.eng.s.comp!;
      expect(comp.champion).toBeTruthy();
      expect(comp.days.at(-1)!.label).toBe('Final');
      // the number of rounds a human actually watched is at most the number of rounds
      expect(humanDays).toBeLessThanOrEqual(3);
      if (humanDays < 3) sawBothOut = true;
      // finished without anyone watching a CPU-only game: those days have no full results at all
      for (const day of comp.days) for (const f of day.fixtures) if (!f.humans.length) expect(f.result).toBeNull();
    }
    expect(sawBothOut).toBe(true);
  });

  it('groups + knockout, 8 teams, finishes with a champion and a coherent series entry', () => {
    const c = mk(2, { format: 'packs', competition: 'groups', teams: 8 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playToResult(c);
    const comp = c.eng.s.comp!;
    expect(comp.days.length).toBe(5);
    expect(comp.groups).toHaveLength(2);
    expect(c.eng.s.series.log.at(-1)!.summary).toContain('won the');
  });

  it('three friends and a CPU play a league', () => {
    const c = mk(3, { format: 'packs' });
    expect(c.eng.s.settings.competition).toBe('league');
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    expect(c.eng.s.seats).toHaveLength(c.eng.s.settings.teams);
    playToResult(c);
    expect(c.eng.s.comp!.champion).toBeTruthy();
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
      const kind = n > 2 ? rng.pick(['league', 'groups', 'knockout'] as const) : rng.pick(['match', 'league', 'groups', 'knockout'] as const);
      const c = mk(n, {
        format: rng.pick(['duel', 'packs', 'turns'] as const),
        pool: rng.pick(['modern', 'legends', 'all'] as const),
        pickSeconds: rng.pick([0, 15, 25, 40] as const),
        competition: kind,
      }, 'chaos' + seed);
      const opts = { match: [2], league: [4, 6, 8], groups: [8, 16], knockout: [4, 8, 16] }[kind].filter((t) => t >= n);
      c.eng.handle(c.ids[0]!, { t: 'settings', patch: { teams: rng.pick(opts), botLevel: rng.pick(['easy', 'normal', 'hard'] as const), pace: rng.pick(['normal', 'quick'] as const) } }, c.t);
      c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
      for (let step = 0; step < 1400 && c.eng.s.phase !== 'result'; step++) {
        const roll = rng.next();
        const id = rng.pick(c.ids);
        if (roll < 0.25) c.eng.setConnected(id, rng.chance(0.5), c.t);
        else if (roll < 0.55 && c.eng.s.phase === 'draft') {
          const d = c.eng.s.draft!;
          const who = d.shared || d.turns ? d.order[d.turn]! : id;
          if (rng.chance(0.8)) pickFor(c, who);
          else c.eng.handle(who, { t: 'pick', round: d.round + rng.int(2), card: 'bogus', slot: 's' + rng.int(14) }, c.t);
        } else if (roll < 0.7 && c.eng.s.phase === 'setup') {
          const msgs: C2S[] = [{ t: 'ready', ready: true }, { t: 'arrange' }, { t: 'style', style: 'counter' }, { t: 'swap', a: 's2', b: 's5' }, { t: 'formation', formation: rng.pick(['433', '442', '4231', '352', '343', '532'] as const) }];
          c.eng.handle(id, rng.pick(msgs), c.t);
        } else if (roll < 0.8 && (c.eng.s.phase === 'match' || c.eng.s.phase === 'hub')) {
          c.eng.handle(id, c.eng.s.phase === 'match' ? { t: 'seen' } : rng.pick<C2S>([{ t: 'ready', ready: true }, { t: 'style', style: 'counter' }, { t: 'arrange' }]), c.t);
        }
        c.t += rng.int(9000);
        c.eng.tick(c.t);
        // invariants
        const s = c.eng.s;
        expect(() => JSON.parse(JSON.stringify(s))).not.toThrow();
        if (s.draft?.shared) {
          const all = Object.values(s.squads).flatMap((sq) => Object.values(sq.slots)).filter(Boolean);
          expect(new Set(all).size, `seed ${seed} duplicate player`).toBe(all.length);
        }
        // CPU teams never share a player with anyone. (Humans may overlap in the Packs format: their packs are independent.)
        if (s.phase !== 'lobby' && s.phase !== 'draft') {
          const humanSquads = s.seats.filter((x) => !x.bot).map((x) => s.squads[x.id]).filter(Boolean);
          const humanPlayers = new Set(humanSquads.flatMap((sq) => Object.values(sq!.slots)));
          const botPlayers = s.seats.filter((x) => x.bot).flatMap((x) => Object.values(s.squads[x.id]?.slots ?? {}));
          expect(new Set(botPlayers).size, `seed ${seed} two CPU teams share a player`).toBe(botPlayers.length);
          for (const p of botPlayers) expect(humanPlayers.has(p), `seed ${seed} a CPU took a human's player`).toBe(false);
          if (s.settings.format === 'duel') {
            const humanList = humanSquads.flatMap((sq) => Object.values(sq!.slots));
            expect(new Set(humanList).size, `seed ${seed} duel duplicate`).toBe(humanList.length);
          }
        }
        if (s.draft) {
          expect(s.draft.round).toBeGreaterThanOrEqual(1);
          expect(s.draft.round).toBeLessThanOrEqual(11);
        }
      }
      // whatever the chaos did, time alone must carry it home
      for (let i = 0; i < 1200 && c.eng.s.phase !== 'result'; i++) {
        c.t += 5000;
        c.eng.tick(c.t);
        // players come back and play on. A room with nobody in it is frozen on purpose, so somebody has to return.
        if (c.eng.s.phase === 'draft' || !c.eng.s.seats.some((x) => !x.bot && x.connected)) {
          for (const id of c.ids) c.eng.setConnected(id, true, c.t);
        }
      }
      expect(c.eng.s.phase, `seed ${seed} stuck in ${c.eng.s.phase}`).toBe('result');
    }
  });
});

describe('persistence', () => {
  // The Durable Object stores `core` and `comp` separately and structured-clones them. A redeploy or eviction can land
  // at any moment of a tournament, so replaying it with a save/restore at every step must change nothing.
  const play = (restoreEveryStep: boolean, comp: Partial<Settings>) => {
    const deps = testDeps('persist');
    const c: Ctx = { eng: RoomEngine.create('ABCD', 1_000_000, deps), ids: [], secrets: [], t: 1_000_000 };
    for (const name of ['Sam', 'Alex']) {
      const r = c.eng.join({ name }, c.t);
      if (!r.ok) throw new Error(r.msg);
      c.ids.push(r.id);
    }
    expect(c.eng.handle(c.ids[0]!, { t: 'settings', patch: { format: 'packs', ...comp } }, c.t).ok).toBe(true);
    expect(c.eng.handle(c.ids[0]!, { t: 'start' }, c.t).ok).toBe(true);
    let restores = 0;
    for (let guard = 0; c.eng.s.phase !== 'result' && guard < 2000; guard++) {
      if (restoreEveryStep) {
        const { comp: liveComp, ...core } = c.eng.s;
        const saved = structuredClone({ core: { ...core, comp: null }, comp: liveComp });
        c.eng = new RoomEngine({ ...saved.core, comp: saved.comp } as RoomState, deps);
        restores++;
      }
      const ph = c.eng.s.phase;
      if (ph === 'draft') {
        // one round of picks per step, so a restart lands between picks too
        const d = c.eng.s.draft!;
        for (const id of d.shared ? [d.order[d.turn]!] : c.ids.filter((x) => !d.picked.includes(x))) expect(pickFor(c, id).ok).toBe(true);
      } else if (ph === 'setup' || ph === 'hub') for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
      else if (ph === 'match') { c.t += 4000; for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t); } else break;
    }
    expect(c.eng.s.phase).toBe('result');
    return { comp: JSON.stringify(c.eng.s.comp), restores };
  };

  for (const [name, comp] of [
    ['league', { competition: 'league', teams: 4 }],
    ['groups + knockout', { competition: 'groups', teams: 8 }],
    ['knockout', { competition: 'knockout', teams: 4 }],
  ] as Array<[string, Partial<Settings>]>) {
    it(`${name}: a restart before every single step gives the identical tournament`, () => {
      const straight = play(false, comp);
      const bumpy = play(true, comp);
      expect(bumpy.restores).toBeGreaterThan(11); // every draft round, then lineups and matchdays
      expect(bumpy.comp).toBe(straight.comp);
    });
  }
});

describe('dropped connections', () => {
  const MIN = 60_000;
  const toMatch = (c: Ctx) => {
    expect(c.eng.handle(c.ids[0]!, { t: 'start' }, c.t).ok).toBe(true);
    playDraft(c);
    for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t);
    expect(c.eng.s.phase).toBe('match');
  };

  it('alone against CPU teams, a dropped connection freezes the game instead of playing the tournament without you', () => {
    const c = mk(1, { format: 'packs', competition: 'league', teams: 4 });
    toMatch(c);
    c.t = c.eng.s.day!.startedAt + 12_000; // twelve seconds into the match
    const day = structuredClone(c.eng.s.day!);
    const comp = JSON.stringify(c.eng.s.comp);
    c.eng.setConnected(c.ids[0]!, false, c.t); // the phone locks
    c.t += 20 * MIN;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('match');
    expect(JSON.stringify(c.eng.s.comp)).toBe(comp);
    c.eng.setConnected(c.ids[0]!, true, c.t); // and comes back twenty minutes later
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('match');
    // the match carries on from the same minute: elapsed time is unchanged, so the clock moved by the time away
    expect(c.eng.s.day!.startedAt - day.startedAt).toBeCloseTo(20 * MIN, 0);
    expect(c.eng.s.day!.deadline - day.deadline).toBeCloseTo(20 * MIN, 0);
    expect(c.t - c.eng.s.day!.startedAt).toBeCloseTo(12_000, 0);
    playToResult(c);
    expect(c.eng.s.comp!.champion).toBeTruthy();
  });

  it('a pick timer has the same time left after everyone was away', () => {
    const c = mk(1, { format: 'packs', competition: 'league', teams: 4, pickSeconds: 15 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const d0 = c.eng.s.draft!;
    const left = d0.deadline! - c.t;
    const picks = d0.log.length;
    c.eng.setConnected(c.ids[0]!, false, c.t);
    c.t += 10 * MIN;
    c.eng.tick(c.t);
    expect(c.eng.s.draft!.log.length).toBe(picks); // no auto-pick for a player who is not there
    c.eng.setConnected(c.ids[0]!, true, c.t);
    c.eng.tick(c.t);
    expect(c.eng.s.draft!.log.length).toBe(picks);
    expect(c.eng.s.draft!.deadline! - c.t).toBe(left);
  });

  it('the hub and the lineup screen freeze too', () => {
    const c = mk(1, { format: 'packs', competition: 'league', teams: 4 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    playDraft(c);
    expect(c.eng.s.phase).toBe('setup');
    c.eng.setConnected(c.ids[0]!, false, c.t);
    c.t += 30 * MIN;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('setup');
    c.eng.setConnected(c.ids[0]!, true, c.t);
    expect(c.eng.s.setup!.deadline - c.t).toBe(SETUP_SECONDS * 1000);
    c.eng.handle(c.ids[0]!, { t: 'ready', ready: true }, c.t);
    c.t = c.eng.s.day!.startedAt + 1000;
    c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t);
    expect(c.eng.s.phase).toBe('hub');
    c.eng.setConnected(c.ids[0]!, false, c.t);
    c.t += 30 * MIN;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('hub');
    c.eng.setConnected(c.ids[0]!, true, c.t);
    expect(c.eng.s.hub!.deadline - c.t).toBe(HUB_SECONDS * 1000);
  });

  it('with a friend still connected, a dropped player gets a grace period before the match moves on without them', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    toMatch(c);
    c.t = c.eng.s.day!.startedAt + 1000;
    c.eng.setConnected(c.ids[1]!, false, c.t);
    c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t);
    c.eng.tick(c.t + 1000);
    expect(c.eng.s.phase).toBe('match'); // still waiting for the dropped player
    expect(c.eng.nextWake(c.t)).toBeLessThanOrEqual(c.t + DROP_GRACE_MS); // and an alarm is set for the end of the grace
    c.eng.tick(c.t + DROP_GRACE_MS - 1);
    expect(c.eng.s.phase).toBe('match');
    c.eng.tick(c.t + DROP_GRACE_MS + 1);
    expect(c.eng.s.phase).toBe('hub');
  });

  it('a dropped player who returns inside the grace keeps their match', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    toMatch(c);
    c.t = c.eng.s.day!.startedAt + 1000;
    c.eng.setConnected(c.ids[1]!, false, c.t);
    c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t);
    c.t += 20_000;
    c.eng.setConnected(c.ids[1]!, true, c.t);
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('match');
    c.eng.handle(c.ids[1]!, { t: 'seen' }, c.t);
    expect(c.eng.s.phase).toBe('hub');
  });

  it('after everyone was away, a friend who is still away gets a fresh grace period', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    toMatch(c);
    c.t = c.eng.s.day!.startedAt + 1000;
    for (const id of c.ids) c.eng.setConnected(id, false, c.t);
    c.t += 30 * MIN;
    c.eng.setConnected(c.ids[0]!, true, c.t); // one comes back, the other is still away
    c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t);
    c.eng.tick(c.t + 1000);
    expect(c.eng.s.phase).toBe('match'); // the grace runs from now, not from half an hour ago
    c.eng.tick(c.t + DROP_GRACE_MS + 1);
    expect(c.eng.s.phase).toBe('hub');
  });

  it('an abandoned frozen room still gets cleaned up, and sets no pointless alarms', () => {
    const c = mk(1, { format: 'packs', competition: 'league', teams: 4 });
    toMatch(c);
    c.eng.setConnected(c.ids[0]!, false, c.t);
    expect(c.eng.nextWake(c.t)!).toBeGreaterThan(c.t + 40 * MIN); // only the expiry, not the match deadline
    expect(c.eng.isExpired(c.t + ROOM_ABANDONED_MS + 1)).toBe(true);
  });
});

describe('idle rooms', () => {
  // An empty room used to ask to be woken every 50ms (a host-migration deadline nobody could ever act on) until it expired.
  it('a room everyone has left sleeps instead of polling', () => {
    for (const phase of ['lobby', 'draft'] as const) {
      const c = mk(2, { format: 'packs' });
      if (phase === 'draft') c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
      for (const id of c.ids) c.eng.setConnected(id, false, c.t);
      c.t += 25_000; // past the host-migration window, with nobody to migrate to
      c.eng.tick(c.t);
      const wake = c.eng.nextWake(c.t);
      expect(wake, phase).not.toBeNull();
      expect(wake! - c.t, phase).toBeGreaterThan(60_000);
    }
  });

  it('never asks to be woken in the past', () => {
    const c = mk(2, { format: 'packs' });
    c.eng.setConnected(c.ids[0]!, false, c.t); // the host drops, the friend is still here
    c.t += 25_000;
    c.eng.tick(c.t); // host moves to the friend
    expect(c.eng.s.hostId).toBe(c.ids[1]);
    const wake = c.eng.nextWake(c.t);
    if (wake !== null) expect(wake).toBeGreaterThan(c.t + 1000);
  });
});

describe('take turns draft', () => {
  const draftOne = (c: Ctx, id: string, n = 11) => {
    for (let i = 0; i < n; i++) expect(pickFor(c, id).ok, `${id} pick ${i + 1}`).toBe(true);
  };

  it('one human drafts all 11 spots, then the next, then the CPU teams. Nobody drafts at the same time', () => {
    const c = mk(2, { format: 'turns', competition: 'league', teams: 4 });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    const d = c.eng.s.draft!;
    expect(d.turns).toBe(true);
    expect(d.order).toEqual([a, b]);
    expect(d.order[d.turn]).toBe(a);
    // the one who is not up cannot pick, however hard they try
    c.eng.handle(a, { t: 'pack', round: 1, index: 0 }, c.t);
    const board = c.eng.view(a, c.t).draft!.board;
    expect(c.eng.handle(b, { t: 'pick', round: 1, card: board[0]!, slot: Object.keys(c.eng.s.squads[b]!.slots)[0]! }, c.t)).toMatchObject({ ok: false, code: 'not_your_turn' });
    draftOne(c, a, 10);
    expect(c.eng.s.draft!.order[c.eng.s.draft!.turn]).toBe(a); // still a's, one spot left
    expect(c.eng.s.draft!.round).toBe(11);
    draftOne(c, a, 1);
    // a is done; it is b's turn and b starts from round 1
    expect(c.eng.s.phase).toBe('draft');
    expect(Object.values(c.eng.s.squads[a]!.slots).filter(Boolean)).toHaveLength(11);
    expect(Object.values(c.eng.s.squads[b]!.slots).filter(Boolean)).toHaveLength(0);
    expect(c.eng.s.draft!.order[c.eng.s.draft!.turn]).toBe(b);
    expect(c.eng.s.draft!.round).toBe(1);
    expect(c.eng.handle(a, { t: 'pick', round: 1, card: 'anything', slot: 'x' }, c.t)).toMatchObject({ ok: false });
    draftOne(c, b);
    // then the CPU teams, all at once, from what is left
    expect(c.eng.s.phase).toBe('setup');
    expect(Object.keys(c.eng.s.squads).sort()).toEqual([a, b, 'cpu1', 'cpu2'].sort());
    for (const cpu of ['cpu1', 'cpu2']) expect(Object.values(c.eng.s.squads[cpu]!.slots).filter(Boolean)).toHaveLength(11);
    playToResult(c);
  });

  it('the one waiting sees the pack and the picks of whoever is up, live', () => {
    const c = mk(2, { format: 'turns' });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    expect(c.eng.view(b, c.t).draft!.packs).toHaveLength(3); // b sees the three sealed packs a is choosing from
    expect(c.eng.handle(a, { t: 'pack', round: 1, index: 1 }, c.t).ok).toBe(true);
    const mine = c.eng.view(a, c.t).draft!;
    const theirs = c.eng.view(b, c.t).draft!;
    expect(mine.board).toHaveLength(3);
    expect(theirs.board).toEqual(mine.board); // b watches a's pack
    expect(theirs.opened).toBe(1); // and which one a chose
    expect(theirs.turns).toBe(true);
    pickFor(c, a);
    const seen = c.eng.view(b, c.t);
    expect(seen.draft!.log.at(-1)!.seat).toBe(a);
    expect(Object.values(seen.squads[a]!.slots).filter(Boolean)).toHaveLength(1); // and a's pitch fills up in front of them
    draftOne(c, a, 10);
    // once everyone has drafted, the usual privacy applies again: lineups stay hidden until kick-off
    draftOne(c, b);
    expect(c.eng.view(b, c.t).squads[a]).toBeUndefined();
  });

  it('the first drafter alternates between games', () => {
    const c = mk(2, { format: 'turns' });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    expect(c.eng.s.draft!.order).toEqual([a, b]);
    playToResult(c);
    for (const id of c.ids) c.eng.handle(id, { t: 'rematch', want: true }, c.t);
    expect(c.eng.s.phase).toBe('draft');
    expect(c.eng.s.draft!.order).toEqual([b, a]);
  });

  it('only the player who is up runs against the pick timer', () => {
    const c = mk(2, { format: 'turns', pickSeconds: 15 });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    c.t = c.eng.s.draft!.deadline! + 1000;
    c.eng.tick(c.t);
    const log = c.eng.s.draft!.log;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ seat: a, auto: true });
    expect(Object.values(c.eng.s.squads[b]!.slots).filter(Boolean)).toHaveLength(0);
  });

  it('a drafter who drops out is auto-picked for, so the friend is never left waiting', () => {
    const c = mk(2, { format: 'turns' });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    c.eng.setConnected(a, false, c.t);
    for (let i = 0; i < 60 && c.eng.s.draft!.order[c.eng.s.draft!.turn] === a; i++) {
      c.t += AFK_GRACE_MS + 2000;
      c.eng.tick(c.t);
    }
    expect(c.eng.s.draft!.order[c.eng.s.draft!.turn]).toBe(b);
    expect(Object.values(c.eng.s.squads[a]!.slots).filter(Boolean)).toHaveLength(11);
  });

  it('alone against CPU teams it is just a normal draft', () => {
    const c = mk(1, { format: 'turns', competition: 'league', teams: 4 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    draftOne(c, c.ids[0]!);
    expect(c.eng.s.phase).toBe('setup');
    playToResult(c);
  });
});

describe('pick-a-pack in the room', () => {
  const packsOf = (c: Ctx, id: string) => c.eng.view(id, c.t).draft!;

  it('three sealed packs first, the players only after one is opened', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4 });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    for (const id of [a, b]) {
      const d = packsOf(c, id);
      expect(d.packs).toHaveLength(3);
      expect(d.board).toEqual([]); // nothing to see yet
      expect(d.opened).toBeNull();
    }
    // picking before opening a pack is refused, with a helpful message
    expect(c.eng.handle(a, { t: 'pick', round: 1, card: 'lionel-messi', slot: Object.keys(c.eng.s.squads[a]!.slots)[0]! }, c.t)).toMatchObject({ ok: false, code: 'bad_card' });
    expect(c.eng.handle(a, { t: 'pack', round: 1, index: 2 }, c.t).ok).toBe(true);
    expect(packsOf(c, a).board).toHaveLength(3);
    expect(packsOf(c, a).opened).toBe(2);
    expect(packsOf(c, b).board).toEqual([]); // b has not chosen; in Packs nobody sees anybody's pack
    // once open, the pick works and the next round deals fresh packs
    expect(pickFor(c, a).ok).toBe(true);
    expect(pickFor(c, b).ok).toBe(true);
    expect(c.eng.s.draft!.round).toBe(2);
    expect(packsOf(c, a).opened).toBeNull();
    expect(packsOf(c, a).packs).toHaveLength(3);
  });

  it('cards in packs that stay sealed never reach any browser', () => {
    const c = mk(2, { format: 'packs' });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    c.eng.handle(a, { t: 'pack', round: 1, index: 0 }, c.t);
    const d = c.eng.s.draft!;
    for (const viewer of [a, b]) {
      const wire = JSON.stringify(c.eng.view(viewer, c.t));
      for (const id of [a, b]) {
        d.offers![id]!.forEach((offer, i) => {
          const visible = id === a && i === 0 && viewer === a; // only a's own opened pack, only to a
          for (const card of offer.cards) {
            if (!visible) expect(wire.includes(`"${card}"`), `${viewer} can see ${card} from ${id}'s pack ${i}`).toBe(false);
          }
        });
      }
    }
  });

  it('a pack can be opened once, only by the right person, and only if it exists', () => {
    const c = mk(2, { format: 'turns' });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    expect(c.eng.handle(b, { t: 'pack', round: 1, index: 0 }, c.t)).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(c.eng.handle(a, { t: 'pack', round: 1, index: 7 }, c.t)).toMatchObject({ ok: false });
    expect(c.eng.handle(a, { t: 'pack', round: 9, index: 0 }, c.t)).toMatchObject({ ok: false, code: 'stale_round' });
    expect(c.eng.handle(a, { t: 'pack', round: 1, index: 0 }, c.t).ok).toBe(true);
    expect(c.eng.handle(a, { t: 'pack', round: 1, index: 1 }, c.t).ok).toBe(false); // no switching after peeking
  });

  it('duel has no packs: one shared board as before', () => {
    const c = mk(2, { format: 'duel' });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    const d = packsOf(c, c.ids[0]!);
    expect(d.packs).toBeUndefined();
    expect(d.board.length).toBeGreaterThan(3);
    expect(c.eng.handle(c.ids[0]!, { t: 'pack', round: 1, index: 0 }, c.t)).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('out of time before choosing: a pack is opened for you and the best card placed', () => {
    const c = mk(2, { format: 'packs', pickSeconds: 15 });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    c.t = c.eng.s.draft!.deadline! + 1000;
    c.eng.tick(c.t);
    expect(c.eng.s.draft!.round).toBe(2); // both were auto-picked, packs opened by the seed
    const log = c.eng.s.draft!.log;
    expect(log.map((l) => l.seat).sort()).toEqual([a, b].sort());
    expect(log.every((l) => l.auto)).toBe(true);
  });

  it('a whole draft finishes with nobody touching the packs', () => {
    const c = mk(2, { format: 'packs', competition: 'league', teams: 4, pickSeconds: 15 });
    c.eng.handle(c.ids[0]!, { t: 'start' }, c.t);
    for (let i = 0; i < 40 && c.eng.s.phase === 'draft'; i++) { c.t += 20_000; c.eng.tick(c.t); }
    expect(c.eng.s.phase).toBe('setup');
    for (const id of c.ids) expect(Object.values(c.eng.s.squads[id]!.slots).filter(Boolean)).toHaveLength(11);
  });
});

describe('a packs draft with nothing left to choose from', () => {
  it('skips the seat at once instead of waiting for a timer, and never throws', () => {
    const c = mk(2, { format: 'packs', pickSeconds: 0 }); // no timer at all: only the guard can move this on
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    const d = c.eng.s.draft!;
    d.offers![a] = []; d.boards[a] = [];
    expect(() => c.eng.tick(c.t)).not.toThrow();
    expect(d.picked).toContain(a);      // a was skipped
    expect(d.picked).not.toContain(b);  // b still has a real choice and the round waits for them
    expect(c.eng.s.draft!.round).toBe(1);
    expect(pickFor(c, b).ok).toBe(true);
    expect(c.eng.s.draft!.round).toBe(2);
  });
  it('an out-of-time seat with no packs is skipped, not turned into a NaN index', () => {
    const c = mk(2, { format: 'packs', pickSeconds: 15 });
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'start' }, c.t);
    const d = c.eng.s.draft!;
    d.offers![a] = []; d.boards[a] = []; d.offers![b] = []; d.boards[b] = [];
    c.t = d.deadline! + 1000;
    expect(() => c.eng.tick(c.t)).not.toThrow();
    expect(c.eng.s.draft?.round ?? 99).toBeGreaterThanOrEqual(2); // everyone was skipped, the round moved on
    expect(JSON.stringify(c.eng.s)).not.toContain('NaN');
  });
});
