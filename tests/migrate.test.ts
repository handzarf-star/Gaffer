import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadState, numMap, unplayable, type Pipeline } from '../src/shared/migrate';
import { careerPipeline, loadCareer } from '../src/shared/career/migrate';
import { roomPipeline, loadRoom } from '../src/shared/room-migrate';
import { restoreCareer, restoreRoom } from '../src/server/restore';
import { runDay, tick, viewFor, type CareerState } from '../src/shared/career/engine';
import { RoomEngine, testDeps } from '../src/shared/room';
import { DEFAULT_SETTINGS, type RoomState } from '../src/shared/protocol';
import { makeWorld } from './career-world';

// The fixtures are saved states exactly as the engines wrote them before this pipeline existed. They are FROZEN: never regenerate
// them to make a test pass; a change that breaks one of them would break every league and room saved before it.
const fx = (name: string): Record<string, any> => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const W = makeWorld();

/** every `undefined`, `NaN` and `Infinity` anywhere in a value, as a path. `props: false` ignores `undefined` object properties
 *  (the match simulator leaves a few on events; JSON drops them on save) but still reports NaN, Infinity and undefined array items. */
function bad(x: unknown, at = '$', out: string[] = [], props = true): string[] {
  if (x === undefined) out.push(`${at} is undefined`);
  else if (typeof x === 'number' && !Number.isFinite(x)) out.push(`${at} is ${x}`);
  else if (Array.isArray(x)) x.forEach((v, i) => bad(v, `${at}[${i}]`, out, props));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (v !== undefined || props) bad(v, `${at}.${k}`, out, props); }
  return out;
}

const CAREERS = ['career-lobby.v1', 'career-play.v1', 'career-window.v1'];
const ROOMS = ['room-lobby.v2', 'room-draft.v2', 'room-league.v2'];

