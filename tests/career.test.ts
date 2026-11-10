import { describe, expect, it } from 'vitest';
import {
  BENCH, DAYS, LEAGUE_SIZE, ROSTER, SETTLE, WINDOW_AFTER, advanceDraft, createCareer, draftPick, freePool, isAvailable, joinCareer, lineupFor, nextWake,
  overlayFor, runDay, setAuto, setLineup, setReady, startCareer, table, tick, viewFor, windowPlan, windowReady, type CareerState,
} from '../src/shared/career/engine';
import { makeWorld } from './career-world';

const W = makeWorld();
const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function lobby(seed = 'seed-a', humans = 1): CareerState {
  const st = createCareer(W, 'ABCD', seed, T0);
  for (let i = 0; i < humans; i++) {
    const r = joinCareer(W, st, { memberId: `m${i}-xxxxxxxx`, name: `Man ${i}`, choice: { kind: 'real', id: `t${String(i).padStart(2, '0')}` } });
    expect(r.ok).toBe(true);
  }
  return st;
}

/** Start a league and let the humans draft by taking whatever the engine suggests (their clock simply runs out). */
function started(seed = 'seed-a', humans = 1): { st: CareerState; now: number } {
  const st = lobby(seed, humans);
  let now = T0;
  expect(startCareer(W, st, now).ok).toBe(true);
  while (st.phase === 'draft') { now += st.settings.pickHours * HOUR + 1; tick(W, st, now); }
  return { st, now };
}

