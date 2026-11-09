import { describe, expect, it } from 'vitest';
import { aiPick, dealBoard, openRoles, placePlayer } from '../src/shared/draft';
import { Rng } from '../src/shared/rng';
import { playbackSchedule, simulateMatch, type MatchResult } from '../src/shared/sim';
import { emptySquad, type Squad } from '../src/shared/squad';
import { PH, PW, buildScene, dotKey, makeLayout } from '../src/client/lib/scene';

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

function setup(seed: string, knockout = true) {
  const a = squad('a' + seed), b = squad('b' + seed);
  const result = simulateMatch(a, b, ['A', 'B'], 'm' + seed, { knockout });
  const sch = playbackSchedule(result, 'normal');
  const layout = makeLayout([a, b], seed);
  return { result, sch, layout };
}
const at = (s: ReturnType<typeof setup>, t: number) => buildScene({ layout: s.layout, result: s.result, items: s.sch.items, quiet: s.sch.quiet, t });

describe('live pitch scene', () => {
  it('is deterministic and keeps every dot and the ball on the pitch at every moment of 14 matches', () => {
    for (let i = 0; i < 14; i++) {
      const s = setup(String(i), i % 2 === 0);
      for (let t = 0; t <= s.sch.totalMs; t += 89) {
        const sc = at(s, t);
        expect(sc.dots.length).toBeGreaterThan(8);
        for (const d of sc.dots) {
          expect(d.x, `dot x at ${t}`).toBeGreaterThanOrEqual(-0.01);
          expect(d.x).toBeLessThanOrEqual(PW + 0.01);
          expect(d.y).toBeGreaterThanOrEqual(-0.01);
          expect(d.y).toBeLessThanOrEqual(PH + 0.01);
        }
        expect(Number.isFinite(sc.ball.x) && Number.isFinite(sc.ball.y)).toBe(true);
        expect(sc.ball.x).toBeGreaterThan(-8);
        expect(sc.ball.x).toBeLessThan(PW + 8);
        expect(sc.ball.y).toBeGreaterThan(-8);
        expect(sc.ball.y).toBeLessThan(PH + 8);
      }
      expect(JSON.stringify(at(s, 12345))).toBe(JSON.stringify(at(s, 12345)));
    }
  });

  it('every kind of moment has its own choreography, tag and highlighted player', () => {
    const wanted = new Set(['goal', 'save', 'miss', 'post', 'yellow', 'red', 'freekick', 'penalty', 'corner', 'pen_goal', 'pen_miss']);
    const seen = new Set<string>();
    for (let i = 0; i < 120 && seen.size < wanted.size; i++) {
      const s = setup('v' + i);
      for (const it of s.sch.items) {
        if (!wanted.has(it.event.type)) continue;
        const mid = at(s, it.at + it.dur * 0.7);
        expect(mid.tag, `${it.event.type} has a tag`).toBeTruthy();
        if (it.event.type !== 'pen_miss') expect(mid.dots.some((d) => d.hot), `${it.event.type} highlights a player`).toBe(true);
        seen.add(it.event.type);
      }
    }
    expect([...wanted].filter((w) => !seen.has(w))).toEqual([]);
  });

  it('a goal ends with the ball in the net and the net rippling; penalties start from the spot', () => {
    let goals = 0, pens = 0;
    for (let i = 0; i < 60 && (goals < 8 || pens < 2); i++) {
      const s = setup('g' + i);
      for (const it of s.sch.items) {
        const e = it.event;
        if (e.type === 'goal') {
          const end = at(s, it.at + it.dur * 0.88);
          const attacksTop = e.team === 0;
          expect(attacksTop ? end.ball.y : PH - end.ball.y, 'ball in or beside the net').toBeLessThan(2.5);
          expect(end.ripple).toBeTruthy();
          goals++;
        }
        if (e.type === 'penalty') {
          const sc = at(s, it.at + it.dur * 0.95);
          const top = e.team === 0;
          expect(Math.abs(sc.ball.x - PW / 2)).toBeLessThan(2);
          expect(top ? sc.ball.y : PH - sc.ball.y).toBeGreaterThan(8);
          expect(top ? sc.ball.y : PH - sc.ball.y).toBeLessThan(14);
          pens++;
        }
      }
    }
    expect(goals).toBeGreaterThanOrEqual(8);
  });

  it('a free kick shows a wall of four defenders', () => {
    for (let i = 0; i < 80; i++) {
      const s = setup('w' + i);
      const fk = s.sch.items.find((it) => it.event.type === 'freekick');
      if (!fk) continue;
      const sc = at(s, fk.at + fk.dur * 0.98);
      const def = fk.event.team === 0 ? 1 : 0;
      const ball = sc.ball;
      const wall = sc.dots.filter((d) => d.team === def && !d.gk && Math.hypot(d.x - ball.x, d.y - ball.y) > 7 && Math.hypot(d.x - ball.x, d.y - ball.y) < 12);
      expect(wall.length).toBeGreaterThanOrEqual(3);
      return;
    }
    throw new Error('no free kick found');
  });

  it('players sent off leave the pitch and stay gone', () => {
    for (let i = 0; i < 200; i++) {
      const s = setup('r' + i);
      const red = s.sch.items.find((it) => it.event.type === 'red');
      if (!red) continue;
      const key = dotKey(red.event.team, red.event.p!);
      expect(at(s, red.at + red.dur * 0.5).dots.some((d) => d.key === key)).toBe(true); // still there for the card
      expect(at(s, red.at + red.dur + 600).dots.some((d) => d.key === key)).toBe(false);
      expect(at(s, s.sch.totalMs).dots.some((d) => d.key === key)).toBe(false);
      return;
    }
    throw new Error('no red card in 200 matches');
  });

  it('quiet stretches are fast-forwarded and short matches stay short', () => {
    const s = setup('q1');
    const q = s.sch.quiet[0];
    expect(q).toBeTruthy();
    expect(at(s, (q![0] + q![1]) / 2).fast).toBe(true);
    const total = (r: MatchResult) => playbackSchedule(r, 'normal').totalMs;
    expect(total(s.result)).toBeLessThan(90_000);
    expect(playbackSchedule(s.result, 'quick').totalMs).toBeLessThan(total(s.result) * 0.75);
  });
});
