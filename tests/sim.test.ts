import { describe, expect, it } from 'vitest';
import { aiPick, dealBoard, openRoles, placePlayer } from '../src/shared/draft';
import { Rng } from '../src/shared/rng';
import { simulateMatch, playbackSchedule } from '../src/shared/sim';
import { emptySquad, profile, type Squad } from '../src/shared/squad';

function squad(seed: string, skill: number): Squad {
  let sq = emptySquad('433');
  const rng = new Rng(seed + '/ai');
  const taken = new Set<string>();
  for (let r = 1; r <= 11; r++) {
    const board = dealBoard({ seed, pool: 'modern', round: r, key: 'x', size: 3, taken, needs: [openRoles(sq).map((o) => o.role)] });
    const p = aiPick(sq, board, skill, rng)!;
    sq = placePlayer(sq, p.slotId, p.cardId)!;
    taken.add(p.cardId);
  }
  return sq;
}

describe('set pieces and discipline', () => {
  it('produces penalties, free kicks and corners at real-world rates, and their story is well formed', () => {
    const N = 500;
    let pens = 0, penGoals = 0, fks = 0, corners = 0, fouls = 0;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch(squad('sa' + i, 0.9), squad('sb' + i, 0.9), ['A', 'B'], 'sm' + i, { knockout: false });
      pens += r.stats.penalties[0] + r.stats.penalties[1];
      fks += r.stats.freeKicks[0] + r.stats.freeKicks[1];
      fouls += r.stats.fouls[0] + r.stats.fouls[1];
      for (const e of r.events) {
        if (e.type === 'goal' && e.src === 'penalty') penGoals++;
        if (e.type === 'corner') corners++;
      }
      // every award is followed by its shot, same minute, same team, same source
      r.events.forEach((e, idx) => {
        if (e.type === 'penalty' || e.type === 'freekick' || e.type === 'corner') {
          const next = r.events.slice(idx + 1).find((x) => ['goal', 'save', 'miss', 'post'].includes(x.type));
          expect(next, `${e.type} had no outcome`).toBeTruthy();
          expect(next!.src).toBe(e.src);
          expect(next!.team).toBe(e.team);
          expect(next!.t).toBe(e.t);
        }
      });
    }
    expect(pens / N).toBeGreaterThan(0.2); // top-five leagues: 0.25 to 0.36 a game
    expect(pens / N).toBeLessThan(0.45);
    expect(penGoals / pens).toBeGreaterThan(0.68); // real conversion is ~78%
    expect(penGoals / pens).toBeLessThan(0.9);
    expect(fks / N).toBeGreaterThan(1);
    expect(corners / N).toBeGreaterThan(0.5);
    expect(fouls / N).toBeGreaterThan(18);
    expect(fouls / N).toBeLessThan(28);
  });

  it('notorious tacklers are booked more than clean players, and takers match reputation', () => {
    // same squad with and without a notorious defender: more yellows for him
    const base = squad('traits', 1);
    let ramosY = 0, lahmY = 0;
    const withPlayer = (id: string): Squad => {
      const slots = { ...base.slots };
      slots.s2 = id; // a centre-back slot in 4-3-3
      return { ...base, slots };
    };
    for (let i = 0; i < 400; i++) {
      for (const [id, key] of [['sergio-ramos', 'r'], ['philipp-lahm', 'l']] as const) {
        const r = simulateMatch(withPlayer(id), squad('opp' + i, 0.9), ['A', 'B'], `t${key}${i}`, { knockout: false });
        const y = r.events.filter((e) => e.type === 'yellow' && e.p === id).length;
        if (key === 'r') ramosY += y; else lahmY += y;
      }
    }
    expect(ramosY).toBeGreaterThan(lahmY * 2);
  });
});

