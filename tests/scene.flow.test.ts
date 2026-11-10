import { describe, expect, it } from 'vitest';
import { aiPick, dealBoard, openRoles, placePlayer } from '../src/shared/draft';
import { Rng } from '../src/shared/rng';
import { isHighlight, playbackSchedule, simulateMatch, type MatchEvent } from '../src/shared/sim';
import { emptySquad, type Squad } from '../src/shared/squad';
import { PH, buildScene, makeLayout } from '../src/client/lib/scene';

function squad(seed: string): Squad {
  let sq = emptySquad('433');
  const rng = new Rng(seed + '/ai');
  const taken = new Set<string>();
  for (let r = 1; r <= 11; r++) {
    const board = dealBoard({ seed, pool: 'modern', round: r, key: 'x', size: 3, taken, needs: [openRoles(sq).map((o) => o.role)] });
    const p = aiPick(sq, board, 0.9, rng)!;
    sq = placePlayer(sq, p.slotId, p.cardId)!;
    taken.add(p.cardId);
  }
  return sq;
}
function match(seed: string, knockout = false) {
  const a = squad('a' + seed), b = squad('b' + seed);
  const result = simulateMatch(a, b, ['A', 'B'], 'm' + seed, { knockout });
  const sch = playbackSchedule(result, 'normal');
  const layout = makeLayout([a, b], seed);
  return { result, sch, layout, at: (t: number) => buildScene({ layout, result, items: sch.items, quiet: sch.quiet, t }) };
}
const SHOTS = new Set(['goal', 'save', 'miss', 'post']);
/** kick-off, then one moment far away: a minute of nothing but quiet play in between */
const FAR = [
  { at: 0, dur: 500, event: { t: 0, type: 'kickoff', team: 0, text: '', s: [0, 0] } as MatchEvent },
  { at: 80_000, dur: 1000, event: { t: 1, type: 'half', team: 0, text: '', s: [0, 0] } as MatchEvent },
];

describe('quiet play is an arrow, not a swarm of dots', () => {
  it('shows one team attacking at a time, nothing else on the pitch, and both teams get their turn', () => {
    for (const seed of ['0', '1', '22']) {
      const m = match(seed);
      const far = FAR;
      const scene = (t: number) => buildScene({ layout: m.layout, result: m.result, items: far, quiet: [], t });
      let t0 = 0, t1 = 0, frames = 0;
      for (let t = 2000; t < 70_000; t += 100) {
        const s = scene(t);
        expect(s.live, `t=${t}`).toBe(0);
        expect(s.flow).not.toBeNull();
        const f = s.flow!;
        expect(f.show[0] + f.show[1], `show adds up at ${t}`).toBeGreaterThan(0.97);
        expect(f.show[0] + f.show[1]).toBeLessThan(1.03);
        for (const k of [0, 1] as const) { expect(f.level[k]).toBeGreaterThanOrEqual(0); expect(f.level[k]).toBeLessThanOrEqual(0.62); } // quiet play never claims a big chance
        if (f.show[0] > 0.9) t0++;
        if (f.show[1] > 0.9) t1++;
        frames++;
      }
      expect(t0 / frames, `seed ${seed}: team 0 holds the arrow`).toBeGreaterThan(0.12);
      expect(t1 / frames, `seed ${seed}: team 1 holds the arrow`).toBeGreaterThan(0.12);
    }
  });

  it('the arrow swaps smoothly: it never flips from one team to the other in a single frame', () => {
    const m = match('3');
    const far = FAR;
    let prev = buildScene({ layout: m.layout, result: m.result, items: far, quiet: [], t: 2000 }).flow!;
    for (let t = 2033; t < 70_000; t += 33) {
      const f = buildScene({ layout: m.layout, result: m.result, items: far, quiet: [], t }).flow!;
      expect(Math.abs(f.show[0] - prev.show[0]), `at ${t}`).toBeLessThan(0.12);
      prev = f;
    }
  });
});

