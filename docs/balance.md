# Balance harness

`npm run check:balance` plays the real match engine 365,000 times with fixed seeds (about 90 seconds; the same code always prints the
same numbers) and checks that the levers the game advertises are the levers that matter. `-- --quick` uses a quarter of the matches
for iterating (noisier: only the full run counts), `-- --only=sectors|styles|formations` runs one part, `-- --report` never fails.
"ppm" is league points per match (win 3, draw 1, loss 0). A gate prints PASS or FAIL and the process exits 1 if any fail.

It is part of `npm run test:all`. The baseline below was recorded before Sprint 2 and had six gates failing on purpose; each lever's commit
added its before/after table at the bottom of this file and all gates are now green.

What it measures:

1. **Sector sensitivity.** +5 rating on every player of one sector of team A, same seeds as the baseline: the points per match it buys.
2. **Tactical styles.** A 5x5 matrix, squads mirrored so quality cancels (style on squad i against style on squad j, and the reverse).
   Row averages against all five styles and against the other four, the best choice against each opponent style, dominant styles.
3. **Formations.** Four independent arms, because a gap can have more than one cause:
   - **S0** all eleven effective ratings equal, natural players, no chemistry: only the sim's arithmetic can differ (hypothesis A).
   - **S1** the same players with the fit table applied, as in a game (the card dealt for LM is a winger, for a wing-back a full-back).
   - **N** squads drafted *for* each formation by the CPU draft, against a mixed population, raw and at equal `overall`.
   - **R** the cost of *switching into* a formation: a squad drafted for another formation, re-seated by Auto-arrange, against the same
     opponents and seeds as at home (paired by squad, so squad quality cancels).

## Baseline (before any Sprint 2 change), commit `26cf357` + harness

