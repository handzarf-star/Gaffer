// The balance harness: `npm run check:balance`. It plays the real match engine thousands of times with FIXED seeds, so two runs on
// the same code print the same numbers, and tells you whether the levers the game advertises are the levers that matter.
//
//   [1] sector sensitivity   points per match gained from +5 rating on every player in one sector (attack, midfield, defence, keeper)
//   [2] tactical styles      5x5 matrix (squads mirrored so quality cancels): row averages, best reply per column, dominant styles
//   [3] formations           synthetic equal-rated squads / the same drafted squads re-seated / squads drafted for the formation,
//                            and how much of any gap is sector maths (A) versus fit geometry and draft pool (B)
//   [4] career league        real-data career seasons: goals per match, and the keeper's worth. The career pool rates 64 where the draft game's
//                            stars rate 87, so a curve that is right for one can be badly wrong for the other.
//
// Every gate prints PASS or FAIL; the process exits 1 if any fail (use --report to always exit 0). --quick uses a quarter of the
// matches for iterating: noisier, so only the full run counts. "ppm" = league points per match (win 3, draw 1, loss 0).
//
//   npm run check:balance            full run (about two minutes)
//   npm run check:balance -- --quick
//   npm run check:balance -- --only=styles   (sectors | styles | formations | career)

import { buildBotSquad, type BotLevel } from '../src/shared/bots';
import { autoLineup, createCareer, joinCareer, setReady, startCareer, tick } from '../src/shared/career/engine';
import { getWorld } from '../src/shared/career/data';
import { FORMATIONS, FORMATION_IDS, ROLE_TO_POS, penalty, type FormationId, type Role } from '../src/shared/formations';
import { PLAYERS, player, withRatings } from '../src/shared/players';
import { Rng } from '../src/shared/rng';
import { simulateMatch } from '../src/shared/sim';
import { OVERALL_W, STYLE_IDS, changeFormation, profile, type Squad, type StyleId } from '../src/shared/squad';

const QUICK = process.argv.includes('--quick');
const REPORT = process.argv.includes('--report');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'all';
const want = (k: string) => ONLY === 'all' || ONLY === k;
const scale = (n: number) => Math.max(2, Math.round(QUICK ? n / 4 : n));

/* ───────────── what "balanced" means (the gates) ───────────── */

const GATE = {
  /** +5 rating on the keeper should be worth about its 15% share of what +5 on everyone is worth */
  gkPlus5: [0.09, 0.12] as const,
  /** every style's average points per match against the five styles, within this of the mean of all styles */
  styleRowTol: 0.03,
  /** every formation's average against the six formations, within this of the mean of all formations */
  formationTol: 0.03,
  /** goals per match in any formation: a 5-back must not become a 0-0 machine, and nothing should become a goal-fest */
  goals: [2.4, 3.2] as const,
  /** goals per match in a career league on the real data (2.60 before Sprint 2; real leagues are 2.5 to 2.9) */
  careerGoals: [2.4, 2.9] as const,
};

/* ───────────── plumbing ───────────── */

const pts = (s: [number, number]) => (s[0] > s[1] ? 3 : s[0] === s[1] ? 1 : 0);
const play = (a: Squad, b: Squad, seed: string) => simulateMatch(a, b, ['A', 'B'], seed, { knockout: false });
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: readonly number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const f3 = (x: number) => x.toFixed(3);
const sgn = (x: number) => `${x >= 0 ? '+' : '-'}${Math.abs(x).toFixed(3)}`;
const pad = (s: string, n: number) => s.padEnd(n);
const rpad = (s: string, n: number) => s.padStart(n);

const gates: Array<{ name: string; target: string; got: string; pass: boolean }> = [];
const gate = (name: string, target: string, got: string, pass: boolean) => gates.push({ name, target, got, pass });

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
const base = (sq: Squad) => { const b = profile(sq).base; return OVERALL_W.att * b.att + OVERALL_W.mid * b.mid + OVERALL_W.def * b.def + OVERALL_W.gk * b.gk; };
const withStyle = (sq: Squad, style: StyleId): Squad => ({ ...sq, style });

