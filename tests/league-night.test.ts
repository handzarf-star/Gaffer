// League Night: the rules in docs/league-night.md, held by the engine with an injected clock.
import { describe, expect, it } from 'vitest';
import { tables } from '../src/shared/competition';
import { autoPick } from '../src/shared/draft';
import { FORMATIONS, effectiveOvr } from '../src/shared/formations';
import { player } from '../src/shared/players';
import { poolPlayers } from '../src/shared/pools';
import { DEFAULT_SETTINGS, type RoomView, type Settings } from '../src/shared/protocol';
import { HUB_SECONDS, ROOM_ABANDONED_MS, RoomEngine, SLOW_ABANDONED_MS, STEAL_MS, WINDOW_SECONDS, cleanClub, testDeps } from '../src/shared/room';
import { loadRoom } from '../src/shared/room-migrate';
import { squadPlayerIds } from '../src/shared/squad';

const T0 = 1_000_000;
const NAMES = ['Sam', 'Alex', 'Jo', 'Kim'];
interface Ctx { eng: RoomEngine; ids: string[]; t: number }

/** A room as the product makes it (League Night defaults), with `n` managers; `settings` are patched on top. */
function night(n: number, settings: Partial<Settings> = {}, prefix = 'ln'): Ctx {
  const eng = RoomEngine.create('ABCD', T0, testDeps(prefix));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) { const r = eng.join({ name: NAMES[i]! }, T0); if (!r.ok) throw new Error(r.msg); ids.push(r.id); }
  if (Object.keys(settings).length) { const r = eng.handle(ids[0]!, { t: 'settings', patch: settings }, T0); if (!r.ok) throw new Error(r.msg); }
  return { eng, ids, t: T0 };
}
const start = (c: Ctx) => { const r = c.eng.handle(c.ids[0]!, { t: 'start' }, c.t); if (!r.ok) throw new Error(r.msg); };
const spot = (c: Ctx) => c.eng.s.draft!.spot!;
const onClock = (c: Ctx) => spot(c).queue[spot(c).i]!;
const view = (c: Ctx, id: string): RoomView => c.eng.view(id, c.t);
const squadIds = (c: Ctx, id: string) => squadPlayerIds(c.eng.s.squads[id]!);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** the manager on the clock opens pack `pack`, waits out the steal window, and keeps the best fit */
function takeTurn(c: Ctx, pack = 0): string {
  const id = onClock(c);
  const d = c.eng.s.draft!;
  expect(c.eng.handle(id, { t: 'pack', round: d.round, index: pack }, c.t)).toMatchObject({ ok: true });
  if (spot(c).stealUntil !== null) c.t = Math.max(c.t, spot(c).stealUntil!);
  const choice = autoPick(c.eng.s.squads[id]!, c.eng.s.draft!.board)!;
  expect(c.eng.handle(id, { t: 'pick', round: c.eng.s.draft!.round, card: choice.cardId, slot: choice.slotId }, c.t)).toMatchObject({ ok: true });
  return choice.cardId;
}
function draftAll(c: Ctx) { for (let g = 0; g < 200 && c.eng.s.phase === 'draft'; g++) takeTurn(c, g % 3); }
/** line-ups in, then matchdays until `stop` says so: every manager watches their match and is ready */
function readyAll(c: Ctx) { for (const id of c.ids) c.eng.handle(id, { t: 'ready', ready: true }, c.t); c.eng.tick(c.t); }
function watchAll(c: Ctx) { for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t); c.t = Math.max(c.t, (c.eng.s.day?.startedAt ?? c.t) + 1); c.eng.tick(c.t); }
function toLeague(c: Ctx) { start(c); draftAll(c); expect(c.eng.s.phase).toBe('setup'); readyAll(c); }