```
[1] SECTOR SENSITIVITY  45 near-equal pairs x 200 matches, both sides on Possession. Baseline 1.386 ppm, 2.80 goals a match.
    +5 rating on every player in ONE sector of team A (same random seeds as the baseline); "share" = of what +5 on everyone gives
    +5 ATT  +0.243 ppm  (±0.011)   share  34%   overall weight  30%
    +5 MID  +0.228 ppm  (±0.011)   share  32%   overall weight  30%
    +5 DEF  +0.214 ppm  (±0.011)   share  30%   overall weight  25%
    +5 GK   +0.027 ppm  (±0.003)   share   4%   overall weight  15%
    +5 ALL  +0.665 ppm  (±0.014)   (sum of the four: +0.711)

[2] TACTICAL STYLES  40 pairs x 50 matches, mirrored (4000 per cell), 2.96 goals a match. Cell = ppm of the ROW style against the COLUMN style.
                possess   press   wings fortres counter  |  avg v 5  vs mean |  avg v 4  vs mean
    possession    1.404   1.506   1.497   1.412   1.514  |    1.467   +0.072 |    1.482   +0.088  <-- outside ±0.03
    press         1.317   1.408   1.390   1.310   1.430  |    1.371   -0.023 |    1.362   -0.033  <-- outside ±0.03
    wings         1.296   1.406   1.418   1.350   1.468  |    1.388   -0.007 |    1.380   -0.014
    fortress      1.363   1.444   1.417   1.341   1.431  |    1.399   +0.005 |    1.414   +0.019
    counter       1.265   1.353   1.395   1.323   1.400  |    1.347   -0.047 |    1.334   -0.061  <-- outside ±0.03
    best choice  possess possess possess possess possess   (column maxima: 1.404 1.506 1.497 1.412 1.514)
    dominant style (best choice against all five): possession    never the best choice: press, wings, fortress, counter

[3] FORMATIONS  figures are "ppm minus the mean of the six formations" (0.000 = fair).
    S0 equal      all 11 effective ratings = 80, natural players, no chemistry; round robin of 2000 matches per pair. Only the sim's arithmetic can differ: hypothesis A.
    S1 fit rules  the same, but the fit table applies (the dealt card for LM/RM is a winger, for a wing-back a full-back). A plus the fit rules.
    N native      400 squads drafted FOR each formation by the CPU draft v the population (14400 matches each, ±SE shown); "equal-ovr" removes the overall gap (0.120 ppm per overall point).
    R switch-in   300 squads drafted for another formation re-seated into this one by Auto-arrange, paired with their own result: ppm lost by switching in (ovr lost in brackets).
                    |      S0      S1 role pen |   N raw    ±SE equal-ovr  own ovr |  R switch   (ovr) |  goals
    3-4-3   3-back  |  -0.006  -0.113      -12 |  -0.056  0.020    -0.004     86.4 |    -0.054  (-1.3) |   2.82
    3-5-2   3-back  |  +0.030  +0.037       -6 |  -0.021  0.021    -0.008     86.7 |    -0.032  (-1.1) |   2.84
    4-3-3   4-back  |  +0.002  +0.094       -0 |  +0.087  0.022    +0.010     87.5 |    +0.106  (-0.2) |   2.89
    4-4-2   4-back  |  -0.026  -0.116      -12 |  -0.064  0.021    -0.008     86.4 |    -0.026  (-1.1) |   2.79
    5-3-2   5-back  |  +0.015  +0.019       -6 |  -0.016  0.022    -0.001     86.7 |    -0.057  (-1.3) |   2.88
    4-2-3-1 4-back  |  -0.014  +0.078       -0 |  +0.069  0.021    +0.011     87.3 |    +0.062  (-0.4) |   2.89
    by back line   S0: 4-back -0.013  3-back +0.012  5-back +0.015
                   S1: 4-back +0.019  3-back -0.038  5-back +0.019
                   N raw: 4-back +0.031  3-back -0.038  5-back -0.016    N equal-ovr: 4-back +0.004  3-back -0.006  5-back -0.001
                   R switch-in: 4-back +0.048  3-back -0.043  5-back -0.057
    WHERE A 3-BACK / 5-BACK GAP COMES FROM  (each line is a direct measurement; "A" is hypothesis A, the rest is hypothesis B):
      3-back  A sim maths +0.012   B1 fit table (roles with no natural player) -0.049   B2 switching in from another formation -0.043   drafted-for, lower overall -0.032
      5-back  A sim maths +0.015   B1 fit table (roles with no natural player) +0.004   B2 switching in from another formation -0.057   drafted-for, lower overall -0.015

GATES
  FAIL  keeper: +5 GK                            target 0.09..0.12 ppm got +0.027
  FAIL  styles: every row within the mean        target ±0.03 ppm      got worst 0.088
  FAIL  styles: no dominant style                target none           got possession
  PASS  formations S0 equal ratings (maths)      target ±0.03 ppm      got worst 0.030
  FAIL  formations S1 with the fit rules         target ±0.03 ppm      got worst 0.116
  PASS  formations N drafted-for, equal overall  target ±0.03 ppm      got worst 0.011
  FAIL  formations N drafted-for, raw            target ±0.03 ppm (or 2 SE) got worst 0.087 (SE ~0.022)
  FAIL  formations R cost of switching in        target ±0.03 ppm      got worst 0.106
  PASS  goals a match, every formation           target 2.4..3.2       got 2.59..2.89

365,200 matches simulated. Fixed seeds: the numbers above repeat exactly.

BALANCE: 6 gate(s) failing (--report: exit code 0)
```

### What the baseline says

* **The keeper is the outlier, not the formations' maths.** Without the keeper the sim's sector shares are attack 35%, midfield 33%,
  defence 31% against the declared 35/35/29: they already agree. The keeper is worth 4% of what +5 on everyone is worth, against its
  declared 15%.
