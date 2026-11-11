// Tournament logic: a single match, a league, groups then knockout, or straight knockout.
// Pure and seeded. The room engine drives it one MATCHDAY at a time: every fixture of a matchday is simulated up front,
// the humans watch only the fixtures they play in, and CPU-versus-CPU fixtures just resolve into a result.

import { Rng, hashSeed } from './rng';
import type { MatchResult } from './sim';

export type CompetitionKind = 'match' | 'league' | 'groups' | 'knockout';

export const COMPETITIONS: Record<CompetitionKind, { name: string; blurb: string; teamOptions: number[] }> = {
  match: { name: 'Single match', blurb: 'One game. Winner takes it, with extra time and penalties if needed.', teamOptions: [2] },
  league: { name: 'League', blurb: 'Everyone plays everyone. The table decides the champion.', teamOptions: [4, 6, 8, 10, 12] },
  groups: { name: 'Groups + knockout', blurb: 'Groups first, then the top two go through to the knockout rounds.', teamOptions: [8, 16] },
  knockout: { name: 'Knockout', blurb: 'One bad day and you are out. Extra time and penalties decide ties.', teamOptions: [4, 8, 16] },
};

export function validTeams(kind: CompetitionKind, n: number): boolean {
  return COMPETITIONS[kind].teamOptions.includes(n);
}

/** Smallest valid team count that fits all the humans. */
export function defaultTeams(kind: CompetitionKind, humans: number): number {
  const opts = COMPETITIONS[kind].teamOptions;
  return opts.find((n) => n >= humans) ?? opts[opts.length - 1]!;
}

export interface LiteResult {
  score: [number, number];
  pens: [number, number] | null;
  went: 'ft' | 'et' | 'pens';
  winner: 0 | 1 | null;
  goals: Array<{ t: number; p: string; team: 0 | 1; src?: string }>;
  headline: string;
  /** template key and variables behind `headline`, so it can be shown in another language */
  hk?: string;
  hv?: Record<string, string>;
}

export function litefy(r: MatchResult): LiteResult {
  return {
    score: [r.score[0], r.score[1]],
    pens: r.pens,
    went: r.went,
    winner: r.winner,
    headline: r.headline,
    hk: r.hk,
    hv: r.hv,
    goals: r.events.filter((e) => e.type === 'goal').map((e) => ({ t: e.t, p: e.p!, team: e.team, src: e.src })),
  };
}

export interface CompFixture {
  id: string;
  a: string;
  b: string;
  /** "Group B", "Matchday 3", "Quarter-final" ... */
  stage: string;
  knockout: boolean;
  /** human team ids playing in this fixture */
  humans: string[];
  lite: LiteResult | null;
  /** the full story, kept only for fixtures a human plays in, and only until every human in it has watched it */
  result: MatchResult | null;
  /** humans in this fixture who have not watched it yet. While it is not empty the fixture is SEALED: nobody else is sent its score. */
  unseen?: string[];
  /** set only in the copy sent to a viewer: this fixture has been played but its score is being kept from them */
  sealed?: boolean;
}

export interface Matchday {
  label: string;
  kind: 'league' | 'group' | 'ko';
  fixtures: CompFixture[];
}

export interface CompState {
  kind: CompetitionKind;
  /** every team id */
  teams: string[];
  groups: string[][] | null;
  days: Matchday[];
  day: number;
  champion: string | null;
  seed: string;
  /** keeper rating that stops the average share of shots in this competition; unset = the stars' level (sim.ts GK_PIVOT) */
  gkPivot?: number;
}