describe('a new room is League Night', () => {
  it('starts as a spotlight draft from the Balkan League for a league of eight, CPU teams filling the places nobody takes', () => {
    const c = night(1);
    expect(c.eng.s.settings).toEqual(DEFAULT_SETTINGS);
    expect(c.eng.s.settings).toMatchObject({ format: 'spotlight', pools: ['bl'], competition: 'league', teams: 8, gate: 'live', steals: 1, window: true });
    start(c);
    expect(c.eng.s.seats.filter((s) => s.bot)).toHaveLength(7); // one person can play: the rest are CPU teams
    expect(c.eng.s.phase).toBe('draft');
    expect(c.eng.s.draft!.spot).toBeTruthy();
    for (const n of [2, 3, 4]) { const k = night(n); start(k); expect(k.eng.s.seats.filter((s) => s.bot)).toHaveLength(8 - n); }
  });
  it('every manager has a club and a badge; CPU teams get generated ones', () => {
    const c = night(2);
    for (const s of c.eng.s.seats) { expect(s.club).toMatch(/ FC$/); expect(s.badge?.c1).toMatch(/^#[0-9a-f]{6}$/i); }
    start(c);
    for (const s of c.eng.s.seats.filter((x) => x.bot)) { expect(s.club).toBe(s.name); expect(s.badge).toBeTruthy(); }
    expect(new Set(c.eng.s.seats.map((s) => s.club!.toLowerCase())).size).toBe(8);
  });
  it('a club can be renamed and given a badge in the lobby only, with a sane and unique name', () => {
    const c = night(2);
    const [a, b] = c.ids as [string, string];
    const badge = { shape: 'diamond', c1: '#c8102e', c2: '#ffffff', mark: 'star' } as const;
    expect(c.eng.handle(a, { t: 'club', name: '  Željo   1921 ', badge }, c.t)).toMatchObject({ ok: true });
    expect(c.eng.s.seats[0]).toMatchObject({ club: 'Željo 1921', badge });
    expect(c.eng.handle(b, { t: 'club', name: 'željo 1921' }, c.t)).toMatchObject({ ok: false });
    for (const bad of ['', 'x', '<b>x</b>', 'http://x.io', 'a'.repeat(30)]) expect(c.eng.handle(b, { t: 'club', name: bad }, c.t).ok, bad).toBe(false);
    expect(c.eng.handle(b, { t: 'club', name: 'FK Sarajevo', badge: { shape: 'blob', c1: 'red', c2: '#fff', mark: 'x' } as never }, c.t).ok).toBe(false);
    expect(cleanClub("Sunday Rovers & Co.")).toBe('Sunday Rovers & Co.');
    start(c);
    expect(c.eng.handle(a, { t: 'club', name: 'Too Late' }, c.t)).toMatchObject({ ok: false, code: 'wrong_phase' });
  });
});

describe('the spotlight draft', () => {
  it('goes one manager at a time in snake order, and only the manager on the clock can open a pack', () => {
    const c = night(3);
    start(c);
    const [a, b, k] = c.ids as [string, string, string];
    expect(spot(c).queue.slice(0, 9)).toEqual([a, b, k, k, b, a, a, b, k]);
    expect(spot(c).queue).toHaveLength(33);
    expect(c.eng.handle(b, { t: 'pack', round: 1, index: 0 }, c.t)).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(c.eng.handle(a, { t: 'pick', round: 1, card: 'x', slot: 's0' }, c.t)).toMatchObject({ ok: false, code: 'bad_card' }); // nothing is open yet
    takeTurn(c);
    expect(onClock(c)).toBe(b);
    expect(view(c, a).draft!.spot).toMatchObject({ seat: b, stage: 'choose', done: 1, total: 33 });
  });
  it('the three packs are identical to everyone: no clue and no card of a sealed pack is ever sent, not even to their owner', () => {
    const c = night(2);
    start(c);
    const sealed = spot(c).packs.flat();
    expect(sealed).toHaveLength(9);
    expect(new Set(sealed).size).toBe(9);
    for (const id of c.ids) {
      const v = view(c, id);
      expect(v.draft).toMatchObject({ board: [], spot: { stage: 'choose', packs: 3, opened: null } });
      expect(v.draft!.packs).toBeUndefined();
      const wire = JSON.stringify(v);
      for (const card of sealed) expect(wire.includes(`"${card}"`), `${card} leaked to ${id}`).toBe(false);
    }
    // opened: its three cards are on the table for everybody; the two packs left sealed still are not
    const a = onClock(c);
    c.eng.handle(a, { t: 'pack', round: 1, index: 1 }, c.t);
    for (const id of c.ids) {
      const v = view(c, id);
      expect(v.draft!.board).toEqual(spot(c).packs[1]);
      const wire = JSON.stringify(v);
      for (const card of [...spot(c).packs[0]!, ...spot(c).packs[2]!]) expect(wire.includes(`"${card}"`)).toBe(false);
    }
  });
  it('after the pick everyone is shown what was missed, and all of it goes back into the pool', () => {
    const c = night(2, { steals: 0 });
    start(c);
    const a = onClock(c);
    const packs = clone(spot(c).packs);
    const got = takeTurn(c, 2);
    const m = view(c, c.ids[1]!).draft!.spot!.missed!;
    expect(m).toMatchObject({ seat: a, round: 1, picked: got });
    expect(m.left).toEqual(packs[2]!.filter((x) => x !== got));
    expect(m.others).toEqual([packs[0], packs[1]]);
    expect(squadIds(c, a)).toEqual([got]);
    expect(c.eng.s.draft!.taken).toEqual([got]); // only the pick is gone; the eight others can come up again
  });
  it('a player can be in one squad only, league-wide: four managers, 44 different players, and no CPU team has any of them', () => {
    for (const seed of ['u1', 'u2', 'u3']) {
      const c = night(4, {}, seed);
      start(c);
      draftAll(c);
      expect(c.eng.s.phase).toBe('setup');
      const mine = c.ids.flatMap((id) => squadIds(c, id));
      for (const id of c.ids) expect(squadIds(c, id)).toHaveLength(11);
      expect(new Set(mine).size).toBe(44);
      const all = Object.values(c.eng.s.squads).flatMap((sq) => squadPlayerIds(sq));
      expect(all).toHaveLength(88);
      expect(new Set(all).size).toBe(88);
      const pool = new Set(poolPlayers('bl').map((p) => p.id));
      expect(all.every((id) => pool.has(id))).toBe(true);
    }
  });
  it('on your own there is nothing to wait for: eleven turns in a row, no steal window', () => {
    const c = night(1);
    start(c);
    for (let i = 0; i < 11; i++) {
      c.eng.handle(c.ids[0]!, { t: 'pack', round: c.eng.s.draft!.round, index: 0 }, c.t);
      expect(spot(c).stealUntil).toBeNull();
      const ch = autoPick(c.eng.s.squads[c.ids[0]!]!, c.eng.s.draft!.board)!;
      expect(c.eng.handle(c.ids[0]!, { t: 'pick', round: c.eng.s.draft!.round, card: ch.cardId, slot: ch.slotId }, c.t).ok).toBe(true);
    }
    expect(c.eng.s.phase).toBe('setup');
  });
  it('a timer that runs out opens a pack for you and then takes the best fit; a whole draft finishes with nobody touching it', () => {
    const c = night(2, { pickSeconds: 15 });
    start(c);
    const a = onClock(c);
    c.t = c.eng.s.draft!.deadline! + 1000;
    c.eng.tick(c.t);
    expect(spot(c)).toMatchObject({ stage: 'open' });
    expect(onClock(c)).toBe(a); // the rival still gets the steal window before the pick is made for them
    c.t = spot(c).stealUntil! + 1000;
    c.eng.tick(c.t);
    expect(onClock(c)).toBe(c.ids[1]);
    expect(c.eng.s.draft!.log.at(-1)).toMatchObject({ seat: a, auto: true });
    for (let i = 0; i < 80 && c.eng.s.phase === 'draft'; i++) { c.t += 30_000; c.eng.tick(c.t); }
    expect(c.eng.s.phase).toBe('setup');
    for (const id of c.ids) expect(squadIds(c, id)).toHaveLength(11);
  });
});

describe('the steal', () => {
  function opened(steals: 0 | 1 | 2 = 1) {
    const c = night(2, { steals });
    start(c);
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'pack', round: 1, index: 0 }, c.t);
    return { c, a, b, board: c.eng.s.draft!.board.slice() };
  }
  it('for 3.5 seconds after a pack opens a rival may take one card; the manager on the clock has to wait, then picks from what is left', () => {
    const { c, a, b, board } = opened();
    expect(spot(c).stealUntil).toBe(c.t + STEAL_MS);
    expect(view(c, b).draft!.spot!.canSteal).toBe(true);
    expect(view(c, a).draft!.spot!.canSteal).toBe(false);
    const ch = autoPick(c.eng.s.squads[a]!, board)!;
    expect(c.eng.handle(a, { t: 'pick', round: 1, card: ch.cardId, slot: ch.slotId }, c.t + 1000)).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(c.eng.handle(a, { t: 'steal', round: 1, card: board[0]! }, c.t)).toMatchObject({ ok: false }); // not from your own pack
    expect(c.eng.handle(b, { t: 'steal', round: 1, card: 'k-nobody' }, c.t)).toMatchObject({ ok: false, code: 'bad_card' });
    c.t += 2000;
    expect(c.eng.handle(b, { t: 'steal', round: 1, card: board[0]! }, c.t)).toMatchObject({ ok: true });
    expect(squadIds(c, b)).toEqual([board[0]]);
    expect(c.eng.s.draft!.board).toEqual(board.slice(1));
    expect(spot(c)).toMatchObject({ stolen: { by: b, card: board[0] }, steals: { [b]: 0, [a]: 1 }, owed: { [b]: 1 } });
    expect(c.eng.s.draft!.log.at(-1)).toMatchObject({ seat: b, player: board[0], from: a });
    // one steal per pack: the window is over, and the victim picks at once from the two left
    expect(view(c, b).draft!.spot!.canSteal).toBe(false);
    expect(c.eng.handle(a, { t: 'pick', round: 1, card: board[0]!, slot: 's0' }, c.t)).toMatchObject({ ok: false, code: 'bad_card' });
    const ch2 = autoPick(c.eng.s.squads[a]!, c.eng.s.draft!.board)!;
    expect(c.eng.handle(a, { t: 'pick', round: 1, card: ch2.cardId, slot: ch2.slotId }, c.t)).toMatchObject({ ok: true });
    // the steal replaced the thief's next turn. In a snake of two the thief had two turns in a row coming (a, b, b, a): one is gone.
    expect(spot(c).i).toBe(2);
    expect(onClock(c)).toBe(b);
    expect(spot(c).owed[b]).toBe(0);
    takeTurn(c);
    expect(onClock(c)).toBe(a);
  });
  it('costs a turn, not a player: both managers still finish with exactly eleven, all different', () => {
    const { c, a, b, board } = opened();
    c.eng.handle(b, { t: 'steal', round: 1, card: board[1]! }, c.t);
    const ch = autoPick(c.eng.s.squads[a]!, c.eng.s.draft!.board)!;
    c.eng.handle(a, { t: 'pick', round: 1, card: ch.cardId, slot: ch.slotId }, c.t);
    draftAll(c);
    expect(c.eng.s.phase).toBe('setup');
    expect(squadIds(c, a)).toHaveLength(11);
    expect(squadIds(c, b)).toHaveLength(11);
    expect(new Set([...squadIds(c, a), ...squadIds(c, b)]).size).toBe(22);
  });
  it('is refused once the window has closed, with no steal left, or when switched off', () => {
    const late = opened();
    expect(late.c.eng.handle(late.b, { t: 'steal', round: 1, card: late.board[0]! }, late.c.t + STEAL_MS + 2000)).toMatchObject({ ok: false, code: 'not_your_turn' });
    const off = opened(0);
    expect(spot(off.c).stealUntil).toBeNull();
    expect(off.c.eng.handle(off.b, { t: 'steal', round: 1, card: off.board[0]! }, off.c.t)).toMatchObject({ ok: false });
    // with one steal used there is no window for that manager any more
    const once = opened();
    once.c.eng.handle(once.b, { t: 'steal', round: 1, card: once.board[0]! }, once.c.t);
    const ch = autoPick(once.c.eng.s.squads[once.a]!, once.c.eng.s.draft!.board)!;
    once.c.eng.handle(once.a, { t: 'pick', round: 1, card: ch.cardId, slot: ch.slotId }, once.c.t);
    once.c.eng.handle(once.a, { t: 'pack', round: once.c.eng.s.draft!.round, index: 0 }, once.c.t);
    expect(spot(once.c).stealUntil).toBeNull();
  });
  it('the steal window is not taken out of the picker\'s own time', () => {
    const c = night(2, { pickSeconds: 15 });
    start(c);
    const before = c.eng.s.draft!.deadline!;
    c.eng.handle(onClock(c), { t: 'pack', round: 1, index: 0 }, c.t + 4000);
    expect(c.eng.s.draft!.deadline).toBe(before + STEAL_MS);
  });
});