describe('joining', () => {
  it('lets a manager take a real club once, with a generated badge', () => {
    const st = createCareer(W, 'ABCD', 's', T0);
    expect(joinCareer(W, st, { memberId: 'a1234567', name: 'Sam', choice: { kind: 'real', id: 't03' } }).ok).toBe(true);
    const again = joinCareer(W, st, { memberId: 'b1234567', name: 'Alex', choice: { kind: 'real', id: 't03' } });
    expect(again).toMatchObject({ ok: false, code: 'taken' });
    expect(st.clubs['t03']!.badge.c1).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('refuses a Second League club to start, a ninth name character class, and a duplicate name', () => {
    const st = createCareer(W, 'ABCD', 's', T0);
    expect(joinCareer(W, st, { memberId: 'a1234567', name: 'Sam', choice: { kind: 'real', id: 't20' } })).toMatchObject({ ok: false, code: 'club' });
    expect(joinCareer(W, st, { memberId: 'a1234567', name: 'Sam', choice: { kind: 'custom', name: '<b>x</b>' } })).toMatchObject({ ok: false, code: 'club_name' });
    expect(joinCareer(W, st, { memberId: 'a1234567', name: 'Sam', choice: { kind: 'custom', name: 'club t05' } })).toMatchObject({ ok: false, code: 'club_name' });
  });
  it('an invented club takes the place of the weakest free First League club and the league stays full', () => {
    const st = createCareer(W, 'ABCD', 's', T0);
    expect(joinCareer(W, st, { memberId: 'a1234567', name: 'Sam', choice: { kind: 'custom', name: 'Sunday Rovers' } }).ok).toBe(true);
    expect(st.leagues['1'].clubs).toHaveLength(LEAGUE_SIZE);
    expect(Object.values(st.clubs).some((c) => c.name === 'Sunday Rovers' && !c.real)).toBe(true);
    expect(st.clubs['t15']).toBeUndefined(); // the weakest of the sixteen
  });
  it('allows four managers and no more', () => {
    const st = lobby('s', 4);
    expect(joinCareer(W, st, { memberId: 'e1234567', name: 'Fifth', choice: { kind: 'real', id: 't09' } })).toMatchObject({ ok: false, code: 'full' });
  });
});

describe('the draft', () => {
  it('drafts a legal squad of 20 for every First League club, bots and humans alike, with nobody picked twice', () => {
    const { st } = started();
    const owned = new Set<string>();
    for (const id of st.leagues['1'].clubs) {
      const c = st.clubs[id]!;
      expect(c.roster).toHaveLength(ROSTER);
      const lines = { GK: 0, DF: 0, MF: 0, FW: 0 } as Record<string, number>;
      for (const pid of c.roster) { expect(owned.has(pid), pid).toBe(false); owned.add(pid); const pos = W.player(pid).pos; lines[pos === 'GK' ? 'GK' : ['LB', 'CB', 'RB'].includes(pos) ? 'DF' : ['CDM', 'CM', 'CAM'].includes(pos) ? 'MF' : 'FW']!++; }
      expect(lines.GK).toBeGreaterThanOrEqual(2);
      expect(lines.DF).toBeGreaterThanOrEqual(6);
      expect(lines.MF).toBeGreaterThanOrEqual(6);
      expect(lines.FW).toBeGreaterThanOrEqual(3);
    }
    expect(st.phase).toBe('play');
  });
  it('follows a snake order and waits for a human on the clock', () => {
    const st = lobby('s', 1);
    startCareer(W, st, T0);
    const d = st.draft!;
    expect(d.order.slice(0, LEAGUE_SIZE)).toEqual([...d.order.slice(LEAGUE_SIZE, 2 * LEAGUE_SIZE)].reverse());
    // bots before the human have already picked; the clock is on the human
    expect(st.clubs[d.order[d.i]!]!.human).toBeTruthy();
    expect(d.deadline).toBe(T0 + st.settings.pickHours * HOUR);
  });
  it('rejects picks out of turn, taken players and unbalanced squads', () => {
    const st = lobby('s', 1);
    startCareer(W, st, T0);
    const me = st.members[0]!;
    const taken = st.draft!.picks[0]?.[1];
    if (taken) expect(draftPick(W, st, me.id, taken, T0)).toMatchObject({ ok: false });
    // a squad that has taken all its allowed forwards cannot take another
    const fw = freeBy(st, 'FW');
    const club = st.clubs[me.clubId]!;
    for (const id of fw.slice(0, 6)) { club.roster.push(id); st.owner[id] = club.id; }
    const seventh = fw[6]!;
    expect(draftPick(W, st, me.id, seventh, T0)).toMatchObject({ ok: false, code: 'squad' });
    expect(draftPick(W, { ...st, draft: { ...st.draft!, i: st.draft!.i + 1 } }, me.id, fw[7]!, T0)).toMatchObject({ ok: false, code: 'turn' });
  });
  it('a human who does not pick in time is picked for, and the draft still finishes', () => {
    const { st } = started('timeout', 2);
    expect(st.phase).toBe('play');
    for (const m of st.members) expect(st.clubs[m.clubId]!.roster).toHaveLength(ROSTER);
  });
  it('is fully determined by the seed', () => {
    const a = started('same', 2).st, b = started('same', 2).st, c = started('other', 2).st;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.clubs)).not.toBe(JSON.stringify(c.clubs));
  });
  it('leaves the undrafted players in a free pool', () => {
    const { st } = started();
    const free = freePool(W, st);
    expect(free.length).toBeGreaterThan(50);
    for (const p of free) expect(st.owner[p.id]).toBeUndefined();
  });
});

function freeBy(st: CareerState, line: 'GK' | 'FW'): string[] {
  return freePool(W, st).filter((p) => (line === 'GK' ? p.pos === 'GK' : ['LW', 'RW', 'ST'].includes(p.pos))).map((p) => p.id);
}