* **Possession is dominant**: the best choice against all five styles, +0.07 to +0.09 ppm above the mean; counter is -0.05 to -0.06.
* **Hypothesis A (sim maths) does not explain the formation gap.** With every effective rating equal (S0) the formations are within
  0.030 ppm, 3-back +0.012 and 5-back +0.015, which is noise (standard error about 0.009). The gap is hypothesis B: the fit rules.
  Formations with LM/RM (4-4-2, 3-4-3) carry a built-in -12 rating points because no natural LM/RM card exists, and the dealt card
  (a winger) is charged 6 points each; wing-backs carry -6. That is -0.11 ppm (S1) before a single squad is drafted.

## Sprint 3B housekeeping (recorded here so it is not lost)

When `st@v<old>` backups are first used for a real migration in Sprint 3B, the migration must prune any backup older than
`v(current - 1)` so Durable Object storage never accumulates historical copies. Add a test with three stacked backups.

---

## Changes, in order (each lever is its own commit; tables are the full harness)

### 2.2 Keeper: the shot-stopping curve (`sim.ts`, `gkFactor`)

The keeper stays at 0.15 of `overall`. The three copies of `1 - (gk - 80) / 140` (open play, corners, free kicks) became one function,
`gkFactor(eff) = clamp(1 - (eff - 85) / 38, 0.55, 1.5)`.

| +5 rating on one sector | before | after | overall weight |
|---|---|---|---|
| attack | +0.243 (34%) | +0.241 (31%) | 30% |
| midfield | +0.228 (32%) | +0.228 (29%) | 30% |
| defence | +0.214 (30%) | +0.214 (27%) | 25% |
| **keeper** | **+0.027 (4%)** | **+0.101 (13%)** | **15%** |
| goals a match (near-equal pairs) | 2.80 | 2.77 | |

Two things the brief did not expect:

* **`/70` is not enough.** Measured with the real engine, a divisor of 70 buys +0.054 ppm, half the target. The target needs about `/38`
  (sweep: `/70` +0.054, `/50` +0.077, `/40` +0.096, `/38` +0.105, `/36` +0.108).
* **The pivot had to move from 80 to 85.** The mean keeper of a drafted squad is 86.6, so a steeper curve centred on 80 made the
  average keeper an above-average one and cut league-wide goals from 2.80 to 2.61 a match. Centred at 85 the curve moves the odds
  *between* teams and leaves goals per match where they were.

An elite keeper (95) now stops about a quarter of the shots that an 85 would concede (`gkFactor` 0.74); a poor one (65) concedes
about 1.5 times as many (clamped).

The golden table in `tests/result-text.test.ts` (40 seeded matches) follows the engine and was re-recorded on purpose.

### 2.3 Tactics: zero-sum, plus rock, paper, scissors (`squad.ts`, `sim.ts`)

**What was wrong.** Every tactic added 0.3 to 0.95 points of `overall` for free, the CPU picked the tactic with the highest `overall`
(so always Possession), Possession was the best choice against all five tactics, Counter lost 0.06 ppm to the mean, and Fortress's
"+2 keeper" was shown but never used (the match reads the keeper on the pitch, not the profile).

**What changed.**

| tactic | before (att / mid / def / gk) | after | tempo | aggression |
|---|---|---|---|---|
| Possession | 0 / +4 / -1 / 0 | -2 / +3 / -1.5 / 0 | 0.9 | 1 |
| High Press | +2 / +3 / -3 / 0 | +2 / +3 / -5.5 / 0 | 1.1 | 1.4 -> 1.15 |
| Wide Attack | +3 / -1 / 0 / 0 (else +1/-1) | +3 / 0 / -3.5 / 0 (else +1 / 0 / -1) | 1.05 | 1 |
| Fortress | -3 / 0 / +5 / +2 (dead) | -3 / -2 / +5 / +1 (real) | 0.8 | 0.9 -> 1.05 |
| Counter | +3 / -2 / 0 / 0, +2 attack as the underdog | +3 / -3 / 0 / 0 | 0.95 | 1 -> 0.9 |