describe('the league: CPU teams, keepers, and results nobody sees before you do', () => {
  it('a league drafted from the Balkan League judges its keepers against each other; a star league keeps the fixed level', () => {
    const c = night(2, { teams: 4, window: false });
    toLeague(c);
    const keepers = Object.values(c.eng.s.squads).map((sq) => effectiveOvr(sq.slots[FORMATIONS[sq.formation].slots.find((x) => x.role === 'GK')!.id]!, 'GK'));
    const mean = keepers.reduce((x, y) => x + y, 0) / keepers.length;
    expect(c.eng.s.comp!.gkPivot).toBeCloseTo(mean, 0);
    expect(c.eng.s.comp!.gkPivot!).toBeLessThan(75);
    const stars = night(2, { teams: 4, pools: ['all'] });
    toLeague(stars);
    expect(stars.eng.s.comp!.gkPivot).toBeUndefined();
  });
  it('the scoreboard and the commentary use the club names', () => {
    const c = night(1, { teams: 4, window: false });
    c.eng.handle(c.ids[0]!, { t: 'club', name: 'Sunday Rovers' }, c.t);
    toLeague(c);
    const f = c.eng.s.comp!.days[0]!.fixtures.find((x) => x.humans.length)!;
    expect(JSON.stringify(f.result!.events.slice(0, 3))).toContain('Sunday Rovers');
  });
  it('while a matchday is being watched: you get your own match to watch and no score; a rival gets nothing of it; CPU games are open', () => {
    const c = night(2, { teams: 4, window: false });
    toLeague(c);
    expect(c.eng.s.phase).toBe('match');
    const [a, b] = c.ids as [string, string];
    const day = (id: string) => view(c, id).comp!.days[0]!.fixtures;
    const truth = c.eng.s.comp!.days[0]!.fixtures;
    for (const f of truth) {
      const mine = day(a).find((x) => x.id === f.id)!;
      if (f.humans.includes(a)) expect(mine).toMatchObject({ lite: null, sealed: true, result: { score: f.result!.score } });
      else if (f.humans.length) expect(mine).toMatchObject({ lite: null, result: null, sealed: true });
      else expect(mine.lite).toEqual(f.lite);
    }
    // the table a viewer builds holds only what they may know
    const sealedGames = truth.filter((f) => f.humans.length).length;
    expect(tables(view(c, a).comp!)[0]!.rows.reduce((n, r) => n + r.played, 0)).toBe((truth.length - sealedGames) * 2);
    // A has watched; B has not. A's match against a CPU team is now open to everyone; B's stays sealed for A.
    c.eng.handle(a, { t: 'seen' }, c.t);
    const aFix = truth.find((f) => f.humans.includes(a))!;
    if (!aFix.humans.includes(b)) {
      expect(day(b).find((x) => x.id === aFix.id)!.lite).toEqual(aFix.lite);
      const bFix = truth.find((f) => f.humans.includes(b))!;
      expect(day(a).find((x) => x.id === bFix.id)).toMatchObject({ lite: null, result: null, sealed: true });
    }
    expect(c.eng.s.phase).toBe('match'); // the day still waits for B
  });
  it('two managers who play each other: the one who has watched knows the score, the other still only has the match', () => {
    let c: Ctx | null = null;
    for (let i = 0; i < 12 && !c; i++) {
      const k = night(2, { teams: 4, window: false }, `h2h${i}`);
      toLeague(k);
      if (k.eng.s.comp!.days[0]!.fixtures.some((f) => f.humans.length === 2)) c = k;
    }
    expect(c, 'no seed put the two managers together on matchday 1').toBeTruthy();
    const [a, b] = c!.ids as [string, string];
    const f = c!.eng.s.comp!.days[0]!.fixtures.find((x) => x.humans.length === 2)!;
    c!.eng.handle(a, { t: 'seen' }, c!.t);
    expect(view(c!, a).comp!.days[0]!.fixtures.find((x) => x.id === f.id)!.lite).toEqual(f.lite);
    expect(view(c!, b).comp!.days[0]!.fixtures.find((x) => x.id === f.id)).toMatchObject({ lite: null, sealed: true });
    expect(view(c!, b).comp!.days[0]!.fixtures.find((x) => x.id === f.id)!.result).toBeTruthy();
  });
  it('a manager who was away keeps a sealed match and is offered it to watch; the embargo ends when the next matchday is played', () => {
    const c = night(2, { teams: 4, window: false });
    toLeague(c);
    const [a, b] = c.ids as [string, string];
    c.eng.handle(a, { t: 'seen' }, c.t);
    c.t = c.eng.s.day!.deadline + 1; // B never watched: the day closes without them
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('hub');
    const bFix = c.eng.s.comp!.days[0]!.fixtures.find((f) => f.humans.includes(b))!;
    expect(view(c, b).replay).toEqual({ day: 0, fixture: bFix.id });
    expect(view(c, a).replay).toBeNull();
    if (!bFix.humans.includes(a)) expect(view(c, a).comp!.days[0]!.fixtures.find((x) => x.id === bFix.id)).toMatchObject({ lite: null, result: null, sealed: true });
    // B watches it now: open to all
    c.eng.handle(b, { t: 'seen' }, c.t);
    expect(view(c, a).comp!.days[0]!.fixtures.find((x) => x.id === bFix.id)!.lite).toEqual(bFix.lite);
    expect(view(c, b).replay).toBeNull();
  });
  it('"ready" for the next matchday waives an unwatched match, and the next matchday lifts whatever is still sealed', () => {
    const c = night(2, { teams: 4, window: false });
    toLeague(c);
    c.t = c.eng.s.day!.deadline + 1;
    c.eng.tick(c.t); // nobody watched
    expect(view(c, c.ids[0]!).replay).toBeTruthy();
    c.eng.handle(c.ids[0]!, { t: 'ready', ready: true }, c.t);
    expect(view(c, c.ids[0]!).replay).toBeNull();
    c.t = c.eng.s.hub!.deadline + 1;
    c.eng.tick(c.t); // matchday 2 starts at the deadline
    expect(c.eng.s.comp!.day).toBe(1);
    for (const f of c.eng.s.comp!.days[0]!.fixtures) { expect(f.unseen ?? []).toEqual([]); expect(f.result).toBeNull(); }
    for (const id of c.ids) expect(view(c, id).comp!.days[0]!.fixtures.every((f) => f.lite && !f.sealed)).toBe(true);
  });
});

