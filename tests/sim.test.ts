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
    expect(reds / N).toBeLessThan(0.3);
    expect(yellows / N).toBeGreaterThan(2.5);
    expect(yellows / N).toBeLessThan(5.5);

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
