import { describe, expect, it } from 'vitest';
import { aiPick, dealBoard, openRoles, placePlayer } from '../src/shared/draft';
import { Rng } from '../src/shared/rng';
import { playbackSchedule, simulateMatch, type MatchEvent } from '../src/shared/sim';
import { emptySquad, type Squad } from '../src/shared/squad';
import { buildScene, makeLayout } from '../src/client/lib/scene';

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

const FRAME = 1000 / 30;

/** Walks a whole match at 30fps and reports how things move: how fast, and where they jump. */
function motion(seed: string, pace: 'normal' | 'quick' = 'normal') {
  const a = squad('a' + seed), b = squad('b' + seed);
  const result = simulateMatch(a, b, ['A', 'B'], 'm' + seed, { knockout: seed.length % 2 === 0 });
  const sch = playbackSchedule(result, pace);
  const layout = makeLayout([a, b], seed);
  let prev = buildScene({ layout, result, items: sch.items, quiet: sch.quiet, t: 0 });
  let dotMax = 0, ballMax = 0, dotJumps = 0, ballJumps = 0, ambientSpeed = 0, ambientFrames = 0, turns = 0, frames = 0;
  let worst = { t: 0, what: '', v: 0 };
  let lastDir: [number, number] | null = null;
  for (let t = FRAME; t <= sch.totalMs; t += FRAME) {
    const sc = buildScene({ layout, result, items: sch.items, quiet: sch.quiet, t });
    frames++;
    const pd = new Map(prev.dots.map((d) => [d.key, d]));
    for (const d of sc.dots) {
      const o = pd.get(d.key);
      if (!o) continue;
      const step = Math.hypot(d.x - o.x, d.y - o.y);
      if (step > dotMax) { dotMax = step; if (step > worst.v) worst = { t, what: `dot ${d.key}`, v: step }; }
      if (step > 0.6) dotJumps++;
    }
    const bs = Math.hypot(sc.ball.x - prev.ball.x, sc.ball.y - prev.ball.y);
    if (bs > ballMax) ballMax = bs;
    if (bs > 1.5) { ballJumps++; if (bs > worst.v) worst = { t, what: 'ball', v: bs }; }
    const inEvent = sch.items.some((it) => t >= it.at && t < it.at + it.dur + 3600); // the ball is played back into the game after a moment
    if (!inEvent) {
      ambientSpeed += bs * 30; ambientFrames++;
      const dir: [number, number] = [sc.ball.x - prev.ball.x, sc.ball.y - prev.ball.y];
      if (lastDir && Math.hypot(...dir) > 0.02 && Math.hypot(...lastDir) > 0.02 && dir[0] * lastDir[0] + dir[1] * lastDir[1] < 0) turns++;
      if (Math.hypot(...dir) > 0.02) lastDir = dir;
    }
    prev = sc;
  }
  return { went: result.went, dotMax, ballMax, dotJumps, ballJumps, avgBall: ambientSpeed / Math.max(1, ambientFrames), turnsPerSec: turns / (ambientFrames / 30), totalMs: sch.totalMs, worst, frames };
}

describe('the live pitch moves like football, not like a slot machine', () => {
  const runs = ['0', '1', '22', '3', '44', '5'].map((s) => motion(s));
  it('reports the numbers', () => {
    const f = (n: number) => n.toFixed(2);
    for (const r of runs) console.log(`dot max ${f(r.dotMax)}m/frame (${f(r.dotMax * 30)}m/s) jumps>0.6m ${r.dotJumps} | ball max ${f(r.ballMax * 30)}m/s jumps>1.5m ${r.ballJumps} | ${Math.round(r.totalMs / 1000)}s | worst ${r.worst.what} @${Math.round(r.worst.t)}ms`);
  });
  it('no dot ever runs faster than a sprinter or teleports', () => {
    for (const r of runs) { expect(r.dotMax * 30).toBeLessThan(10); expect(r.dotJumps).toBe(0); }
  });
  it('the ball never teleports and never beats a hard shot', () => {
    for (const r of runs) { expect(r.ballMax * 30).toBeLessThan(40); expect(r.ballJumps).toBe(0); }
  });
  it('quiet play is calm: a minute of pure flow has the ball at passing pace and rarely changing its mind', () => {
    for (const seed of ['0', '1', '22', '3']) {
      const a = squad('a' + seed), b = squad('b' + seed);
      const result = simulateMatch(a, b, ['A', 'B'], 'm' + seed, { knockout: false });
      const layout = makeLayout([a, b], seed);
      // one far-away moment, so the first minute is nothing but ambient play
      const items = [{ at: 70_000, dur: 1000, event: { t: 0, type: 'kickoff', team: 0, text: '' } as MatchEvent }];
      let prev = buildScene({ layout, result, items, quiet: [], t: 1000 });
      let dist = 0, turns = 0, frames = 0, still = 0;
      let lastDir: [number, number] | null = null;
      for (let t = 1000 + FRAME; t <= 60_000; t += FRAME) {
        const sc = buildScene({ layout, result, items, quiet: [], t });
        const dx = sc.ball.x - prev.ball.x, dy = sc.ball.y - prev.ball.y;
        const step = Math.hypot(dx, dy);
        dist += step; frames++; if (step < 0.003) still++;
        if (lastDir && step > 0.02 && Math.hypot(...lastDir) > 0.02 && dx * lastDir[0] + dy * lastDir[1] < 0) turns++;
        if (step > 0.02) lastDir = [dx, dy];
        prev = sc;
      }
      const avg = (dist / frames) * 30;
      const seconds = frames / 30;
      expect(avg, `seed ${seed} average ball speed`).toBeGreaterThan(4);
      expect(avg, `seed ${seed} average ball speed`).toBeLessThan(13);
      expect(turns / seconds, `seed ${seed} reversals per second`).toBeLessThan(0.5);
      expect(still / frames, `seed ${seed} share of time the ball is still`).toBeLessThan(0.4);
    }
  });
  it('a match lasts long enough to follow (about a minute and a half), a shootout a little more', () => {
    for (const r of runs) { expect(r.totalMs).toBeGreaterThan(70_000); expect(r.totalMs).toBeLessThan(r.went === 'pens' ? 135_000 : 105_000); }
  });
  it('quick pace is clearly shorter and still covers the whole match', () => {
    const q = motion('1', 'quick'); const n = motion('1', 'normal');
    expect(q.totalMs).toBeLessThan(n.totalMs * 0.7);
    expect(q.totalMs).toBeGreaterThan(40_000);
    expect(q.dotJumps).toBe(0);
  });
});