* Every vector changes `overall` by at most 0.125 (was 0.3 to 0.95); `tests/styles.test.ts` holds it to 0.15.
* **Rock, paper, scissors** (`sim.ts`, `MATCHUP_EDGE = 1.3` rating points on two sectors, what one side gains the other gives up):
  High Press beats Possession (wins the ball back in midfield), Possession beats Fortress (takes the low block apart: attack up, their
  defence down), Fortress beats Counter (no space behind: their attack down), Counter beats High Press (runs past the high line).
  **Wide Attack is the neutral tactic**: the codebase has no "Balanced" tactic, so the fifth tactic plays that part.
  Measured, a winning matchup is worth 0.075 to 0.109 ppm on top of the draft (about 0.6 of an overall point).
* The tactic text on the Setup screen now says who it beats and who beats it; the how-to says so too (and a test keeps the text honest).
* **The CPU no longer picks by `overall`**: a rival's choice is hidden, so a random pick is also the best mixed strategy. In a career
  league each computer club plays one tactic all season (chosen from club and season); a manager's own tactic is never overridden,
  including by the Best eleven button.
* **Removed: Counter's "+2 attack when you are the underdog".** It is the one tactic bonus that is not zero-sum, and the harness
  cannot see it (it measures near-equal pairs). Say if you want an underdog mechanic back; it would be a separate, gated lever.
* Aggression is a real cost, not flavour: High Press at 1.4 cost about 0.058 ppm in cards and free kicks, so it is now 1.15 and its
  defence penalty is -5.5 instead of -6 to keep it neutral. Counter and Fortress's aggression were tuned the same way.

| 5x5 style matrix (ppm of the row against the column) | before | after |
|---|---|---|
| worst row vs the mean of all rows | **0.088** (Possession +0.088, Counter -0.061) | **0.009** |
| best choice against all five opponents | Possession (dominant) | none |
| never the best choice | Press, Wings, Counter | Wings (neutral by design) |

After (full run):

