import { describe, expect, it } from 'vitest';
import { buildBotSquad, type BotLevel } from '../src/shared/bots';
import { GK_PIVOT_ABOVE_MEAN, type IndexedWorld } from '../src/shared/career/world';
import { bestSquad, clubStyle, createCareer, joinCareer } from '../src/shared/career/engine';
import { MATCHUP_EDGE, matchupMods, simulateMatch } from '../src/shared/sim';
import { OVERALL_W, STYLES, STYLE_BEATS, STYLE_IDS, STYLE_MOD, matchup, profile, styleMod, type Squad, type StyleId } from '../src/shared/squad';
import { makeWorld } from './career-world';

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
const squads = (n: number, tag: string): Squad[] => Array.from({ length: n }, (_, i) => buildBotSquad(`${tag}/${i}`, 'all', LEVELS[i % 3]!, new Set(), `k${i}`));
const pts = (s: [number, number]) => (s[0] > s[1] ? 3 : s[0] === s[1] ? 1 : 0);

describe('tactics are zero-sum: they move strength between sectors, they never add any', () => {
  const change = (m: { att: number; mid: number; def: number; gk: number }) => OVERALL_W.att * m.att + OVERALL_W.mid * m.mid + OVERALL_W.def * m.def + OVERALL_W.gk * m.gk;
  it('every style changes `overall` by at most 0.15 (it used to add 0.3 to 0.95 for free)', () => {
    for (const id of STYLE_IDS) for (const wide of [0, 2]) expect(Math.abs(change(styleMod(id, wide))), `${id} with ${wide} wide`).toBeLessThanOrEqual(0.15);
  });
  it('and so it does on real squads: picking a style leaves the headline overall within 0.25 of the squad itself', () => {
    for (const sq of squads(24, 'zs')) {
      const b = profile(sq).base;
      const plain = OVERALL_W.att * b.att + OVERALL_W.mid * b.mid + OVERALL_W.def * b.def + OVERALL_W.gk * b.gk;
      for (const style of STYLE_IDS) expect(Math.abs(profile({ ...sq, style }).overall - plain)).toBeLessThanOrEqual(0.25);
    }
  });
  it('the text on the Tactics screen says what the numbers do (so the two cannot drift apart)', () => {
    const word: Record<string, 'att' | 'mid' | 'def' | 'gk'> = { attack: 'att', midfield: 'mid', defence: 'def', keeper: 'gk' };
    const read = (text: string) => {
      const out = { att: 0, mid: 0, def: 0, gk: 0 };
      for (const m of text.matchAll(/([+-]\d+(?:\.\d+)?) (attack|midfield|defence|keeper)/g)) out[word[m[2]!]!] = Number(m[1]);
      return out;
    };
    for (const id of STYLE_IDS) {
      const main = STYLES[id].tradeoff.split('(else')[0]!;
      const m = STYLE_MOD[id];
      expect(read(main), id).toEqual({ att: m.att, mid: m.mid, def: m.def, gk: m.gk });
    }
    const narrow = STYLES.wings.tradeoff.split('(else')[1]!;
    const n = styleMod('wings', 0);
    expect([n.att, n.def]).toEqual([1, -1]);
    expect(narrow).toContain('+1 and -1');
  });
});