describe('a coming chance makes the arrow warn, honestly', () => {
  /** a shot with some quiet play before it, so the build-up is not cut off by another moment */
  function findShot(minP: number, maxP: number, gap = 2500) {
    for (let i = 0; i < 60; i++) {
      const m = match('s' + i);
      for (const it of m.sch.items) {
        const e = it.event;
        if (!SHOTS.has(e.type) || (e.src && e.src !== 'play') || (e.xg ?? 0) < minP || (e.xg ?? 0) >= maxP) continue;
        const prev = m.sch.items[m.sch.items.indexOf(it) - 1];
        if (prev && it.at - (prev.at + prev.dur) < gap) continue;
        if (it.at < 6000) continue;
        return { m, it };
      }
    }
    throw new Error(`no shot with a chance between ${minP} and ${maxP} found`);
  }
  /** the arrow's level for the attacking team at the calm moments in a window before the shot */
  const calmLevels = (m: ReturnType<typeof match>, it: { at: number; event: MatchEvent }, from: number, to: number) => {
    const out: number[] = [];
    for (let t = it.at + from; t <= it.at + to; t += 100) {
      const s = m.at(t);
      if (s.flow && s.live < 0.05) out.push(s.flow.level[it.event.team]);
    }
    return out;
  };

  it('before a clear-cut chance the attacker\'s arrow climbs, owns the pitch, and says BIG CHANCE', () => {
    const { m, it } = findShot(0.28, 1, 1800);
    const team = it.event.team;
    const levels = calmLevels(m, it, -1600, -800);
    expect(levels.length).toBeGreaterThan(5);
    for (let i = 1; i < levels.length; i++) expect(levels[i]!, `step ${i}`).toBeGreaterThanOrEqual(levels[i - 1]! - 0.03);
    expect(levels.at(-1)!).toBeGreaterThan(levels[0]!);
    const last = m.at(it.at - 800).flow!;
    expect(last.label[team]).toBe('chance');
    expect(last.level[team]).toBeGreaterThan(0.62);
    expect(last.show[team]).toBeGreaterThan(0.9); // it is that team's arrow by now
  });

  it('a speculative effort is not dressed up as a big chance', () => {
    const { m, it } = findShot(0, 0.07, 2000);
    const f = m.at(it.at - 800).flow!;
    expect(f.label[it.event.team]).not.toBe('chance');
    expect(f.level[it.event.team]).toBeLessThan(0.62);
  });

  it('across many shots, a higher chance means a higher arrow', () => {
    const lows: number[] = [], highs: number[] = [];
    for (let i = 0; i < 40; i++) {
      const m = match('v' + i);
      for (const it of m.sch.items) {
        const e = it.event;
        if (!SHOTS.has(e.type) || (e.src && e.src !== 'play') || it.at < 6000) continue;
        const f = m.at(it.at - 800);
        if (!f.flow || f.live > 0.05) continue;
        ((e.xg ?? 0) >= 0.2 ? highs : lows).push(f.flow.level[e.team]);
      }
    }
    expect(highs.length).toBeGreaterThan(10);
    expect(lows.length).toBeGreaterThan(10);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(highs)).toBeGreaterThan(avg(lows) + 0.12);
  });

  it('a penalty is a certain chance', () => {
    for (let i = 0; i < 80; i++) {
      const m = match('p' + i);
      const it = m.sch.items.find((x) => x.event.type === 'penalty' && x.at > 6000);
      if (!it) continue;
      const f = m.at(it.at - 100).flow;
      if (f) { expect(f.level[it.event.team]).toBeGreaterThan(0.95); expect(f.label[it.event.team]).toBe('chance'); return; }
    }
    throw new Error('no penalty found');
  });

  it('as the moment begins the arrow gives way to the players, and returns once it is over', () => {
    const { m, it } = findShot(0.15, 1, 3000);
    expect(isHighlight(it.event)).toBe(true);
    expect(m.at(it.at - 1500).live).toBeLessThan(0.05);
    expect(m.at(it.at - 1500).flow).not.toBeNull();
    const during = m.at(it.at + it.dur / 2);
    expect(during.live).toBe(1);
    expect(during.flow === null || during.flow.show[0] + during.flow.show[1] < 0.01).toBe(true);
    // a moment later nothing is left: the arrow is back and the players are gone (unless another highlight follows)
    const after = it.at + it.dur + 2500;
    const next = m.sch.items.find((x) => x.at > it.at + it.dur);
    if (!next || next.at - after > 1500) expect(m.at(after).live).toBeLessThan(0.05);
  });
});

describe('banners and highlights', () => {
  it('half-time and full-time are a banner on an empty pitch: no arrow, no players', () => {
    const m = match('7');
    for (const type of ['half', 'full']) {
      const it = m.sch.items.find((x) => x.event.type === type);
      expect(it, type).toBeTruthy();
      const s = m.at(it!.at + it!.dur / 2);
      expect(s.live).toBe(0);
      expect(s.flow).toBeNull();
      expect(s.tag?.kind).toBe('info');
    }
  });

  it('the players keep being tracked while hidden, so a highlight starts with everyone already in place', () => {
    const m = match('2');
    const it = m.sch.items.find((x) => SHOTS.has(x.event.type) && isHighlight(x.event) && x.at > 6000)!;
    const s = m.at(it.at - 300);
    expect(s.live).toBeGreaterThan(0.3);
    expect(s.dots.length).toBeGreaterThanOrEqual(20);
    // the team about to shoot has already pushed up toward the goal it attacks
    const att = it.event.team;
    const ys = s.dots.filter((d) => d.team === att && !d.gk).map((d) => d.y);
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    if (att === 0) expect(mean).toBeLessThan(PH * 0.62);
    else expect(mean).toBeGreaterThan(PH * 0.38);
  });
});

describe('highlights are rare enough that quiet play is mostly the arrow', () => {
  it('only goals, penalties, red cards and real chances cut to the players', () => {
    const kinds = { highlight: new Set<string>(), minor: new Set<string>() };
    for (let i = 0; i < 30; i++) {
      for (const it of match('h' + i).sch.items) (isHighlight(it.event) ? kinds.highlight : kinds.minor).add(it.event.type);
    }
    for (const t of ['goal', 'penalty', 'red', 'kickoff']) expect(kinds.highlight.has(t), t).toBe(true);
    for (const t of ['yellow', 'freekick', 'corner']) { expect(kinds.minor.has(t), t).toBe(true); expect(kinds.highlight.has(t), `${t} should never cut to the players`).toBe(false); }
  });

  it('on average about a third of a match or more is just the arrow, and no match is all highlights', () => {
    let calm = 0, frames = 0, worst = 1;
    for (let i = 0; i < 10; i++) {
      const m = match('q' + i);
      let c = 0, f = 0;
      for (let t = 0; t < m.sch.totalMs; t += 100) { const s = m.at(t); f++; if (s.flow && s.live < 0.05) c++; }
      calm += c; frames += f; worst = Math.min(worst, c / f);
    }
    expect(calm / frames).toBeGreaterThan(0.3);
    expect(worst).toBeGreaterThan(0.12);
  });

  it('the pitch shows the formation before kick-off, not an attack', () => {
    const m = match('0');
    const s = m.at(0);
    expect(s.live).toBe(1);
    expect(s.flow).toBeNull();
  });
});