```
[2] TACTICAL STYLES  (40 pairs x 50 matches, mirrored; cell = ppm of the ROW tactic against the COLUMN tactic)
                possess   press   wings fortres counter  |  avg v 5  vs mean |  avg v 4  vs mean
    possession    1.383   1.307   1.439   1.443   1.370  |    1.388   -0.008 |    1.390   -0.009
    press         1.540   1.401   1.401   1.359   1.321  |    1.404   +0.007 |    1.405   +0.007
    wings         1.394   1.398   1.408   1.387   1.424  |    1.402   +0.005 |    1.401   +0.002
    fortress      1.312   1.419   1.413   1.348   1.473  |    1.393   -0.004 |    1.404   +0.006
    counter       1.384   1.502   1.415   1.270   1.410  |    1.396   -0.001 |    1.393   -0.006
    best choice    press counter possess possess fortres   (column maxima: 1.540 1.502 1.439 1.443 1.473)
    dominant style (best choice against all five): none    never the best choice: wings

[3] FORMATIONS  figures are "ppm minus the mean of the six formations" (0.000 = fair).
    S0 equal      all 11 effective ratings = 80, natural players, no chemistry; round robin of 2000 matches per pair. Only the sim's arithmetic can differ: hypothesis A.
    S1 fit rules  the same, but the fit table applies (the dealt card for LM/RM is a winger, for a wing-back a full-back). A plus the fit rules.
    N native      400 squads drafted FOR each formation by the CPU draft v the population (14400 matches each, ±SE shown); "equal-ovr" removes the overall gap (0.132 ppm per overall point).
    R switch-in   300 squads drafted for another formation re-seated into this one by Auto-arrange, paired with their own result: ppm lost by switching in (ovr lost in brackets).
                    |      S0      S1 role pen |   N raw    ±SE equal-ovr  own ovr |  R switch   (ovr) |  goals
    3-4-3   3-back  |  +0.012  -0.118      -12 |  -0.047  0.021    +0.010     85.4 |    -0.057  (-1.3) |   2.64
    3-5-2   3-back  |  +0.015  +0.025       -6 |  -0.012  0.022    +0.002     85.7 |    -0.041  (-1.1) |   2.67
    4-3-3   4-back  |  +0.021  +0.096       -0 |  +0.088  0.022    +0.002     86.5 |    +0.115  (-0.2) |   2.70
    4-4-2   4-back  |  -0.027  -0.116      -12 |  -0.076  0.022    -0.014     85.4 |    -0.027  (-1.1) |   2.61
    5-3-2   5-back  |  +0.011  +0.038       -6 |  -0.015  0.022    +0.002     85.7 |    -0.063  (-1.3) |   2.70
    4-2-3-1 4-back  |  -0.031  +0.076       -0 |  +0.063  0.021    -0.001     86.3 |    +0.073  (-0.4) |   2.70
    by back line   S0: 4-back -0.012  3-back +0.013  5-back +0.011
                   S1: 4-back +0.019  3-back -0.047  5-back +0.038
                   N raw: 4-back +0.025  3-back -0.030  5-back -0.015    N equal-ovr: 4-back -0.004  3-back +0.006  5-back +0.002
                   R switch-in: 4-back +0.053  3-back -0.049  5-back -0.063
    WHERE A 3-BACK / 5-BACK GAP COMES FROM  (each line is a direct measurement; "A" is hypothesis A, the rest is hypothesis B):
      3-back  A sim maths +0.013   B1 fit table (roles with no natural player) -0.060   B2 switching in from another formation -0.049   drafted-for, lower overall -0.035
      5-back  A sim maths +0.011   B1 fit table (roles with no natural player) +0.027   B2 switching in from another formation -0.063   drafted-for, lower overall -0.017

[4] CAREER LEAGUE (real data: 942 players, mean keeper 64.3, keeper pivot 69.8)  6 seasons x 14 matchdays = 1344 matches
    goals a match 2.61   (before Sprint 2: 2.60. With the draft game's pivot of 85 it was 3.49: every career keeper looked poor.)
    +5 rating on the keeper: +0.096 ppm (±0.004)   (draft game: see [1])

GATES
  PASS  keeper: +5 GK                            target 0.09..0.12 ppm got +0.099
  PASS  styles: every row within the mean        target ±0.03 ppm      got worst 0.009
  PASS  styles: no dominant style                target none           got none
  FAIL  formations S0 equal ratings (maths)      target ±0.03 ppm      got worst 0.031
  FAIL  formations S1 with the fit rules         target ±0.03 ppm      got worst 0.118
  PASS  formations N drafted-for, equal overall  target ±0.03 ppm      got worst 0.014
  FAIL  formations N drafted-for, raw            target ±0.03 ppm (or 2 SE) got worst 0.088 (SE ~0.022)
  FAIL  formations R cost of switching in        target ±0.03 ppm      got worst 0.115
  PASS  goals a match, every formation           target 2.4..3.2       got 2.61..2.89
  PASS  career: goals a match (real data)        target 2.4..2.9       got 2.61
  PASS  career: +5 GK                            target 0.09..0.12 ppm got +0.096

384,400 matches simulated. Fixed seeds: the numbers above repeat exactly.

BALANCE: 4 gate(s) failing (--report: exit code 0)
```

#### A correction to 2.2 that the harness could not see, found while fixing 2.3

Step 2.2 centred the keeper curve on 85, the mean keeper of a *drafted* squad. A **career league** is a different world: its keepers
average **64.3**. With the pivot at 85 every career keeper looked poor, and real-data career goals per match went from **2.60 to 3.49
(+33%)**. The draft-game harness measured only the draft game, so it passed. The career realism test caught the knock-on from 2.3
(the CPU all playing Press), which is how it surfaced.

* The pivot is now a property of the competition: `simulateMatch` takes `gkPivot` (default 85, the draft game), and a career league
  derives it from its own keepers, `IndexedWorld.gkPivot = mean keeper + 5.5` (= 69.8 on the real data; 5.5 keeps goals at their old 2.60).
* `GK_DIVISOR` 38 -> 36, because the new tactics moved the sector baseline and the keeper had slid to the edge of its band.
* The harness has a new section **[4] career league** (real data, six seasons of 14 matchdays) with two gates: goals per match in
  2.4..2.9 and +5 on the keeper in 0.09..0.12.