describe('pace: one evening, or carry on with time limits', () => {
  it('only the host changes it, at any time; everything else is still locked once the draft starts', () => {
    const c = night(2, { teams: 4, window: false });
    toLeague(c);
    const [a, b] = c.ids as [string, string];
    expect(c.eng.handle(b, { t: 'settings', patch: { gate: 'limit' } }, c.t)).toMatchObject({ ok: false, code: 'not_host' });
    expect(c.eng.handle(a, { t: 'settings', patch: { gate: 'limit', teams: 6 } }, c.t)).toMatchObject({ ok: false, code: 'wrong_phase' });
    expect(c.eng.handle(a, { t: 'settings', patch: { gate: 'limit', limitHours: 12 } }, c.t)).toMatchObject({ ok: true });
    expect(c.eng.s.settings).toMatchObject({ gate: 'limit', limitHours: 12 });
    expect(c.eng.handle(a, { t: 'settings', patch: { limitHours: 7 as never } }, c.t)).toMatchObject({ ok: false });
  });
  it('an evening that did not finish: switch in the table screen and the next matchday waits 24 hours instead of two minutes', () => {
    const c = night(2, { teams: 4, window: false });
    toLeague(c);
    watchAll(c);
    expect(c.eng.s.phase).toBe('hub');
    expect(c.eng.s.hub!.deadline).toBe(c.t + HUB_SECONDS * 1000);
    c.eng.handle(c.ids[0]!, { t: 'settings', patch: { gate: 'limit' } }, c.t);
    expect(c.eng.s.hub!.deadline).toBe(c.t + 24 * 3_600_000);
    // everybody leaves: nothing freezes, the room is kept for days, and the matchday is played at the limit without them
    for (const id of c.ids) c.eng.setConnected(id, false, c.t);
    expect(c.eng.s.pausedAt ?? null).toBeNull();
    expect(c.eng.expiresAt(c.t) - c.t).toBe(SLOW_ABANDONED_MS);
    expect(SLOW_ABANDONED_MS).toBeGreaterThan(ROOM_ABANDONED_MS * 100);
    c.t += 3 * 3_600_000;
    c.eng.tick(c.t);
    expect(c.eng.s.comp!.day).toBe(0 + 1); // still waiting: day index 1 is next, not yet played
    expect(c.eng.s.comp!.days[1]!.fixtures.every((f) => !f.lite)).toBe(true);
    c.t = c.eng.s.hub!.deadline + 1;
    c.eng.tick(c.t);
    expect(c.eng.s.comp!.days[1]!.fixtures.every((f) => f.lite)).toBe(true);
    // no "match" phase on a time limit: the day is played and each manager finds their match waiting
    expect(c.eng.s.phase).toBe('hub');
    for (const id of c.ids) expect(view(c, id).replay).toMatchObject({ day: 1 });
    expect(view(c, c.ids[0]!).comp!.days[1]!.fixtures.find((f) => f.humans.includes(c.ids[0]!))).toMatchObject({ lite: null, sealed: true });
  });
  it('a whole league on a time limit: played when everyone is ready, the result waits for the last match to be watched, the champion stays hidden until then', () => {
    const c = night(2, { teams: 4, window: false, gate: 'limit' });
    start(c);
    draftAll(c);
    expect(c.eng.s.setup!.deadline).toBe(c.t + 24 * 3_600_000);
    readyAll(c);
    for (let day = 0; day < 3; day++) {
      expect(c.eng.s.phase).toBe('hub');
      expect(c.eng.s.comp!.days[day]!.fixtures.every((f) => f.lite)).toBe(true);
      if (day < 2) { for (const id of c.ids) c.eng.handle(id, { t: 'seen' }, c.t); readyAll(c); }
    }
    // the season is over but nobody has watched the last matchday
    expect(c.eng.s.comp!.champion).toBeTruthy();
    expect(c.eng.s.hub).toMatchObject({ final: true });
    for (const id of c.ids) expect(view(c, id).comp!.champion).toBeNull();
    c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t);
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('hub'); // one manager still to watch
    c.eng.handle(c.ids[1]!, { t: 'seen' }, c.t);
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('result');
    expect(view(c, c.ids[0]!).comp!.champion).toBe(c.eng.s.comp!.champion);
  });
  it('and if the last manager never comes back, the result is shown when the limit runs out', () => {
    const c = night(1, { teams: 4, window: false, gate: 'limit' });
    start(c);
    draftAll(c);
    readyAll(c);
    for (let day = 0; day < 2; day++) { c.eng.handle(c.ids[0]!, { t: 'seen' }, c.t); readyAll(c); }
    expect(c.eng.s.hub).toMatchObject({ final: true });
    c.t = c.eng.s.hub!.deadline + 1;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('result');
  });
});