/** 90 drafted squads (CPU drafts from the whole pool, the same way a game builds them), and 45 near-equal pairs of them. */
const population = Array.from({ length: 90 }, (_, i) => buildBotSquad(`bal/${i}`, 'all', LEVELS[i % 3]!, new Set(), `k${i}`));
const pairs: Array<[number, number]> = [];
{
  const rng = new Rng('bal-pairs');
  for (let tries = 0; pairs.length < 45 && tries < 20_000; tries++) {
    const i = rng.int(population.length), j = rng.int(population.length);
    if (i !== j && Math.abs(base(population[i]!) - base(population[j]!)) < 2.5) pairs.push([i, j]);
  }
}

const t0 = Date.now();
let matches = 0;
let careerGk = { d: 0, se: 0 };

/* ───────────── [1] sector sensitivity ───────────── */

const SECTORS: Record<'ATT' | 'MID' | 'DEF' | 'GK', Role[]> = {
  ATT: ['LW', 'RW', 'ST'],
  MID: ['CDM', 'CM', 'CAM', 'LM', 'RM'],
  DEF: ['CB', 'LB', 'RB', 'LWB', 'RWB'],
  GK: ['GK'],
};

if (want('sectors')) {
  const M = scale(200);
  const idsOf = (sq: Squad, roles: Role[]) => FORMATIONS[sq.formation].slots.filter((s) => roles.includes(s.role)).map((s) => sq.slots[s.id]).filter((x): x is string => !!x);
  const run = (roles: Role[] | null, by: number): { p: number[]; g: number[] } => {
    const p: number[] = [], g: number[] = [];
    for (const [i, j] of pairs) {
      const A = withStyle(population[i]!, 'possession'), B = withStyle(population[j]!, 'possession');
      const ov = roles ? Object.fromEntries(idsOf(A, roles).map((id) => [id, player(id).ovr + by])) : {};
      for (let m = 0; m < M; m++) {
        const r = withRatings(ov, () => play(A, B, `sec/${i}/${j}/${m}`));
        matches++; p.push(pts(r.score)); g.push(r.score[0] + r.score[1]);
      }
    }
    return { p, g };
  };
  const baseline = run(null, 0);
  const delta = (v: { p: number[] }) => { const d = v.p.map((x, k) => x - baseline.p[k]!); return { d: mean(d), se: sd(d) / Math.sqrt(d.length) }; };
  console.log(`[1] SECTOR SENSITIVITY  ${pairs.length} near-equal pairs x ${M} matches, both sides on Possession. Baseline ${f3(mean(baseline.p))} ppm, ${mean(baseline.g).toFixed(2)} goals a match.`);
  console.log('    +5 rating on every player in ONE sector of team A (same random seeds as the baseline); "share" = of what +5 on everyone gives');
  const res: Record<string, { d: number; se: number }> = {};
  for (const k of ['ATT', 'MID', 'DEF', 'GK'] as const) res[k] = delta(run(SECTORS[k], 5));
  const all = delta(run(Object.values(SECTORS).flat(), 5));
  const sum = res.ATT!.d + res.MID!.d + res.DEF!.d + res.GK!.d;
  const w = { ATT: OVERALL_W.att, MID: OVERALL_W.mid, DEF: OVERALL_W.def, GK: OVERALL_W.gk };
  for (const k of ['ATT', 'MID', 'DEF', 'GK'] as const) {
    console.log(`    +5 ${pad(k, 4)} ${sgn(res[k]!.d)} ppm  (±${res[k]!.se.toFixed(3)})   share ${rpad((100 * res[k]!.d / sum).toFixed(0), 3)}%   overall weight ${rpad((100 * w[k]).toFixed(0), 3)}%`);
  }
  console.log(`    +5 ALL  ${sgn(all.d)} ppm  (±${all.se.toFixed(3)})   (sum of the four: ${sgn(sum)})`);
  gate('keeper: +5 GK', `${GATE.gkPlus5[0]}..${GATE.gkPlus5[1]} ppm`, sgn(res.GK!.d), res.GK!.d >= GATE.gkPlus5[0] && res.GK!.d <= GATE.gkPlus5[1]);
  console.log('');
}

/* ───────────── [2] the 5x5 style matrix ───────────── */