| | before Sprint 2 | 2.2 as first committed | now |
|---|---|---|---|
| career goals a match (real data) | 2.60 | 3.49 | **2.61** |
| career +5 keeper (ppm) | +0.027 (est.) | not measured | **+0.096** |
| draft game +5 keeper (ppm) | +0.027 | +0.101 | **+0.099** |

### 2.4 Formations: the "3-back / 5-back deficit" was the fit table, not the maths (`formations.ts`)

**Measure first.** The Phase-1 audit saw 3-back and 5-back lose 0.14 to 0.19 ppm. The harness separates the two hypotheses with four
arms (see the top of this file). Baseline, before any change in this step (full run, two standard errors are about 0.02):

| | A: sim maths (S0, equal ratings) | B: fit table (S1 minus S0) | drafted-for squads, lower overall | switching in from another formation |
|---|---|---|---|---|
| 3-back | +0.013 | -0.060 | -0.035 | -0.049 |
| 5-back | +0.011 | +0.027 | -0.017 | -0.063 |

**The split.** Hypothesis A explains **none** of the gap (it is +0.01 in the *other* direction, inside the noise): sector values are
weighted *averages* of whoever sits in the sector, so five defenders cannot "shift weight into Defence", and the sim values a point of
attack and a point of defence in the ratio 1.15 to 1 against the declared 1.20 to 1, not the other way round. Hypothesis B explains
all of it, and in one specific form that is *not* "3-back and 5-back" but **any formation with LM/RM/wing-back roles**: the pool has no
LM, RM, LWB or RWB players, the game deals a winger for the first two and a full-back for the others, and the fit table then
charged that dealt card 6 and 3 rating points. 4-4-2 and 3-4-3 started every match 12 points down (S1: -0.116 and -0.118 ppm), 3-5-2 and
5-3-2 six points down, and 4-3-3 and 4-2-3-1, whose roles have natural players, none. That is why 4-4-2, a *4-back* formation, was
as bad as 3-4-3, and why 5-3-2 looked bad only against 4-3-3.

**The fix** (one rule, no stat padding): the card the game deals for a role is natural for it (`fit(pos, role)` returns 1 when
`ROLE_TO_POS[role] === pos`). A winger at LM is natural, a full-back at wing-back is natural; the wrong side (RW at LM) or the wrong
job (a striker at LM) still costs. The deal table and the fit table now agree.

| ppm vs the mean of the six formations | before | after |
|---|---|---|
| S1 equal players, fit rules on: worst | **0.118** (3-4-3, 4-4-2) | **0.023** |
| drafted-for squads, raw: worst | **0.088** (4-4-2 -0.076, 4-3-3 +0.088) | **0.039** (SE 0.023) |
| drafted-for squads, at equal overall: worst | 0.014 | 0.013 |
| re-seated squads, beyond what their overall predicts: worst | n/a | 0.013 |
| goals a match across the formations | 2.59 to 2.89 | 2.65 to 2.89 |

After (full run):