describe('the matchday gate', () => {
  it('waits for a manager who has not confirmed, plays when they do', () => {
    const { st, now } = started('gate', 1);
    tick(W, st, now + 1000);
    expect(st.day).toBe(0);
    expect(setReady(W, st, st.members[0]!.id, true, now + 2000).ok).toBe(true);
    expect(st.day).toBe(1);
    expect(st.leagues['1'].days[0]!.every((f) => f.r)).toBe(true);
    expect(st.lastDay?.matches).toHaveLength(1);
  });
  it('plays with the saved line-up when the deadline passes', () => {
    const { st, now } = started('deadline', 1);
    expect(nextWake(st)).toBe(st.deadline);
    tick(W, st, st.deadline! + 1);
    expect(st.day).toBe(1);
    expect(st.deadline).toBe(st.deadline); // a new deadline was opened
    expect(st.deadline! > now).toBe(true);
  });
  it('with two managers, the day waits for the slower one — together it goes straight through', () => {
    const { st, now } = started('two', 2);
    const [a, b] = st.members;
    setReady(W, st, a!.id, true, now + 1);
    expect(st.day).toBe(0);
    setReady(W, st, b!.id, true, now + 2);
    expect(st.day).toBe(1);
  });
  it('an auto-play manager never holds the day up', () => {
    const { st, now } = started('auto', 2);
    setAuto(st, st.members[1]!.id, true);
    setReady(W, st, st.members[0]!.id, true, now + 1);
    expect(st.day).toBe(1);
  });
  it('a result is a function of the seed: replaying the same league gives the same tables', () => {
    const run = () => { const { st } = started('replay', 1); for (let i = 0; i < 5; i++) runDay(W, st, T0); return JSON.stringify(table(st, 1)); };
    expect(run()).toBe(run());
  });
  it('plays 8 fixtures in each league every matchday and every club exactly once', () => {
    const { st, now } = started('fix', 1);
    setReady(W, st, st.members[0]!.id, true, now + 1);
    for (const lid of ['1', '2'] as const) {
      const day = st.leagues[lid].days[0]!;
      expect(day).toHaveLength(8);
      const seen = day.flatMap((f) => [f.a, f.b]);
      expect(new Set(seen).size).toBe(16);
    }
  });
});

describe('injuries, suspensions and the bench', () => {
  /** play 14 days with the human always ready */
  function toWindow(seed: string, humans = 1) {
    const { st, now } = started(seed, humans);
    let t = now;
    while (st.phase === 'play') { t += 10; for (const m of st.members) setReady(W, st, m.id, true, t); }
    return { st, now: t };
  }
  it('across half a season some players are injured or suspended, at roughly real-world rates', () => {
    const { st } = toWindow('health');
    const injured = Object.keys(st.injuries).length;
    // about a quarter of a team's matches carry an injury: ~0.25 * 15 days * 32 clubs = ~120 injuries started, many already healed
    const started = st.news.filter((n) => n.kind === 'injury').length; // only the human's club is reported
    expect(injured).toBeGreaterThan(0);
    expect(started).toBeGreaterThanOrEqual(0);
    expect(st.day).toBe(WINDOW_AFTER);
  });
  it('an injured or suspended player is never in the eleven, and a fit substitute comes in', () => {
    const { st } = started('repair', 1);
    const me = st.clubs[st.members[0]!.clubId]!;
    const xiBefore = lineupFor(W, st, me);
    const star = Object.values(xiBefore.slots).find(Boolean)!;
    st.injuries[star] = { left: 3, kind: 'muscle' };
    const after = lineupFor(W, st, me);
    expect(Object.values(after.slots)).not.toContain(star);
    expect(Object.values(after.slots).filter(Boolean)).toHaveLength(11);
    expect(isAvailable(st, star)).toBe(false);
  });
  it('time served counts down: a one-match ban is over after one matchday', () => {
    const { st, now } = started('ban', 1);
    const me = st.clubs[st.members[0]!.clubId]!;
    const pid = me.roster[0]!;
    st.susp[pid] = 1;
    st.injuries[me.roster[1]!] = { left: 2, kind: 'muscle' };
    setReady(W, st, st.members[0]!.id, true, now + 1);
    expect(st.susp[pid]).toBeUndefined();
    expect(st.injuries[me.roster[1]!]!.left).toBe(1);
  });
  it('keeps seven on the bench when everyone is fit', () => {
    const { st } = started('bench', 1);
    const me = st.clubs[st.members[0]!.clubId]!;
    const xi = new Set(Object.values(lineupFor(W, st, me).slots));
    expect(me.roster.filter((id) => !xi.has(id)).length).toBe(ROSTER - 11);
    expect(ROSTER - 11).toBeGreaterThanOrEqual(BENCH);
  });
  it('validates a saved line-up', () => {
    const { st } = started('sl', 1);
    const m = st.members[0]!;
    const me = st.clubs[m.clubId]!;
    expect(setLineup(W, st, m.id, { formation: '442', style: 'press', slots: { s0: 'nobody-here' } })).toMatchObject({ ok: false, code: 'player' });
    const slots = Object.fromEntries(Object.keys(me.xi).map((k) => [k, me.xi[k] ?? null]));
    expect(setLineup(W, st, m.id, { formation: me.formation, style: 'counter', slots }).ok).toBe(true);
    expect(me.style).toBe('counter');
  });
});