if (want('styles')) {
  const P = 40, M = scale(50);
  const S = STYLE_IDS;
  const cell: number[][] = S.map(() => S.map(() => 0));
  const goals: number[] = [];
  S.forEach((s1, a) => S.forEach((s2, b) => {
    const v: number[] = [];
    for (const [i, j] of pairs.slice(0, P)) for (let m = 0; m < M; m++) {
      // mirrored: style s1 on squad i against s2 on squad j, and s1 on squad j against s2 on squad i, so squad quality cancels
      const r1 = play(withStyle(population[i]!, s1), withStyle(population[j]!, s2), `mx/${i}/${j}/${m}`);
      const r2 = play(withStyle(population[j]!, s1), withStyle(population[i]!, s2), `my/${i}/${j}/${m}`);
      matches += 2; v.push(pts(r1.score), pts(r2.score)); goals.push(r1.score[0] + r1.score[1], r2.score[0] + r2.score[1]);
    }
    cell[a]![b] = mean(v);
  }));
  // two ways to average a row: against all five styles (what a player meets if they pick blind), and against the other four
  // (a mirror match is mostly a draw-rate effect, so it says little about strength). The gate needs both inside the tolerance.
  const rowAll = S.map((_, a) => mean(cell[a]!));
  const rowOther = S.map((_, a) => mean(cell[a]!.filter((_, b) => b !== a)));
  const Gall = mean(rowAll), Gother = mean(rowOther);
  console.log(`[2] TACTICAL STYLES  ${P} pairs x ${M} matches, mirrored (${P * M * 2} per cell), ${mean(goals).toFixed(2)} goals a match. Cell = ppm of the ROW style against the COLUMN style.`);
  console.log(`    ${pad('', 11)}${S.map((s) => rpad(s.slice(0, 7), 8)).join('')}  | ${rpad('avg v 5', 8)} ${rpad('vs mean', 8)} | ${rpad('avg v 4', 8)} ${rpad('vs mean', 8)}`);
  S.forEach((s1, a) => {
    const bad = Math.abs(rowAll[a]! - Gall) > GATE.styleRowTol || Math.abs(rowOther[a]! - Gother) > GATE.styleRowTol;
    console.log(`    ${pad(s1, 11)}${S.map((_, b) => rpad(f3(cell[a]![b]!), 8)).join('')}  | ${rpad(f3(rowAll[a]!), 8)} ${rpad(sgn(rowAll[a]! - Gall), 8)} | ${rpad(f3(rowOther[a]!), 8)} ${rpad(sgn(rowOther[a]! - Gother), 8)}${bad ? '  <-- outside ±' + GATE.styleRowTol : ''}`);
  });
  // best choice against each opponent style, counting the mirror (picking the same style) as one of the choices
  const best = S.map((_, b) => { let k = 0; S.forEach((__, a) => { if (cell[a]![b]! > cell[k]![b]!) k = a; }); return k; });
  console.log(`    best choice ${S.map((_, b) => rpad(S[best[b]!]!.slice(0, 7), 8)).join('')}   (column maxima: ${best.map((k, b) => f3(cell[k]![b]!)).join(' ')})`);
  const dominant = S.filter((_, a) => best.every((k) => k === a));
  const neverBest = S.filter((_, a) => !best.includes(a));
  console.log(`    dominant style (best choice against all five): ${dominant.length ? dominant.join(', ') : 'none'}    never the best choice: ${neverBest.length ? neverBest.join(', ') : 'none'}`);
  const spread = Math.max(...rowAll.map((x) => Math.abs(x - Gall)), ...rowOther.map((x) => Math.abs(x - Gother)));
  gate('styles: every row within the mean', `±${GATE.styleRowTol} ppm`, `worst ${f3(spread)}`, spread <= GATE.styleRowTol);
  gate('styles: no dominant style', 'none', dominant.length ? dominant.join(', ') : 'none', dominant.length === 0);
  console.log('');
}

/* ───────────── [3] formations ───────────── */