```
[3] FORMATIONS  figures are "ppm minus the mean of the six formations" (0.000 = fair).
    S0 equal      all 11 effective ratings = 80, natural players, no chemistry; round robin of 4000 matches per pair. Only the sim's arithmetic can differ: hypothesis A.
    S1 fit rules  the same, but the fit table applies (the dealt card for LM/RM is a winger, for a wing-back a full-back). A plus the fit rules.
    N native      400 squads drafted FOR each formation by the CPU draft v the population (14400 matches each, ±SE shown); "equal-ovr" removes the overall gap (0.133 ppm per overall point).
    R switch-in   300 squads drafted for another formation re-seated into this one by Auto-arrange, paired with their own result: ppm lost by switching in (overall lost in brackets), and beyond what that overall predicts.
                    |      S0      S1 role pen |   N raw    ±SE equal-ovr  own ovr |  R switch   (ovr) equal-ovr |  goals
    3-4-3   3-back  |  +0.011  +0.006       -0 |  -0.017  0.022    +0.006     86.1 |    -0.056  (-1.5)    +0.002 |   2.70
    3-5-2   3-back  |  +0.007  +0.005       -0 |  -0.021  0.022    -0.006     86.1 |    -0.023  (-1.2)    -0.005 |   2.65
    4-3-3   4-back  |  +0.007  +0.004       -0 |  +0.039  0.022    +0.007     86.5 |    +0.066  (-0.7)    +0.013 |   2.71
    4-4-2   4-back  |  -0.027  -0.023       -0 |  +0.005  0.023    -0.013     86.4 |    +0.051  (-0.8)    +0.004 |   2.68
    5-3-2   5-back  |  +0.019  +0.019       -0 |  -0.012  0.022    +0.010     86.1 |    -0.051  (-1.4)    -0.006 |   2.69
    4-2-3-1 4-back  |  -0.017  -0.011       -0 |  +0.006  0.021    -0.004     86.3 |    +0.013  (-0.9)    -0.008 |   2.70
    by back line   S0: 4-back -0.012  3-back +0.009  5-back +0.019
                   S1: 4-back -0.010  3-back +0.006  5-back +0.019
                   N raw: 4-back +0.017  3-back -0.019  5-back -0.012    N equal-ovr: 4-back -0.003  3-back +0.000  5-back +0.010
                   R switch-in: 4-back +0.043  3-back -0.039  5-back -0.051    R equal-ovr: 4-back +0.003  3-back -0.002  5-back -0.006
    WHERE A 3-BACK / 5-BACK GAP COMES FROM  (each line is a direct measurement; "A" is hypothesis A, the rest is hypothesis B):
      3-back  A sim maths +0.009   B1 fit table (roles with no natural player) -0.003   B2 switching in from another formation -0.039   drafted-for, lower overall -0.019
      5-back  A sim maths +0.019   B1 fit table (roles with no natural player) -0.000   B2 switching in from another formation -0.051   drafted-for, lower overall -0.022
```

**What is deliberately not "fixed".** Moving a drafted squad into a *different* formation still costs overall, and the cost is
the distance between the two formations' player mixes: 3-5-2 to 5-3-2 costs 0.2 of an overall point, 4-3-3 to 4-2-3-1 costs 0.3, 3-4-3 to
anything costs 1.3 to 2.2 (it needs four wingers). That is geometry, not a defect; a fit rule cannot make every formation equally close to
every other without making them all want the same eleven players. So the raw switch-in cost is reported (3-back -0.04, 5-back -0.05, 4-back
+0.04 against the mean) and what is gated is whether the *maths* pays a re-seated squad what its overall predicts (worst 0.013). Drafting
*for* a formation, which is how the game is played (the formation is chosen in the lobby), is fair to within the noise.

**All gates, final full run (`npm run check:balance`, exit code 0, 103 s):**

```
GATES
  PASS  keeper: +5 GK                            target 0.09..0.12 ppm got +0.101
  PASS  styles: every row within the mean        target ±0.03 ppm      got worst 0.011
  PASS  styles: no dominant style                target none           got none
  PASS  formations S0 equal ratings (maths)      target ±0.03 ppm      got worst 0.027
  PASS  formations S1 with the fit rules         target ±0.03 ppm      got worst 0.023
  PASS  formations N drafted-for, equal overall  target ±0.03 ppm      got worst 0.013
  PASS  formations N drafted-for, raw            target ±0.03 ppm (or 2 SE) got worst 0.039 (SE ~0.023)
  PASS  formations R re-seated, equal overall    target ±0.03 ppm      got worst 0.013
  PASS  goals a match, every formation           target 2.4..3.2       got 2.65..2.89
  PASS  career: goals a match (real data)        target 2.4..2.9       got 2.57
  PASS  career: +5 GK                            target 0.09..0.12 ppm got +0.099
```

`check:balance` now runs in `npm run test:all`.