describe('the mid-season transfer window', () => {
  /** a live league of `teams` with the window on, played up to the moment the window opens */
  function toWindow(n: number, teams: number, extra: Partial<Settings> = {}): Ctx {
    const c = night(n, { teams, ...extra }, `w${n}${teams}`);
    toLeague(c);
    for (let g = 0; g < 20 && c.eng.s.phase !== 'window'; g++) {
      if (c.eng.s.phase === 'match') watchAll(c);
      else if (c.eng.s.phase === 'hub') readyAll(c);
      else throw new Error(`unexpected phase ${c.eng.s.phase}`);
    }
    return c;
  }
  it('opens once, at half-season, with the managers in reverse table order', () => {
    const c = toWindow(2, 8);
    expect(c.eng.s.comp!.day).toBe(3); // 7 matchdays: after the third
    const w = c.eng.s.window!;
    const table = tables(c.eng.s.comp!)[0]!.rows.map((r) => r.id).filter((id) => c.ids.includes(id));
    expect(w.order).toEqual(table.slice().reverse());
    expect(w).toMatchObject({ turn: 0, deadline: c.t + WINDOW_SECONDS * 1000 });
    expect(view(c, w.order[0]!).window).toMatchObject({ yourMove: true });
    expect(view(c, w.order[1]!).window).toMatchObject({ yourMove: false });
    expect(c.eng.handle(w.order[1]!, { t: 'pack', round: 0, index: 0 }, c.t)).toMatchObject({ ok: false, code: 'not_your_turn' });
  });
  it('one pack of three: sign one in place of one of yours (who goes back into the pool), or keep your squad', () => {
    const c = toWindow(2, 8);
    const w = c.eng.s.window!;
    const [first, second] = w.order as [string, string];
    const everyone = new Set(Object.values(c.eng.s.squads).flatMap((sq) => squadPlayerIds(sq)));
    expect(c.eng.handle(first, { t: 'pack', round: 0, index: 2 }, c.t)).toMatchObject({ ok: true });
    const mine = c.eng.s.window!.seats[first]!;
    expect(mine).toMatchObject({ stage: 'open' });
    expect(mine.board).toHaveLength(3);
    expect(mine.others).toHaveLength(2);
    for (const id of [...mine.board, ...mine.others.flat()]) expect(everyone.has(id), `${id} is already in a squad`).toBe(false);
    expect(view(c, second).window!.seats[first]!.board).toEqual(mine.board); // played live, everyone watches
    const before = clone(c.eng.s.squads[first]!);
    const slot = Object.keys(before.slots).find((s) => before.slots[s] && player(before.slots[s]!).pos !== 'GK')!;
    expect(c.eng.handle(first, { t: 'sign', card: 'k-nobody', slot }, c.t)).toMatchObject({ ok: false, code: 'bad_card' });
    expect(c.eng.handle(first, { t: 'sign', card: mine.board[0]! }, c.t)).toMatchObject({ ok: false, code: 'bad_slot' });
    expect(c.eng.handle(first, { t: 'sign', card: mine.board[0]!, slot }, c.t)).toMatchObject({ ok: true });
    expect(c.eng.s.squads[first]!.slots[slot]).toBe(mine.board[0]);
    expect(squadIds(c, first)).not.toContain(before.slots[slot]);
    expect(squadIds(c, first)).toHaveLength(11);
    expect(c.eng.s.window!.signings).toEqual([{ team: first, in: mine.board[0], out: before.slots[slot] }]);
    // the second manager keeps their squad; then the CPU teams take their turn and the season goes on
    expect(c.eng.s.window!.turn).toBe(1);
    expect(c.eng.handle(second, { t: 'sign', card: null }, c.t)).toMatchObject({ ok: true });
    expect(c.eng.s.phase).toBe('hub');
    expect(c.eng.s.window).toBeNull();
    expect(c.eng.s.windowDone).toBe(true);
    expect(view(c, second).lastWindow[0]).toEqual({ team: first, in: mine.board[0], out: before.slots[slot] });
    // still one squad per player, league-wide
    const all = Object.values(c.eng.s.squads).flatMap((sq) => squadPlayerIds(sq));
    expect(new Set(all).size).toBe(all.length);
    // CPU teams sign only an improvement
    for (const sg of c.eng.s.lastWindow.filter((x) => x.team.startsWith('cpu'))) expect(player(sg.in).ovr).toBeGreaterThan(player(sg.out).ovr - 8);
    // and it does not open again
    for (let g = 0; g < 30 && c.eng.s.phase !== 'result'; g++) { if (c.eng.s.phase === 'match') watchAll(c); else readyAll(c); expect(c.eng.s.phase).not.toBe('window'); }
    expect(c.eng.s.phase).toBe('result');
  });
  it('a manager who does nothing keeps their squad when their time is up', () => {
    const c = toWindow(2, 4);
    expect(c.eng.s.comp!.day).toBe(1); // 3 matchdays: after the first
    const squads = clone(c.eng.s.squads);
    c.t += WINDOW_SECONDS * 1000 + 1;
    c.eng.tick(c.t);
    expect(c.eng.s.window!.turn).toBe(1);
    c.t += WINDOW_SECONDS * 1000 + 1;
    c.eng.tick(c.t);
    expect(c.eng.s.phase).toBe('hub');
    for (const id of c.ids) expect(c.eng.s.squads[id]).toEqual(squads[id]);
  });
  it('on a time limit everyone opens their pack in their own time, and a pack is its owner\'s business until they are done', () => {
    const c = toWindow(2, 4);
    c.eng.handle(c.ids[0]!, { t: 'settings', patch: { gate: 'limit' } }, c.t);
    const w = c.eng.s.window!;
    expect(w).toMatchObject({ turn: -1, deadline: c.t + 24 * 3_600_000 });
    const [first, second] = w.order as [string, string];
    expect(c.eng.handle(second, { t: 'pack', round: 0, index: 0 }, c.t)).toMatchObject({ ok: true }); // out of order is fine now
    expect(view(c, first).window!.seats[second]).toMatchObject({ stage: 'open', board: [] });
    expect(view(c, second).window!.seats[second]!.board).toHaveLength(3);
    // what is open on one table cannot be dealt to another
    expect(c.eng.handle(first, { t: 'pack', round: 0, index: 0 }, c.t)).toMatchObject({ ok: true });
    const boards = [c.eng.s.window!.seats[first]!, c.eng.s.window!.seats[second]!].flatMap((x) => [...x.board, ...x.others.flat()]);
    expect(new Set(c.eng.s.window!.seats[first]!.board.concat(c.eng.s.window!.seats[second]!.board)).size).toBe(6);
    expect(boards.length).toBeGreaterThan(6);
    c.eng.handle(first, { t: 'sign', card: null }, c.t);
    expect(c.eng.s.phase).toBe('window');
    c.eng.handle(second, { t: 'sign', card: null }, c.t);
    expect(c.eng.s.phase).toBe('hub');
  });
  it('a league with the window switched off never has one', () => {
    const c = night(1, { teams: 4, window: false });
    toLeague(c);
    for (let g = 0; g < 20 && c.eng.s.phase !== 'result'; g++) { if (c.eng.s.phase === 'match') watchAll(c); else readyAll(c); expect(c.eng.s.phase).not.toBe('window'); }
    expect(c.eng.s.phase).toBe('result');
  });
});