describe('the pipeline itself', () => {
  type S = { v: number; a: number; b?: number; c: string[] };
  const p: Pipeline<S> = {
    current: 3, oldest: 1,
    steps: { 1: (o) => ({ ...o, b: 10 }), 2: (o) => ({ ...o, c: [] }) },
    normalise: (o) => ({ v: 3, a: typeof o.a === 'number' ? o.a : 0, b: typeof o.b === 'number' ? o.b : 0, c: Array.isArray(o.c) ? (o.c as string[]) : [] }),
  };
  it('runs every step in order from the saved version and stamps the version as it goes', () => {
    const r = loadState(p, { v: 1, a: 5 });
    expect(r).toEqual({ ok: true, from: 1, changed: true, state: { v: 3, a: 5, b: 10, c: [] } });
  });
  it('starts in the middle when the save is already part-way', () => {
    expect(loadState(p, { v: 2, a: 5 })).toMatchObject({ ok: true, from: 2, state: { v: 3, a: 5, b: 0, c: [] } });
  });
  it('never mutates what it was given', () => {
    const raw = { v: 1, a: 5, nested: { x: 1 } };
    const before = JSON.stringify(raw);
    loadState(p, raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it('still repairs a save that is already current, and says whether anything changed', () => {
    expect(loadState(p, { v: 3, a: 1, b: 2, c: ['x'] })).toMatchObject({ ok: true, changed: false });
    expect(loadState(p, { v: 3, a: 'oops' })).toMatchObject({ ok: true, changed: true, state: { v: 3, a: 0, b: 0, c: [] } });
  });
  it('does not call key order a change', () => {
    expect(loadState(p, { c: [], b: 2, a: 1, v: 3 })).toMatchObject({ ok: true, changed: false });
  });
  it('refuses, without touching anything, what it must not read', () => {
    expect(loadState(p, { v: 4, a: 1 })).toEqual({ ok: false, reason: 'too_new', from: 4 });
    expect(loadState(p, { v: 0 })).toEqual({ ok: false, reason: 'too_old', from: 0 });
    for (const junk of [null, undefined, 7, 'x', [], {}, { v: 'two' }, { v: 1.5 }]) expect(loadState(p, junk)).toMatchObject({ ok: false, reason: 'not_state' });
  });
  it('turns a throwing step, a missing step or an unplayable save into "broken", never an exception', () => {
    const boom: Pipeline<S> = { ...p, steps: { 1: () => { throw new Error('bad step'); }, 2: p.steps[2]! } };
    expect(loadState(boom, { v: 1 })).toMatchObject({ ok: false, reason: 'broken', detail: 'bad step' });
    expect(loadState({ ...p, steps: { 1: p.steps[1]! } }, { v: 1 })).toMatchObject({ ok: false, reason: 'broken', detail: 'no migration from v2' });
    expect(loadState({ ...p, normalise: () => unplayable('the pitch') }, { v: 3 })).toMatchObject({ ok: false, reason: 'broken', detail: 'the pitch' });
  });
});

describe('saved leagues from before the pipeline', () => {
  for (const name of CAREERS) {
    it(`${name}: loads unchanged, with nothing undefined or NaN, and the engine runs on it`, () => {
      const raw = fx(name);
      const r = loadCareer(raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.from).toBe(1);
      expect(r.changed).toBe(false); // a valid save is a fixed point: loading must not alter it
      expect(r.state).toEqual(raw);
      expect(bad(r.state)).toEqual([]);
      // and it still plays: views for every manager and a stranger, then a day of football
      for (const m of [...r.state.members.map((x) => x.id), null]) expect(() => viewFor(W, r.state, m)).not.toThrow();
      const st: CareerState = clone(r.state);
      expect(() => { tick(W, st, st.createdAt + 400 * 86_400_000); }).not.toThrow();
      if (st.phase === 'play') expect(() => runDay(W, clone(r.state), st.createdAt + 400 * 86_400_000)).not.toThrow();
      expect(bad(st, '$', [], false)).toEqual([]); // after a day of football: no NaN or Infinity anywhere
    });
  }
  it('rewriting a save in the current shape and loading it again changes nothing', () => {
    for (const name of CAREERS) {
      const once = loadCareer(fx(name));
      if (!once.ok) throw new Error(name);
      const twice = loadCareer(clone(once.state));
      expect(twice).toMatchObject({ ok: true, changed: false });
    }
  });
});

describe('fields a later sprint adds never reach the engine as undefined or NaN on an old save', () => {
  // This is exactly how Sprint 3B will add them: bump the version, add one step, give normalise a default for the field.
  const future: Pipeline<CareerState & { v: number; energy: Record<string, number>; estimatedAge: Record<string, boolean> }> = {
    current: 2, oldest: 1,
    steps: { 1: (o) => ({ ...o, energy: {}, estimatedAge: {} }) },
    normalise: (o) => ({ ...(careerPipeline.normalise(o) as any), v: 2, energy: numMap(o.energy), estimatedAge: Object.fromEntries(Object.entries((o.estimatedAge as object) ?? {}).filter(([, v]) => typeof v === 'boolean')) }),
  };
  for (const name of CAREERS) {
    it(`${name}: v1 -> v2 keeps every existing field and the new ones start empty and defined`, () => {
      const raw = fx(name);
      const r = loadState(future, raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.from).toBe(1);
      expect(r.changed).toBe(true);
      expect(r.state.v).toBe(2);
      expect(r.state.energy).toEqual({});
      expect(r.state.estimatedAge).toEqual({});
      expect(bad(r.state)).toEqual([]);
      const { v: _v, energy: _e, estimatedAge: _a, ...rest } = r.state as any;
      const { v: _ov, ...old } = raw;
      expect(rest).toEqual(old);
    });
  }
  it('a v2 save written without the new fields (a build in between, or a hand repair) still loads with defaults', () => {
    const half = { ...fx('career-play.v1'), v: 2 };
    const r = loadState(future, half);
    expect(r).toMatchObject({ ok: true, changed: true, state: { v: 2, energy: {}, estimatedAge: {} } });
  });
  it('garbage in the new fields is dropped instead of becoming NaN in a calculation', () => {
    const r = loadState(future, { ...fx('career-play.v1'), v: 2, energy: { a: 90, b: null, c: 'tired', d: Number.NaN, e: 40 }, estimatedAge: { x: true, y: 'yes' } });
    if (!r.ok) throw new Error('should load');
    expect(r.state.energy).toEqual({ a: 90, e: 40 });
    expect(r.state.estimatedAge).toEqual({ x: true });
    expect(bad(r.state)).toEqual([]);
  });
});

describe('a damaged league is repaired where it can be and refused where it cannot, never crashed on', () => {
  it('fills in missing and mistyped parts', () => {
    const raw = fx('career-play.v1');
    delete raw.ratings; delete raw.stats; delete raw.news; delete raw.history; delete raw.injuries; delete raw.susp;
    raw.settings = { dayHours: 'soon', pickHours: null, bot: 'impossible' };
    raw.day = Number.NaN; raw.rev = null; raw.deadline = 'tomorrow'; raw.ages = { a: 30, b: 'old', c: null };
    const first = Object.values(raw.clubs)[0] as any;
    delete first.newcomers; delete first.sharp; first.formation = '9-9-9'; first.style = 'tiki-taka'; first.badge = { shape: 'blob' };
    const r = loadCareer(raw);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const s = r.state;
    expect(r.changed).toBe(true);
    expect(bad(s)).toEqual([]);
    expect(s.settings).toEqual({ pickHours: 12, dayHours: 24, windowHours: 48, bot: 'normal' });
    expect([s.day, s.rev, s.deadline]).toEqual([0, 0, null]);
    expect(s.ratings).toEqual({});
    expect(s.news).toEqual([]);
    expect(s.ages).toEqual({ a: 30 });
    const c = s.clubs[first.id]!;
    expect(c).toMatchObject({ formation: '433', style: 'possession', newcomers: {}, sharp: { left: 0, hit: 0 } });
    expect(c.badge.shape).toMatch(/shield|round|pennant|diamond/);
    expect(() => viewFor(W, s, s.members[0]!.id)).not.toThrow();
  });
  it('drops only the unreadable entry, not the league', () => {
    const raw = fx('career-play.v1');
    raw.news.push({ kind: 'invented', season: 1, day: 1 }, 'text', null);
    raw.history.push({ nonsense: true });
    raw.members.push({ id: 'ghost' }, { id: 'm9', clubId: 'no-such-club' });
    raw.lastDay = { season: 1, day: 2, matches: [{ junk: 1 }] };
    const r = loadCareer(raw);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.state.news.length).toBe(fx('career-play.v1').news.length);
    expect(r.state.history.length).toBe(fx('career-play.v1').history.length);
    expect(r.state.members.length).toBe(2);
    expect(r.state.lastDay?.matches).toEqual([]);
  });
  it('refuses a league that cannot be played rather than guessing', () => {
    const noClubs = fx('career-play.v1'); noClubs.clubs = {};
    const noDraft = fx('career-lobby.v1'); noDraft.phase = 'draft';
    const noWindow = fx('career-play.v1'); noWindow.phase = 'window'; noWindow.window = null;
    const noPhase = fx('career-play.v1'); noPhase.phase = 'halftime';
    const noLeagues = fx('career-play.v1'); delete noLeagues.leagues;
    for (const r of [noClubs, noDraft, noWindow, noPhase, noLeagues]) expect(loadCareer(r)).toMatchObject({ ok: false, reason: 'broken' });
  });
});

describe('saved rooms', () => {
  // The fixtures are version 2 (before League Night). The build writes version 3, so every one of them goes through steps[2].
  for (const name of ROOMS) {
    it(`${name}: migrates v2 -> v3 with nothing lost, nothing undefined, and the engine runs on it`, () => {
      const raw = fx(name);
      const r = loadRoom(raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.from).toBe(2);
      expect(r.changed).toBe(true);
      expect(r.state.v).toBe(3);
      expect(bad(r.state)).toEqual([]);
      // one pool became a list of pools; what League Night added starts at its neutral value
      const { pool, ...oldSettings } = raw.settings;
      expect(r.state.settings).toMatchObject({ ...oldSettings, pools: [pool], nations: [], gate: 'live', window: false });
      expect((r.state.settings as unknown as Record<string, unknown>)['pool']).toBeUndefined();
      expect(r.state).toMatchObject({ window: null, windowDone: false, lastWindow: [], accounts: {} });
      // everything that was there is still there, untouched
      for (const k of ['code', 'rev', 'phase', 'hostId', 'seats', 'secrets', 'game', 'seed', 'draft', 'squads', 'setup', 'comp', 'day', 'hub', 'series', 'rematch']) expect((r.state as unknown as Record<string, unknown>)[k], k).toEqual(raw[k]);
      // a room that was mid-game carries on under the rules it started with: its own draft style, and no transfer window
      expect(r.state.settings.format).toBe(raw.settings.format);
      const eng = new RoomEngine(clone(r.state), testDeps('fx'));
      const id = eng.s.seats.find((s) => !s.bot)!.id;
      expect(() => eng.view(id, eng.s.lastActive + 1)).not.toThrow();
      expect(() => eng.tick(eng.s.lastActive + 1000)).not.toThrow();
      // and once rewritten as v3 it is a fixed point
      expect(loadRoom(clone(r.state))).toMatchObject({ ok: true, from: 3, changed: false });
    });
  }
  it('a setting added after the room was saved takes its default instead of undefined', () => {
    const raw = fx('room-lobby.v2');
    delete raw.settings.legs; delete raw.settings.pace; delete raw.settings.botLevel;
    raw.settings.teams = 'many'; raw.settings.pickSeconds = Number.NaN; raw.settings.shiny = true; raw.settings.eras = ['80s', 7];
    const r = loadRoom(raw);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.changed).toBe(true);
    // what the save had is kept (its draft style, its pool, now a list); what it lacked or had mangled takes the default
    expect(r.state.settings).toEqual({ ...DEFAULT_SETTINGS, format: 'duel', pools: ['modern'], ratings: 'tier', competition: 'match', window: false, eras: ['80s'] });
    expect((r.state.settings as unknown as Record<string, unknown>)['shiny']).toBeUndefined();
  });
  it('repairs broken seats and tables, and refuses a room with no usable code or phase', () => {
    const raw = fx('room-league.v2');
    raw.seats.push({ name: 'no id' }, 'junk');
    raw.seats[0].formation = 'zz'; raw.seats[0].hue = null;
    raw.series = { wins: { a: 1, b: 'x' }, games: 'two' };
    delete raw.rematch; raw.hub = { deadline: 5 }; raw.secrets = { a: 'k', b: 3 };
    const r = loadRoom(raw);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.state.seats.length).toBe(fx('room-league.v2').seats.length);
    expect(r.state.seats[0]).toMatchObject({ formation: '433', hue: 0 });
    expect(r.state.series).toEqual({ wins: { a: 1 }, games: 0, log: [] });
    expect(r.state.rematch).toEqual({});
    expect(r.state.hub).toEqual({ deadline: 5, ready: {}, played: [] });
    expect(r.state.secrets).toEqual({ a: 'k' });
    expect(bad(r.state)).toEqual([]);
    for (const patch of [{ code: 'abc' }, { code: 7 }, { phase: 'overtime' }]) expect(loadRoom({ ...fx('room-lobby.v2'), ...patch })).toMatchObject({ ok: false, reason: 'broken' });
  });
  it('keeps what the draft needs that the type does not spell out (the sealed packs on offer)', () => {
    const raw = fx('room-draft.v2');
    expect(raw.draft.offers).toBeTruthy();
    const r = loadRoom(raw);
    if (!r.ok) throw new Error('load');
    expect(r.state.draft?.offers).toEqual(raw.draft.offers);
  });
});