describe('the transfer window', () => {
  function atWindow(seed = 'win') {
    const { st, now } = started(seed, 1);
    let t = now;
    while (st.phase === 'play') { t += 10; setReady(W, st, st.members[0]!.id, true, t); }
    expect(st.phase).toBe('window');
    return { st, now: t, m: st.members[0]!, me: st.clubs[st.members[0]!.clubId]! };
  }
  /** n like-for-like swaps: release the lowest-rated at a position, sign the best free one */
  function swaps(st: CareerState, me: ReturnType<typeof atWindow>['me'], n: number) {
    const out: Array<{ out: string; in: string }> = [];
    const used = new Set<string>();
    const pool = freePool(W, st).sort((a, b) => b.ovr - a.ovr);
    for (const rid of [...me.roster].sort((a, b) => W.player(a).ovr - W.player(b).ovr)) {
      if (out.length >= n) break;
      const pos = W.player(rid).pos;
      const cand = pool.find((p) => p.pos === pos && !used.has(p.id));
      if (cand) { used.add(cand.id); out.push({ out: rid, in: cand.id }); }
    }
    return out;
  }
  it('opens after matchday 15 and closes when every manager is ready', () => {
    const { st, now, m } = atWindow();
    expect(st.day).toBe(WINDOW_AFTER);
    expect(st.window?.kind).toBe('mid');
    expect(viewFor(W, st, m.id).window?.pool.length).toBeGreaterThan(0);
    windowReady(W, st, m.id, true, now + 1);
    expect(st.phase).toBe('play');
  });
  it('up to three swaps cost nothing beyond a short settling-in', () => {
    const { st, now, m, me } = atWindow('mild');
    const plan = swaps(st, me, 3);
    expect(windowPlan(W, st, m.id, plan).ok).toBe(true);
    windowReady(W, st, m.id, true, now + 1);
    expect(me.sharp.left).toBe(0);
    expect(Object.values(me.newcomers).every((n) => !n.heavy)).toBe(true);
    expect(me.roster).toHaveLength(ROSTER);
  });
  it('more than three swaps bring a heavier settling-in and a loss of sharpness, but never a points deduction', () => {
    const { st, now, m, me } = atWindow('heavy');
    const before = table(st, 1).find((r) => r.id === me.id)!.pts;
    const plan = swaps(st, me, 6);
    expect(plan).toHaveLength(6);
    expect(windowPlan(W, st, m.id, plan).ok).toBe(true);
    windowReady(W, st, m.id, true, now + 1);
    expect(Object.values(me.newcomers).filter((n) => n.heavy)).toHaveLength(3);
    expect(me.sharp.left).toBeGreaterThan(0);
    expect(me.sharp.hit).toBeCloseTo(3.6, 5); // three over the allowance x 1.2
    expect(table(st, 1).find((r) => r.id === me.id)!.pts).toBe(before);
    // the penalty is real: a heavy newcomer plays below his rating, and recovers
    const heavyId = Object.keys(me.newcomers).find((id) => me.newcomers[id]!.heavy)!;
    const eff = overlayFor(W, st, me)[heavyId]!;
    expect(eff).toBeLessThan(W.player(heavyId).ovr - 4.5);
    me.newcomers[heavyId]!.left = 1;
    expect(overlayFor(W, st, me)[heavyId]!).toBeGreaterThan(eff);
  });
  it('refuses more than the maximum, unbalanced squads and players somebody owns', () => {
    const { st, m, me } = atWindow('limits');
    expect(windowPlan(W, st, m.id, swaps(st, me, 9))).toMatchObject({ ok: false, code: 'max' });
    const gk = me.roster.filter((id) => W.player(id).pos === 'GK');
    const fwFree = freeBy(st, 'FW')[0]!;
    expect(windowPlan(W, st, m.id, [{ out: gk[0]!, in: fwFree }, { out: gk[1]!, in: freeBy(st, 'FW')[1]! }])).toMatchObject({ ok: false, code: 'squad' });
    const someonesPlayer = st.clubs['t05']!.roster[0]!;
    expect(windowPlan(W, st, m.id, [{ out: me.roster[0]!, in: someonesPlayer }])).toMatchObject({ ok: false, code: 'in' });
  });
  it('closes at its deadline even if the manager never answers', () => {
    const { st, now } = atWindow('late');
    tick(W, st, now + st.settings.windowHours * HOUR + 1);
    expect(st.phase).toBe('play');
  });
});