describe('identity and saved state', () => {
  it('an account gets its seat back without the stored seat secret; another account cannot take it; accounts are never sent', () => {
    const eng = RoomEngine.create('ABCD', T0, testDeps('acc'));
    const a = eng.join({ name: 'Sam', account: 'g_accountA' }, T0);
    const b = eng.join({ name: 'Alex', account: 'u_accountB' }, T0);
    if (!a.ok || !b.ok) throw new Error('join');
    eng.setConnected(a.id, false, T0 + 1);
    const again = eng.join({ name: 'Sam on a new phone', account: 'g_accountA' }, T0 + 2);
    expect(again).toMatchObject({ ok: true, id: a.id, secret: a.secret });
    expect(eng.s.seats).toHaveLength(2);
    expect(eng.join({ id: a.id, secret: 'guess', name: 'x', account: 'u_accountB' }, T0 + 3)).toMatchObject({ ok: true, id: b.id }); // B's account is B, whatever seat id it sends
    expect(eng.join({ id: a.id, secret: 'guess', name: 'x', account: 'u_stranger' }, T0 + 3)).toMatchObject({ ok: false, code: 'bad_secret' });
    const wire = JSON.stringify(eng.view(b.id, T0 + 4));
    expect(wire).not.toContain('accountA');
    expect(wire).not.toContain('accountB');
    // a visitor with no account still joins and rejoins by seat secret, as before
    const c = eng.join({ name: 'Jo' }, T0 + 5);
    if (!c.ok) throw new Error('join');
    expect(eng.join({ id: c.id, secret: c.secret, name: 'Jo' }, T0 + 6)).toMatchObject({ ok: true, id: c.id });
  });
  it('a room saved at any moment of a League Night loads back exactly as it was', () => {
    const c = night(2, { teams: 4 });
    const check = (label: string) => {
      const r = loadRoom(clone(c.eng.s));
      expect(r, label).toMatchObject({ ok: true, from: 3, changed: false });
      if (r.ok) expect(r.state, label).toEqual(clone(c.eng.s));
    };
    check('lobby');
    start(c);
    takeTurn(c); c.eng.handle(onClock(c), { t: 'pack', round: c.eng.s.draft!.round, index: 0 }, c.t);
    check('mid-draft, a pack open and a steal window running');
    c.t = spot(c).stealUntil ?? c.t;
    const ch = autoPick(c.eng.s.squads[onClock(c)]!, c.eng.s.draft!.board)!;
    c.eng.handle(onClock(c), { t: 'pick', round: c.eng.s.draft!.round, card: ch.cardId, slot: ch.slotId }, c.t);
    draftAll(c);
    check('line-ups');
    readyAll(c);
    check('matchday being watched');
    watchAll(c);
    expect(c.eng.s.phase).toBe('window');
    c.eng.handle(c.eng.s.window!.order[0]!, { t: 'pack', round: 0, index: 0 }, c.t);
    check('transfer window, a pack open');
  });
});