describe('what a Durable Object does with what it finds in storage', () => {
  const league = fx('career-play.v1');
  it('nothing stored: starts fresh', () => {
    expect(restoreCareer(undefined)).toEqual({ kind: 'fresh' });
    expect(restoreRoom(undefined, undefined)).toEqual({ kind: 'fresh' });
  });
  it('a readable save is ready, and a damaged-but-repairable one is flagged for rewriting', () => {
    expect(restoreCareer(league)).toMatchObject({ kind: 'ready', from: 1, changed: false });
    expect(restoreCareer({ ...league, rev: -3, news: 'x' })).toMatchObject({ kind: 'ready', changed: true });
    const { comp, ...core } = fx('room-league.v2');
    expect(restoreRoom(core, comp)).toMatchObject({ kind: 'ready', from: 2, changed: true }); // a v2 room is rewritten as v3 once
    expect(restoreRoom({ ...core, settings: {} }, comp)).toMatchObject({ kind: 'ready', changed: true });
  });
  it('a league is never dropped, whatever is wrong with it; a newer one is locked untouched', () => {
    for (const raw of [{ ...league, v: 2 }, { ...league, v: 0 }, { ...league, clubs: {} }, 'junk', 42, { no: 'version' }]) {
      const r = restoreCareer(raw);
      expect(r.kind, JSON.stringify(raw).slice(0, 40)).toBe('locked');
    }
    expect(restoreCareer({ ...league, v: 2 })).toMatchObject({ kind: 'locked', reason: 'too_new', from: 2 });
  });
  it('a room too old to read is dropped (the code frees up); a newer or damaged room is locked, not deleted', () => {
    const { comp, ...core } = fx('room-league.v2');
    expect(restoreRoom({ ...core, v: 1 }, comp)).toEqual({ kind: 'drop', reason: 'too_old' });
    expect(restoreRoom({ not: 'a room' }, null)).toEqual({ kind: 'drop', reason: 'not_state' });
    expect(restoreRoom({ ...core, v: 4 }, comp)).toMatchObject({ kind: 'locked', reason: 'too_new' });
    expect(restoreRoom({ ...core, code: 'x' }, comp)).toMatchObject({ kind: 'locked', reason: 'broken' });
  });
  it('the competition stored beside the room is merged back in', () => {
    const { comp, ...core } = fx('room-league.v2');
    expect(comp).toBeTruthy();
    const r = restoreRoom({ ...core, comp: null }, comp);
    if (r.kind !== 'ready') throw new Error('not ready');
    expect(r.state.comp).toEqual(comp);
    expect(r.state satisfies RoomState).toBeTruthy();
  });
  it('the versions this build writes', () => {
    expect(careerPipeline.current).toBe(1);
    expect(roomPipeline.current).toBe(3); // the room fixtures are v2 and migrate; freeze v3 fixtures before the next bump
  });
});