describe('match simulation', () => {
  it('is fully deterministic for a seed', () => {
    const a = squad('a', 0.9);
    const b = squad('b', 0.9);
    const r1 = simulateMatch(a, b, ['A', 'B'], 'seed1', { knockout: true });
    const r2 = simulateMatch(a, b, ['A', 'B'], 'seed1', { knockout: true });
    expect(r1).toEqual(r2);
    const r3 = simulateMatch(a, b, ['A', 'B'], 'seed2', { knockout: true });
    expect(r3.events.length).toBeGreaterThan(5);
  });

  it('knockouts always produce a winner and consistent shootouts', () => {
    for (let i = 0; i < 400; i++) {
      const r = simulateMatch(squad('x' + i, 0.8), squad('y' + i, 0.8), ['A', 'B'], 'k' + i, { knockout: true });
      expect(r.winner === 0 || r.winner === 1).toBe(true);
      if (r.went === 'pens') {
        expect(r.pens).toBeTruthy();
        expect(r.pens![0]).not.toBe(r.pens![1]);
        expect(r.winner).toBe(r.pens![0] > r.pens![1] ? 0 : 1);
        expect(r.score[0]).toBe(r.score[1]);
      } else {
        expect(r.winner).toBe(r.score[0] > r.score[1] ? 0 : 1);
      }
      const goals = r.events.filter((e) => e.type === 'goal');
      expect(goals.length).toBe(r.score[0] + r.score[1]);
    }
  });

  it('events are in order and the schedule is monotonic', () => {
    const r = simulateMatch(squad('p', 0.9), squad('q', 0.9), ['A', 'B'], 'ord', { knockout: true });
    const { items, totalMs } = playbackSchedule(r);
    for (let i = 1; i < items.length; i++) expect(items[i]!.at).toBeGreaterThanOrEqual(items[i - 1]!.at);
    expect(totalMs).toBeGreaterThan(8000);
    expect(totalMs).toBeLessThan(120_000);
    // match events (not penalties) are time-ordered
    const live = r.events.filter((e) => e.t <= 120);
    for (let i = 1; i < live.length; i++) expect(live[i]!.t).toBeGreaterThanOrEqual(live[i - 1]!.t);
  });

  it('feels like football: goals, draws, cards and a fair favourite curve', () => {
    const N = 600;
    let goals = 0, draws = 0, reds = 0, yellows = 0;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch(squad('ca' + i, 0.9), squad('cb' + i, 0.9), ['A', 'B'], 'cm' + i, { knockout: false });
      goals += r.score[0] + r.score[1];
      if (r.winner === null) draws++;
      reds += r.stats.reds[0] + r.stats.reds[1];
      yellows += r.stats.yellows[0] + r.stats.yellows[1];
    }
    expect(goals / N).toBeGreaterThan(2.2);
    expect(goals / N).toBeLessThan(3.3);
    expect(draws / N).toBeGreaterThan(0.15);
    expect(draws / N).toBeLessThan(0.32);
    // real averages: Premier League 2024-25 is ~4.3 yellows and ~0.15 reds a game
    expect(reds / N).toBeGreaterThan(0.06);
    expect(reds / N).toBeLessThan(0.24);
    expect(yellows / N).toBeGreaterThan(3.5);
    expect(yellows / N).toBeLessThan(5);

    // the stronger side wins clearly more often than not, but upsets still happen
    let strongWins = 0, weakWins = 0, n = 0;
    for (let i = 0; i < 1500 && n < 500; i++) {
      const a = squad('fa' + i, 1), b = squad('fb' + i, 0.35);
      const gap = profile(a).overall - profile(b).overall;
      if (gap < 4) continue;
      n++;
      const r = simulateMatch(a, b, ['A', 'B'], 'fm' + i, { knockout: false });
      if (r.winner === 0) strongWins++;
      if (r.winner === 1) weakWins++;
    }
    expect(n).toBeGreaterThan(100);
    expect(strongWins / n).toBeGreaterThan(0.55);
    expect(weakWins / n).toBeGreaterThan(0.05);
  });
});
