import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, botNames, buildBotSquad } from '../src/shared/bots';
import {
  COMPETITIONS, circleRounds, completeDay, createCompetition, currentDay, defaultTeams, tableFor, tables, validTeams, winnerOf,
  type CompFixture, type CompState,
} from '../src/shared/competition';
import { poolPlayers } from '../src/shared/players';
import { isSquadComplete, profile } from '../src/shared/squad';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/** give every fixture of the current day a result: team `a` wins unless told otherwise */
function playDay(c: CompState, winnerOfFx: (f: CompFixture) => 0 | 1 | null = () => 0) {
  for (const f of currentDay(c).fixtures) {
    const w = winnerOfFx(f);
    f.lite = { score: w === 0 ? [2, 1] : w === 1 ? [1, 2] : [1, 1], pens: null, went: 'ft', winner: w, goals: [], headline: '' };
  }
}

describe('schedules', () => {
  it('circle method: everyone plays everyone exactly once, nobody twice in a round', () => {
    for (const n of [3, 4, 5, 6, 8, 12]) {
      const rounds = circleRounds(ids(n));
      const seen = new Set<string>();
      for (const r of rounds) {
        const inRound = new Set<string>();
        for (const [a, b] of r) {
          expect(inRound.has(a) || inRound.has(b)).toBe(false);
          inRound.add(a); inRound.add(b);
          const key = [a, b].sort().join('-');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe((n * (n - 1)) / 2);
    }
  });

  it('a league of 6 has 5 matchdays; a double league has 10 with reversed fixtures', () => {
    const one = createCompetition('league', ids(6), ['t1'], 's');
    expect(one.days).toHaveLength(5);
    const two = createCompetition('league', ids(6), ['t1'], 's', 2);
    expect(two.days).toHaveLength(10);
    const first = two.days[0]!.fixtures[0]!;
    const back = two.days[5]!.fixtures.find((f) => f.a === first.b && f.b === first.a);
    expect(back).toBeTruthy();
  });

  it('team count options are validated', () => {
    expect(validTeams('knockout', 8)).toBe(true);
    expect(validTeams('knockout', 6)).toBe(false);
    expect(validTeams('groups', 8)).toBe(true);
    expect(validTeams('match', 2)).toBe(true);
    expect(defaultTeams('knockout', 3)).toBe(4);
    expect(defaultTeams('groups', 3)).toBe(8);
    for (const k of Object.keys(COMPETITIONS) as Array<keyof typeof COMPETITIONS>) expect(COMPETITIONS[k].teamOptions.length).toBeGreaterThan(0);
  });
});

describe('league table', () => {
  it('3 points a win, goal difference then goals for, and the champion is the top row', () => {
    const c = createCompetition('league', ids(4), ['t1'], 'lg');
    // team ids are shuffled in the draw, so make results depend on the fixture, not the id
    while (!c.champion) {
      playDay(c, () => 0);
      completeDay(c, ['t1']);
    }
    const rows = tables(c)[0]!.rows;
    expect(rows).toHaveLength(4);
    expect(rows.reduce((a, r) => a + r.played, 0)).toBe(12);
    expect(rows.reduce((a, r) => a + r.pts, 0)).toBe(18); // 6 games, all decisive, 3 points each
    expect(c.champion).toBe(rows[0]!.id);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.pts).toBeGreaterThanOrEqual(rows[i]!.pts);
  });
  it('draws give a point each', () => {
    const c = createCompetition('league', ids(4), ['t1'], 'dr');
    playDay(c, () => null);
    const rows = tableFor(currentDay(c).fixtures, ids(4), 'dr');
    expect(rows.reduce((a, r) => a + r.pts, 0)).toBe(4);
  });
});

describe('groups then knockout', () => {
  it('8 teams: two groups of four play 3 matchdays, then semi-finals and a final', () => {
    const humans = ['t1', 't2'];
    const c = createCompetition('groups', ids(8), humans, 'gk');
    expect(c.groups).toHaveLength(2);
    expect(c.groups!.every((g) => g.length === 4)).toBe(true);
    // the two humans start in different groups
    expect(c.groups!.some((g) => g.includes('t1') && g.includes('t2'))).toBe(false);
    expect(c.days).toHaveLength(3);
    expect(c.days[0]!.fixtures).toHaveLength(4); // 2 per group
    const stages: string[] = [];
    while (!c.champion) {
      stages.push(currentDay(c).label);
      playDay(c, (f) => (f.knockout ? 0 : 0));
      completeDay(c, humans);
    }
    expect(stages).toEqual(['Group stage, matchday 1', 'Group stage, matchday 2', 'Group stage, matchday 3', 'Semi-final', 'Final']);
    const sf = c.days[3]!.fixtures;
    expect(sf).toHaveLength(2);
    // cross over: winner of one group never meets the winner of the same group
    const g = (id: string) => c.groups!.findIndex((x) => x.includes(id));
    for (const f of sf) expect(g(f.a)).not.toBe(g(f.b));
    expect(winnerOf(c.days[4]!.fixtures[0]!)).toBe(c.champion);
  });

  it('16 teams: four groups, quarter-finals, semi-finals, final', () => {
    const c = createCompetition('groups', ids(16), ['t1'], 'g16');
    expect(c.groups).toHaveLength(4);
    const labels: string[] = [];
    while (!c.champion) {
      labels.push(currentDay(c).label);
      playDay(c);
      completeDay(c, ['t1']);
    }
    expect(labels.slice(3)).toEqual(['Quarter-final', 'Semi-final', 'Final']);
  });
});

describe('knockout', () => {
  it('16 teams need four rounds and humans start on opposite halves', () => {
    const humans = ['t1', 't2'];
    const c = createCompetition('knockout', ids(16), humans, 'ko');
    const first = currentDay(c).fixtures;
    expect(first).toHaveLength(8);
    expect(first.some((f) => f.a === 't1' && f.b === 't2')).toBe(false);
    const half = (id: string) => Math.floor(first.findIndex((f) => f.a === id || f.b === id) / 4);
    expect(half('t1')).not.toBe(half('t2'));
    const names: string[] = [];
    while (!c.champion) {
      names.push(currentDay(c).label);
      playDay(c);
      completeDay(c, humans);
    }
    expect(names).toEqual(['Round of 16', 'Quarter-final', 'Semi-final', 'Final']);
  });
  it('flags which fixtures involve a human', () => {
    const c = createCompetition('knockout', ids(8), ['t3'], 'h');
    const withHuman = currentDay(c).fixtures.filter((f) => f.humans.length);
    expect(withHuman).toHaveLength(1);
    expect(withHuman[0]!.humans).toEqual(['t3']);
  });
});

describe('CPU squads', () => {
  it('15 CPU teams in one pool get complete, different squads with no player used twice', () => {
    for (const pool of ['modern', 'legends', 'all'] as const) {
      const taken = new Set<string>(poolPlayers(pool).slice(0, 22).map((p) => p.id)); // pretend two humans drafted already
      const seen = new Set<string>(taken);
      for (let i = 0; i < 15; i++) {
        const sq = buildBotSquad('seed', pool, 'normal', taken, `cpu${i}`);
        expect(isSquadComplete(sq)).toBe(true);
        for (const id of Object.values(sq.slots)) {
          expect(seen.has(id!), `${pool}: ${id} used twice`).toBe(false);
          seen.add(id!);
        }
      }
    }
  });
  it('harder CPUs build better squads on average', () => {
    const avg = (level: 'easy' | 'normal' | 'hard') => {
      let t = 0;
      for (let i = 0; i < 40; i++) t += profile(buildBotSquad('lvl' + i, 'modern', level, new Set(), 'x')).overall;
      return t / 40;
    };
    const [e, n, h] = [avg('easy'), avg('normal'), avg('hard')];
    expect(h).toBeGreaterThan(n);
    expect(n).toBeGreaterThan(e);
    expect(Object.keys(BOT_LEVELS)).toEqual(['easy', 'normal', 'hard']);
  });
  it('gives distinct names', () => {
    const names = botNames('x', 15);
    expect(new Set(names).size).toBe(15);
  });
});
