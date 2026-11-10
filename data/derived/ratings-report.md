# Rating model: how well does it agree with the supplied ratings?

Compared on the 32 players that appear in both the current Wikipedia squads and the supplied lists. Two caveats: the supplied lists only cover each club's best players, so this says little about depth players; and the score weights were revised once after looking at these same players, so these figures are in-sample (optimistic).

* mean absolute error: **3.5 rating points**
* within 2 points: 8/32, within 3 points: 18/32
* within-club ordering (Spearman, weighted by players per club): **0.30** over 7 clubs with 2+ matches

  - dinamo-zagreb: 10 players, rho 0.52
  - crvena-zvezda: 5 players, rho 0.40
  - hajduk: 4 players, rho 0.80
  - partizan: 3 players, rho -0.50
  - zeleznicar-pancevo: 2 players, rho -1.00
  - rijeka: 5 players, rho 0.10
  - vojvodina: 2 players, rho 1.00