if (want('formations')) {
  const IDS = FORMATION_IDS;
  const name = (f: FormationId) => FORMATIONS[f].name;
  const back = (f: FormationId) => (f === '352' || f === '343' ? '3-back' : f === '532' ? '5-back' : '4-back');
  const R = 80;
  type Syn = { sq: Squad; ov: Record<string, number> };

  /** A squad of natural-position players (one nation each, so no chemistry). With `penalised` false every one is EXACTLY R effective in his
   *  slot, so the maths alone is on trial; with it true the fit table applies as it does in a game (the card dealt for LM is a winger). */
  const synthetic = (f: FormationId, penalised: boolean, used: Set<string>): Syn => {
    const slots: Record<string, string | null> = {};
    const ov: Record<string, number> = {};
    const nats = new Set<string>();
    for (const sl of FORMATIONS[f].slots) {
      const p = PLAYERS.find((x) => x.pos === ROLE_TO_POS[sl.role] && !used.has(x.id) && !nats.has(x.nat));
      if (!p) throw new Error(`no player left for ${sl.role}`);
      used.add(p.id); nats.add(p.nat);
      slots[sl.id] = p.id;
      ov[p.id] = penalised ? R : R + penalty(p.pos, sl.role);
    }
    return { sq: { formation: f, slots, style: 'possession' }, ov };
  };
  const roundRobin = (teams: Record<FormationId, Syn>, tag: string, M: number) => {
    const rows = IDS.map(() => 0);
    const goals = IDS.map(() => [] as number[]);
    IDS.forEach((f, a) => {
      const per: number[] = [];
      IDS.forEach((g, b) => {
        if (a === b) return;
        const v: number[] = [];
        const ov = { ...teams[f].ov, ...teams[g].ov };
        for (let m = 0; m < M; m++) {
          const r1 = withRatings(ov, () => play(teams[f].sq, teams[g].sq, `${tag}/${f}/${g}/${m}`));
          const r2 = withRatings(ov, () => play(teams[g].sq, teams[f].sq, `${tag}x/${f}/${g}/${m}`));
          matches += 2; v.push(pts(r1.score), pts([r2.score[1], r2.score[0]])); // f is team B in the second match
          goals[a]!.push(r1.score[0] + r1.score[1], r2.score[0] + r2.score[1]);
        }
        per.push(mean(v));
      });
      rows[a] = mean(per);
    });
    return { rows, goals: goals.map(mean), G: mean(rows) };
  };
  const MS = scale(1000);
  const mk = (pen: boolean) => { const used = new Set<string>(); return Object.fromEntries(IDS.map((f) => [f, synthetic(f, pen, used)])) as Record<FormationId, Syn>; };
  const S0 = roundRobin(mk(false), 'fs0', MS); // every effective rating equal: sim arithmetic only (hypothesis A)
  const S1 = roundRobin(mk(true), 'fs1', MS);  // same players, the fit table in force: A plus the fit rules (part of hypothesis B)
  const baked = IDS.map((f) => FORMATIONS[f].slots.reduce((sum, sl) => sum + penalty(ROLE_TO_POS[sl.role], sl.role), 0));

  // (N) squads DRAFTED for each formation by the same CPU draft the game uses, v the population; judged raw and at equal `overall`
  const NN = scale(400), MN = scale(12), OPP = 3;
  const natSquads: Squad[][] = IDS.map(() => []);
  const perSquad: Array<Array<{ ovr: number; ppm: number }>> = IDS.map(() => []);
  type Row = { dOvr: number; p: number; g: number };
  const nat: Row[][] = IDS.map(() => []);
  const oppOf = (k: number, q: number) => withStyle(population[(k * 7 + q * 31) % population.length]!, 'possession');
  const playVs = (A: Squad, k: number, tag: string, collect?: Row[]): number => {
    const v: number[] = [];
    for (let q = 0; q < OPP; q++) {
      const opp = oppOf(k, q);
      for (let m = 0; m < MN; m++) {
        const r = play(A, opp, `${tag}/${k}/${q}/${m}`); matches++; v.push(pts(r.score));
        collect?.push({ dOvr: profile(A).overall - profile(opp).overall, p: pts(r.score), g: r.score[0] + r.score[1] });
      }
    }
    return mean(v);
  };
  IDS.forEach((f, a) => {
    for (let k = 0; k < NN; k++) {
      const sq = withStyle(buildBotSquad(`balN/${f}/${k}`, 'all', LEVELS[k % 3]!, new Set(), `n${k}`, f), 'possession');
      natSquads[a]!.push(sq);
      perSquad[a]!.push({ ovr: profile(sq).overall, ppm: playVs(sq, k, 'fn', nat[a]) });
    }
  });
  const allN = nat.flat();
  const mdo = mean(allN.map((r) => r.dOvr)), mp = mean(allN.map((r) => r.p));
  const slope = allN.reduce((s, r) => s + (r.dOvr - mdo) * (r.p - mp), 0) / allN.reduce((s, r) => s + (r.dOvr - mdo) ** 2, 0);
  const rawN = nat.map((rs) => mean(rs.map((r) => r.p)));
  const adjN = nat.map((rs) => mean(rs.map((r) => r.p - slope * (r.dOvr - mdo))));
  const ovrN = perSquad.map((ps) => mean(ps.map((x) => x.ovr)));
  const GN = mean(rawN), GNa = mean(adjN), GO = mean(ovrN);
  const seN = nat.map((rs) => sd(perSquad[nat.indexOf(rs)]!.map((x) => x.ppm)) / Math.sqrt(NN));

  // (R) SWITCHING INTO each formation: a squad drafted for another formation, re-seated into this one by Auto-arrange, against the very
  //     same opponents and seeds as at home, so squad quality cancels. How much it costs depends on how different the two formations'
  //     player mixes are (3-4-3 wants four wingers), which is geometry, not a defect, so the raw cost is only REPORTED. What is gated is
  //     whether the maths pays a re-seated squad what its overall predicts ("equal overall"), which is the realistic-squad test of hypothesis A.
  const NR = scale(60);
  const costIn: number[][] = IDS.map(() => []);
  const ovrIn: number[][] = IDS.map(() => []);
  IDS.forEach((g, a) => {
    for (let k = 0; k < NR; k++) {
      IDS.forEach((f, b) => {
        if (a === b) return;
        const A = changeFormation(natSquads[a]![k]!, f);
        costIn[b]!.push(playVs(A, k, 'fn') - perSquad[a]![k]!.ppm);
        ovrIn[b]!.push(profile(A).overall - perSquad[a]![k]!.ovr);
      });
    }
  });
  const rowR = costIn.map(mean);
  const GR = mean(rowR);
  const rowRe = costIn.map((cs, b) => mean(cs.map((c, i) => c - slope * ovrIn[b]![i]!))); // ppm lost beyond what the overall lost predicts
  const GRe = mean(rowRe);

  console.log('[3] FORMATIONS  figures are "ppm minus the mean of the six formations" (0.000 = fair).');
  console.log(`    S0 equal      all 11 effective ratings = ${R}, natural players, no chemistry; round robin of ${MS * 4} matches per pair. Only the sim's arithmetic can differ: hypothesis A.`);
  console.log('    S1 fit rules  the same, but the fit table applies (the dealt card for LM/RM is a winger, for a wing-back a full-back). A plus the fit rules.');
  console.log(`    N native      ${NN} squads drafted FOR each formation by the CPU draft v the population (${NN * OPP * MN} matches each, ±SE shown); "equal-ovr" removes the overall gap (${slope.toFixed(3)} ppm per overall point).`);
  console.log(`    R switch-in   ${NR * 5} squads drafted for another formation re-seated into this one by Auto-arrange, paired with their own result: ppm lost by switching in (overall lost in brackets), and beyond what that overall predicts.`);
  console.log(`    ${pad('', 8)}${pad('', 8)}| ${rpad('S0', 7)} ${rpad('S1', 7)} ${rpad('role pen', 8)} | ${rpad('N raw', 7)} ${rpad('±SE', 6)} ${rpad('equal-ovr', 9)} ${rpad('own ovr', 8)} | ${rpad('R switch', 9)} ${rpad('(ovr)', 7)} ${rpad('equal-ovr', 9)} | ${rpad('goals', 6)}`);
  IDS.forEach((f, a) => {
    console.log(`    ${pad(name(f), 8)}${pad(back(f), 8)}| ${rpad(sgn(S0.rows[a]! - S0.G), 7)} ${rpad(sgn(S1.rows[a]! - S1.G), 7)} ${rpad('-' + baked[a]!, 8)} | ${rpad(sgn(rawN[a]! - GN), 7)} ${rpad(seN[a]!.toFixed(3), 6)} ${rpad(sgn(adjN[a]! - GNa), 9)} ${rpad(ovrN[a]!.toFixed(1), 8)} | ${rpad(sgn(rowR[a]! - GR), 9)} ${rpad('(' + mean(ovrIn[a]!).toFixed(1) + ')', 7)} ${rpad(sgn(rowRe[a]! - GRe), 9)} | ${rpad(mean(nat[a]!.map((r) => r.g)).toFixed(2), 6)}`);
  });
  const grp = (arr: number[], g: string) => mean(arr.filter((_, a) => back(IDS[a]!) === g));
  const byBack = (arr: number[], G: number) => (['4-back', '3-back', '5-back'] as const).map((g) => `${g} ${sgn(grp(arr, g) - G)}`).join('  ');
  console.log(`    by back line   S0: ${byBack(S0.rows, S0.G)}`);
  console.log(`                   S1: ${byBack(S1.rows, S1.G)}`);
  console.log(`                   N raw: ${byBack(rawN, GN)}    N equal-ovr: ${byBack(adjN, GNa)}`);
  console.log(`                   R switch-in: ${byBack(rowR, GR)}    R equal-ovr: ${byBack(rowRe, GRe)}`);
  console.log('    WHERE A 3-BACK / 5-BACK GAP COMES FROM  (each line is a direct measurement; "A" is hypothesis A, the rest is hypothesis B):');
  for (const g of ['3-back', '5-back']) {
    const a0 = grp(S0.rows, g) - S0.G, a1 = grp(S1.rows, g) - S1.G;
    console.log(`      ${pad(g, 7)} A sim maths ${sgn(a0)}   B1 fit table (roles with no natural player) ${sgn(a1 - a0)}   B2 switching in from another formation ${sgn(grp(rowR, g) - GR)}   drafted-for, lower overall ${sgn((grp(rawN, g) - GN) - (grp(adjN, g) - GNa))}`);
  }

  const worst = (xs: number[], G: number) => Math.max(...xs.map((x) => Math.abs(x - G)));
  const goalsAll = [...S0.goals, ...S1.goals, ...nat.map((rs) => mean(rs.map((r) => r.g)))];
  const tol = GATE.formationTol;
  gate('formations S0 equal ratings (maths)', `±${tol} ppm`, `worst ${f3(worst(S0.rows, S0.G))}`, worst(S0.rows, S0.G) <= tol);
  gate('formations S1 with the fit rules', `±${tol} ppm`, `worst ${f3(worst(S1.rows, S1.G))}`, worst(S1.rows, S1.G) <= tol);
  gate('formations N drafted-for, equal overall', `±${tol} ppm`, `worst ${f3(worst(adjN, GNa))}`, worst(adjN, GNa) <= tol);
  const rawOk = rawN.every((x, a) => Math.abs(x - GN) <= Math.max(tol, 2 * seN[a]!)); // squads differ in quality, so this one is noisy: pass if inside the tolerance or within two standard errors of zero
  gate('formations N drafted-for, raw', `±${tol} ppm (or 2 SE)`, `worst ${f3(worst(rawN, GN))} (SE ~${f3(Math.max(...seN))})`, rawOk);
  gate('formations R re-seated, equal overall', `±${tol} ppm`, `worst ${f3(worst(rowRe, GRe))}`, worst(rowRe, GRe) <= tol);
  gate('goals a match, every formation', `${GATE.goals[0]}..${GATE.goals[1]}`, `${Math.min(...goalsAll).toFixed(2)}..${Math.max(...goalsAll).toFixed(2)}`, Math.min(...goalsAll) >= GATE.goals[0] && Math.max(...goalsAll) <= GATE.goals[1]);
  void GO;
  console.log('');
}