describe('rock, paper, scissors', () => {
  it('four tactics form a cycle (each beats exactly one and loses to exactly one) and Wide Attack is neutral', () => {
    for (const id of ['press', 'possession', 'fortress', 'counter'] as StyleId[]) {
      expect(STYLE_IDS.filter((o) => matchup(id, o) === 1), `${id} beats`).toHaveLength(1);
      expect(STYLE_IDS.filter((o) => matchup(id, o) === -1), `${id} loses to`).toHaveLength(1);
    }
    expect(STYLE_IDS.filter((o) => matchup('wings', o) !== 0)).toEqual([]);
    expect(STYLE_BEATS).toEqual({ press: 'possession', possession: 'fortress', fortress: 'counter', counter: 'press', wings: null });
    for (const a of STYLE_IDS) for (const b of STYLE_IDS) expect(matchup(a, b) + matchup(b, a)).toBe(0);
  });
  it('what one team gains where the styles meet, the other gives up: zero-sum between the two teams', () => {
    for (const a of STYLE_IDS) for (const b of STYLE_IDS) {
      const x = matchupMods(a, b), y = matchupMods(b, a);
      const sum = (m: { att: number; mid: number; def: number }) => m.att + m.mid + m.def;
      expect(sum(x) + sum(y), `${a} v ${b}`).toBeCloseTo(0, 9);
      expect(Math.abs(sum(x))).toBeCloseTo(matchup(a, b) === 0 ? 0 : MATCHUP_EDGE, 9);
    }
  });
  it('it is real in the match: on the same two squads the winning tactic takes clearly more points than the losing one', () => {
    const pop = squads(40, 'rps');
    for (const [a, b] of [['press', 'possession'], ['possession', 'fortress'], ['fortress', 'counter'], ['counter', 'press']] as Array<[StyleId, StyleId]>) {
      let diff = 0, n = 0;
      for (let i = 0; i + 1 < 20; i += 2) for (let m = 0; m < 250; m++) {
        // both squads play both tactics, home and away of the pairing, so squad quality cancels and only the tactic is left
        const r1 = simulateMatch({ ...pop[i]!, style: a }, { ...pop[i + 1]!, style: b }, ['A', 'B'], `rps/${i}/${m}`, { knockout: false }).score;
        diff += pts(r1) - pts([r1[1], r1[0]]);
        const r2 = simulateMatch({ ...pop[i]!, style: b }, { ...pop[i + 1]!, style: a }, ['A', 'B'], `rps2/${i}/${m}`, { knockout: false }).score;
        diff += pts([r2[1], r2[0]]) - pts(r2);
        n += 2;
      }
      expect(diff / n, `${a} should beat ${b}`).toBeGreaterThan(0.08);
    }
  });
});

describe('what a tactic claims, the match delivers', () => {
  it('Fortress\'s keeper bonus reaches the match (it used to be shown and ignored)', () => {
    const pop = squads(40, 'fk');
    const goalsAgainst = (bonus: number): number => {
      const keep = STYLE_MOD.fortress.gk;
      STYLE_MOD.fortress.gk = bonus;
      try {
        let g = 0;
        for (let i = 0; i + 1 < pop.length; i += 2) for (let m = 0; m < 40; m++) g += simulateMatch({ ...pop[i]!, style: 'fortress' }, { ...pop[i + 1]!, style: 'wings' }, ['A', 'B'], `fk/${i}/${m}`, { knockout: false }).score[1];
        return g;
      } finally { STYLE_MOD.fortress.gk = keep; }
    };
    expect(goalsAgainst(12)).toBeLessThan(goalsAgainst(0));
  });
  it('the computer no longer picks the tactic with the highest overall: a hard CPU uses all five', () => {
    const picks = Array.from({ length: 90 }, (_, i) => buildBotSquad(`pick/${i}`, 'all', 'hard', new Set(), `k${i}`).style);
    const count = (s: StyleId) => picks.filter((x) => x === s).length;
    for (const s of STYLE_IDS) expect(count(s), s).toBeGreaterThan(5);
    expect(Math.max(...STYLE_IDS.map(count))).toBeLessThan(45);
  });
});

describe('career clubs and the tactic', () => {
  const W: IndexedWorld = makeWorld();
  it('a computer-run club keeps one tactic all season, clubs differ, and the tactic changes with the season', () => {
    const st = createCareer(W, 'ABCD', 'seed', 1_700_000_000_000);
    const clubs = Object.values(st.clubs);
    const first = clubs.map((c) => clubStyle(st, c));
    expect(clubs.map((c) => clubStyle(st, c))).toEqual(first);
    expect(new Set(first).size).toBeGreaterThanOrEqual(4);
    st.season = 2;
    expect(clubs.map((c) => clubStyle(st, c))).not.toEqual(first);
  });
  it('a manager keeps the tactic they chose, and Best eleven keeps it too', () => {
    const st = createCareer(W, 'ABCD', 'seed', 1_700_000_000_000);
    expect(joinCareer(W, st, { memberId: 'm0-xxxxxxxx', name: 'Sam', choice: { kind: 'real', id: 't00' } }).ok).toBe(true);
    const mine = st.clubs['t00']!;
    mine.style = 'counter';
    expect(clubStyle(st, mine)).toBe('counter');
    expect(bestSquad(mine.roster.length ? mine.roster : (W.byClub.get('t00') ?? []).map((p) => p.id), 'fortress').style).toBe('fortress');
  });
  it('the keeper curve of a career league is centred on its own keepers (so goals per match do not jump by a third)', () => {
    const keepers = W.players.filter((p) => p.pos === 'GK').map((p) => p.ovr);
    const mean = keepers.reduce((a, b) => a + b, 0) / keepers.length;
    expect(W.gkPivot).toBeCloseTo(mean + GK_PIVOT_ABOVE_MEAN, 1);
  });
});