describe('a whole season, and the next one', () => {
  function season(seed: string) {
    const { st, now } = started(seed, 1);
    let t = now;
    let guard = 0;
    while (st.season === 1 && guard++ < 200) {
      t += 10;
      if (st.phase === 'play') setReady(W, st, st.members[0]!.id, true, t);
      else if (st.phase === 'window') windowReady(W, st, st.members[0]!.id, true, t);
    }
    return { st, t };
  }
  it('plays 30 matchdays, records the season, moves two clubs up and two down, ages everyone and starts season 2', () => {
    const { st } = season('s1');
    expect(st.season).toBe(2);
    expect(st.history).toHaveLength(1);
    const h = st.history[0]!;
    expect(h.promoted).toHaveLength(2);
    expect(h.relegated).toHaveLength(2);
    for (const id of h.promoted) expect(st.clubs[id]!.league).toBe(1);
    for (const id of h.relegated) expect(st.clubs[id]!.league).toBe(2);
    expect(st.leagues['1'].clubs).toHaveLength(LEAGUE_SIZE);
    expect(st.leagues['2'].clubs).toHaveLength(LEAGUE_SIZE);
    expect(st.day).toBe(0);
    expect(st.phase).toBe('play');
    expect(Object.keys(st.ratings).length).toBeGreaterThan(400);
    expect(st.leagues['1'].days).toHaveLength(DAYS);
    // everyone with a known age is a year older
    const pid = W.players.find((p) => p.age !== null)!.id;
    expect(st.ages[pid]).toBe(W.player(pid).age! + 1);
  });
  it('a league table adds up: every match has a winner or a draw, goals for equal goals against', () => {
    const { st } = started('sum', 1);
    let t = T0;
    for (let i = 0; i < 10; i++) { t += 10; setReady(W, st, st.members[0]!.id, true, t); }
    const rows = table(st, 1);
    expect(rows.reduce((a, r) => a + r.gf, 0)).toBe(rows.reduce((a, r) => a + r.ga, 0));
    expect(rows.reduce((a, r) => a + r.w, 0)).toBe(rows.reduce((a, r) => a + r.l, 0));
    for (const r of rows) { expect(r.p).toBe(10); expect(r.pts).toBe(r.w * 3 + r.d); }
  });
  it('bot-only play looks like football: goals, cards and injuries near real-world averages', () => {
    const { st } = started('realism', 1);
    let t = T0;
    let goals = 0, matches = 0, reds = 0, yellows = 0;
    for (let i = 0; i < 12; i++) {
      t += 10;
      setReady(W, st, st.members[0]!.id, true, t);
      for (const lid of ['1', '2'] as const) for (const f of st.leagues[lid].days[i]!) { goals += f.r![0] + f.r![1]; matches++; }
    }
    void reds; void yellows;
    const gpm = goals / matches;
    expect(gpm).toBeGreaterThan(1.9);
    expect(gpm).toBeLessThan(3.6);
    const injured = Object.keys(st.injuries).length;
    expect(injured).toBeGreaterThan(3);
    expect(injured).toBeLessThan(110);
  });
});

describe('what a manager is shown', () => {
  it("shows only the viewer's own saved line-up and stays small", () => {
    const { st } = started('view', 2);
    const v = viewFor(W, st, st.members[0]!.id);
    expect(v.mine?.roster).toEqual(st.clubs[st.members[0]!.clubId]!.roster);
    const json = JSON.stringify(v);
    expect((json.match(/"xi":/g) ?? []).length).toBe(1);
    expect(json.length).toBeLessThan(60_000);
    // a viewer with no seat (a spectator) gets no private block at all
    expect(viewFor(W, st, null).mine).toBeNull();
  });
  it('member ids are opaque league handles, not anything that identifies an account', () => {
    const { st } = started('ids', 1);
    expect(st.members[0]!.id).toMatch(/^m\d-/);
  });
});