export interface TableRow {
  id: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

/* ───────────── schedules ───────────── */

/** Circle method. Returns rounds of pairs; an odd team count gives each team one bye (null opponent is skipped). */
export function circleRounds(ids: string[]): Array<Array<[string, string]>> {
  const list: Array<string | null> = ids.slice();
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]!;
      const b = list[n - 1 - i]!;
      if (a === null || b === null) continue;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    // rotate everything but the first
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

function mkFixture(id: string, a: string, b: string, stage: string, knockout: boolean, humans: Set<string>): CompFixture {
  return { id, a, b, stage, knockout, humans: [a, b].filter((x) => humans.has(x)), lite: null, result: null };
}

/** Spread humans across groups/halves first, then fill with CPU teams, all seeded. */
function spread(ids: string[], humans: Set<string>, buckets: number, rng: Rng): string[][] {
  const out: string[][] = Array.from({ length: buckets }, () => []);
  const hs = rng.shuffle(ids.filter((x) => humans.has(x)));
  const bs = rng.shuffle(ids.filter((x) => !humans.has(x)));
  const size = ids.length / buckets;
  hs.forEach((h, i) => out[i % buckets]!.push(h));
  for (const b of bs) {
    const target = out.map((g, i) => ({ i, n: g.length })).filter((x) => x.n < size).sort((x, y) => x.n - y.n || x.i - y.i)[0]!;
    out[target.i]!.push(b);
  }
  return out.map((g) => rng.shuffle(g));
}

const KO_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semi-final', 8: 'Quarter-final', 16: 'Round of 16', 32: 'Round of 32' };
export const koName = (teamsLeft: number): string => KO_NAMES[teamsLeft] ?? `Round of ${teamsLeft}`;

export function createCompetition(kind: CompetitionKind, teams: string[], humanIds: string[], seed: string, legs: 1 | 2 = 1): CompState {
  const humans = new Set(humanIds);
  const rng = new Rng(`${seed}/draw`);
  const c: CompState = { kind, teams: teams.slice(), groups: null, days: [], day: 0, champion: null, seed };

  if (kind === 'match') {
    c.days.push({ label: 'Match', kind: 'ko', fixtures: [mkFixture('m1', teams[0]!, teams[1]!, 'Match', true, humans)] });
  } else if (kind === 'league') {
    const order = rng.shuffle(teams);
    const rounds = circleRounds(order);
    const all = legs === 2 ? [...rounds, ...rounds.map((r) => r.map(([a, b]) => [b, a] as [string, string]))] : rounds;
    all.forEach((pairs, i) => {
      c.days.push({
        label: `Matchday ${i + 1}`,
        kind: 'league',
        fixtures: pairs.map(([a, b], j) => mkFixture(`l${i + 1}-${j + 1}`, a, b, `Matchday ${i + 1}`, false, humans)),
      });
    });
  } else if (kind === 'groups') {
    const groupCount = teams.length / 4;
    c.groups = spread(teams, humans, groupCount, rng);
    const perGroup = c.groups.map((g) => circleRounds(g));
    for (let r = 0; r < 3; r++) {
      const fixtures: CompFixture[] = [];
      perGroup.forEach((rounds, gi) => {
        for (const [j, [a, b]] of rounds[r]!.entries()) {
          fixtures.push(mkFixture(`g${gi + 1}-${r + 1}-${j + 1}`, a, b, `Group ${String.fromCharCode(65 + gi)}`, false, humans));
        }
      });
      c.days.push({ label: `Group stage, matchday ${r + 1}`, kind: 'group', fixtures });
    }
  } else {
    // knockout: humans on opposite halves so they can only meet late
    const halves = spread(teams, humans, 2, rng);
    const order = [...halves[0]!, ...halves[1]!];
    const name = koName(order.length);
    const fixtures: CompFixture[] = [];
    for (let i = 0; i < order.length; i += 2) fixtures.push(mkFixture(`k${order.length}-${i / 2 + 1}`, order[i]!, order[i + 1]!, name, true, humans));
    c.days.push({ label: name, kind: 'ko', fixtures });
  }
  return c;
}

export const currentDay = (c: CompState): Matchday => c.days[c.day]!;
export const totalKnownDays = (c: CompState): number => c.days.length;

/* ───────────── tables ───────────── */

export function tableFor(fixtures: CompFixture[], ids: string[], seed = ''): TableRow[] {
  const rows = new Map<string, TableRow>(ids.map((id) => [id, { id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const f of fixtures) {
    if (!f.lite) continue;
    const a = rows.get(f.a);
    const b = rows.get(f.b);
    if (!a || !b) continue;
    const [ga, gb] = f.lite.score;
    a.played++; b.played++;
    a.gf += ga; a.ga += gb; b.gf += gb; b.ga += ga;
    // a knockout-style shootout in a league table never happens (draws are allowed), but count it as a draw if it does
    if (f.lite.winner === 0 && !f.lite.pens) { a.w++; b.l++; a.pts += 3; }
    else if (f.lite.winner === 1 && !f.lite.pens) { b.w++; a.l++; b.pts += 3; }
    else { a.d++; b.d++; a.pts++; b.pts++; }
  }
  return [...rows.values()].sort(
    (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || hashSeed(seed + x.id) - hashSeed(seed + y.id),
  );
}

/** League table, or one table per group. */
export function tables(c: CompState): Array<{ name: string; rows: TableRow[] }> {
  const played = (kind: Matchday['kind']) => c.days.filter((d) => d.kind === kind).flatMap((d) => d.fixtures);
  if (c.kind === 'league') return [{ name: 'League table', rows: tableFor(played('league'), c.teams, c.seed) }];
  if (c.kind === 'groups' && c.groups) {
    const fx = played('group');
    return c.groups.map((g, i) => ({
      name: `Group ${String.fromCharCode(65 + i)}`,
      rows: tableFor(fx.filter((f) => g.includes(f.a)), g, c.seed),
    }));
  }
  return [];
}

export function winnerOf(f: CompFixture): string | null {
  if (!f.lite || f.lite.winner === null) return null;
  return f.lite.winner === 0 ? f.a : f.b;
}

/* ───────────── progression ───────────── */

function koRound(c: CompState, pairs: Array<[string, string]>, humans: Set<string>): Matchday {
  const n = pairs.length * 2;
  const name = koName(n);
  return {
    label: name,
    kind: 'ko',
    fixtures: pairs.map(([a, b], i) => mkFixture(`k${n}-${i + 1}`, a, b, name, true, humans)),
  };
}

/**
 * Every fixture of the current matchday has a result. Move on: next matchday, next knockout round, or crown a champion.
 * Full results are dropped here (only the compact form is kept for history).
 */
export function completeDay(c: CompState, humanIds: string[]): void {
  const humans = new Set(humanIds);
  const today = c.days[c.day]!;
  const kept = today.fixtures.map((f) => f.result);
  // a story somebody has yet to watch is kept until they have (the room drops it then, or when the next matchday is played)
  for (const f of today.fixtures) if (!f.unseen?.length) f.result = null;
  const keepResults = () => today.fixtures.forEach((f, i) => { f.result = kept[i] ?? null; }); // the final's story stays for "watch again"

  if (c.kind === 'match') {
    c.champion = winnerOf(today.fixtures[0]!);
    keepResults();
    return;
  }
  if (c.kind === 'league') {
    if (c.day + 1 < c.days.length) { c.day++; return; }
    // a dead heat on points, goal difference and goals is settled by the seeded tiebreak, so there is always one champion
    c.champion = tables(c)[0]!.rows[0]?.id ?? null;
    keepResults();
    return;
  }
  // groups and knockout
  if (today.kind === 'group' && c.day + 1 < c.days.length) { c.day++; return; }
  let next: Matchday | null = null;
  if (today.kind === 'group') {
    const qualifiers = tables(c).map((t) => [t.rows[0]!.id, t.rows[1]!.id] as const);
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < qualifiers.length; i += 2) {
      const g1 = qualifiers[i]!;
      const g2 = qualifiers[i + 1]!;
      pairs.push([g1[0], g2[1]], [g2[0], g1[1]]);
    }
    next = koRound(c, pairs, humans);
  } else {
    const winners = today.fixtures.map((f) => winnerOf(f)!);
    if (winners.length === 1) { c.champion = winners[0]!; keepResults(); return; }
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i]!, winners[i + 1]!]);
    next = koRound(c, pairs, humans);
  }
  c.days.push(next);
  c.day++;
}

/** Is this team still in it (for knockout-type competitions)? Leagues and group stages: always yes. */
export function isAlive(c: CompState, id: string): boolean {
  if (c.champion) return false;
  const today = c.days[c.day];
  if (!today) return false;
  if (today.kind !== 'ko') return true;
  return today.fixtures.some((f) => f.a === id || f.b === id);
}

/** Days still to come that are already known (for "matchday 3 of 7"). Knockout rounds are known by team count. */
export function roundsInfo(c: CompState): { index: number; total: number | null } {
  if (c.kind === 'league') return { index: c.day + 1, total: c.days.length };
  if (c.kind === 'match') return { index: 1, total: 1 };
  const koRounds = Math.log2(c.kind === 'knockout' ? c.teams.length : c.teams.length / 2);
  const groupDays = c.kind === 'groups' ? 3 : 0;
  return { index: c.day + 1, total: groupDays + koRounds };
}