/* ───────────── [4] a career league on the real data ───────────── */

if (want('career')) {
  const W = getWorld();
  const HOUR = 3_600_000, T0 = 1_700_000_000_000;
  const keepers = W.players.filter((p) => p.pos === 'GK').map((p) => p.ovr);
  let G = 0, N = 0;
  const seeds = QUICK ? 2 : 6;
  for (let k = 1; k <= seeds; k++) {
    const st = createCareer(W, 'ABCD', `r${k}`, T0);
    joinCareer(W, st, { memberId: 'm0-xxxxxxxx', name: 'Man 0', choice: { kind: 'real', id: W.clubs.find((c) => c.league === 1)!.id } });
    let now = T0;
    startCareer(W, st, now);
    while (st.phase === 'draft') { now += st.settings.pickHours * HOUR + 1; tick(W, st, now); }
    let t = now;
    for (let i = 0; i < 14; i++) {
      t += 10; setReady(W, st, st.members[0]!.id, true, t);
      for (const lid of ['1', '2'] as const) for (const f of st.leagues[lid].days[i]!) { G += f.r![0] + f.r![1]; N++; }
    }
    if (k === 1) {
      // the keeper's worth in this league: every First League club against every other, +5 on A's keeper, same seeds
      const ids = st.leagues['1'].clubs;
      const lineups = Object.fromEntries(ids.map((id) => [id, autoLineup(W, st, st.clubs[id]!)]));
      const d: number[] = [];
      for (const a of ids) for (const b of ids) {
        if (a === b) continue;
        const gk = FORMATIONS[lineups[a]!.formation].slots.filter((s) => s.role === 'GK').map((s) => lineups[a]!.slots[s.id]!);
        const ov = Object.fromEntries(gk.map((id) => [id, player(id).ovr + 5]));
        for (let m = 0; m < scale(40); m++) {
          const o = { knockout: false, gkPivot: W.gkPivot };
          const r0 = simulateMatch(lineups[a]!, lineups[b]!, ['A', 'B'], `ck/${a}/${b}/${m}`, o);
          const r1 = withRatings(ov, () => simulateMatch(lineups[a]!, lineups[b]!, ['A', 'B'], `ck/${a}/${b}/${m}`, o));
          matches += 2; d.push(pts(r1.score) - pts(r0.score));
        }
      }
      careerGk = { d: mean(d), se: sd(d) / Math.sqrt(d.length) };
    }
  }
  const gpm = G / N;
  console.log(`[4] CAREER LEAGUE (real data: ${W.players.length} players, mean keeper ${mean(keepers).toFixed(1)}, keeper pivot ${W.gkPivot})  ${seeds} seasons x 14 matchdays = ${N} matches`);
  console.log(`    goals a match ${gpm.toFixed(2)}   (before Sprint 2: 2.60. With the draft game's pivot of 85 it was 3.49: every career keeper looked poor.)`);
  console.log(`    +5 rating on the keeper: ${sgn(careerGk.d)} ppm (±${careerGk.se.toFixed(3)})   (draft game: see [1])`);
  gate('career: goals a match (real data)', `${GATE.careerGoals[0]}..${GATE.careerGoals[1]}`, gpm.toFixed(2), gpm >= GATE.careerGoals[0] && gpm <= GATE.careerGoals[1]);
  gate('career: +5 GK', `${GATE.gkPlus5[0]}..${GATE.gkPlus5[1]} ppm`, sgn(careerGk.d), careerGk.d >= GATE.gkPlus5[0] && careerGk.d <= GATE.gkPlus5[1]);
  console.log('');
}

/* ───────────── verdict ───────────── */

console.log('GATES');
for (const g of gates) console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${pad(g.name, 40)} target ${pad(g.target, 14)} got ${g.got}`);
console.log(`\n${matches.toLocaleString('en')} matches simulated${QUICK ? ' (--quick: a quarter of the sample; only the full run counts)' : ''}. Fixed seeds: the numbers above repeat exactly.`);
const failing = gates.filter((g) => !g.pass);
if (failing.length) {
  console.log(`\nBALANCE: ${failing.length} gate(s) failing${REPORT ? ' (--report: exit code 0)' : ''}`);
  console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (!REPORT) process.exit(1);
} else {
  console.log('\nBALANCE OK');
  console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
