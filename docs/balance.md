# Balance harness

`npm run check:balance` plays the real match engine 365,000 times with fixed seeds (about 90 seconds; the same code always prints the
same numbers) and checks that the levers the game advertises are the levers that matter. `-- --quick` uses a quarter of the matches
for iterating (noisier: only the full run counts), `-- --only=sectors|styles|formations` runs one part, `-- --report` never fails.
"ppm" is league points per match (win 3, draw 1, loss 0). A gate prints PASS or FAIL and the process exits 1 if any fail.

It is **not** part of `npm run test:all` yet: at the baseline below six gates fail on purpose, and Sprint 2 fixes them one lever at a
time. Each lever's commit adds its before/after table at the bottom of this file. Once all are green it joins `test:all`.

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
