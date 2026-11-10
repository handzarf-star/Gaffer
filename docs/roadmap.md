# Roadmap after the Devil's Advocate audit (Phase 1 report, approved)

Sprints run one at a time, each gated on a green test run and a green Cloudflare build. Measured evidence for every item is in the audit
report; the measurement scripts become `npm run check:balance` in Sprint 2.

## Sprint 1: stop the bleeding (no gameplay change)
1. CSP allows Google sign-in (`public/_headers`), with a unit test of the header and an e2e that loads a stub under the real CSP.
2. Build-ID handshake: `/api/health` and the socket hello carry a build id; a mismatch shows a non-destructive "New version available, Reload" banner.
3. Durable Object schema migration: `migrate(vN -> vN+1)` plus `normalise()` replace hard version rejection and deletion; tests use saved state fixtures.
4. Pack dealing degrades gracefully on a nearly empty pool; the room host rolls state back when the engine throws.

## Sprint 2: balance harness, then rebalance (mandatory design adjustments)
* **Keeper.** Do NOT lower the keeper's weight in `overall`: it stays at 0.15, because drafting an elite goalkeeper in packs has to matter.
  Steepen the shot-stopping curve in `sim.ts` (the `gkF` term, about `/70` instead of `/140`) until +5 on the keeper yields about +0.10
  points per match in the harness.
* **Formations.** Before touching the fit tables in `formations.ts`, measure how much of the 3-back / 5-back deficit (-0.14 to -0.19 points
  per match) comes from `overall` weighting attack and midfield (0.30 each) above defence (0.25) versus positional seating penalties. Fix the
  underlying sector weights and seating maths so 3-back and 5-back are viable, with no artificial stat padding.
* **Styles.** Zero-sum style vectors plus a small pairwise matchup term; acceptance: every style's row average within 0.03 points per match of the others and no column with a single best row.

## Sprint 3A: pure split of `career/engine.ts` (zero behaviour change)
Split into draft / matchday / window / season modules. Gate: all existing tests unchanged and green, seeded results byte-identical (the 40-match
fingerprint and a full-season career fingerprint). No feature work in this sprint.

## Sprint 3B: career longevity (after 3A is merged)
Retirement, youth intake from the already-fetched Wikipedia youth rows, estimated ages flagged "est." for players with no known age, fatigue.
This sprint bumps the state schema through `migrate()` from Sprint 1.
* **Fatigue maths (corrected).** Per matchday: outfield starters lose 8 energy per start; rested outfielders gain 20. Starting keepers lose 2
  per start; rested keepers gain 15. Rating penalty = `max(0, 70 - energy) / 10`. (The first proposal of -12 / +18 was negative-sum for an
  18-man squad: ten outfield starters lose 120 per match while six bench outfielders can recover only 108, and it forced keeper rotation every
  three games.)
* Acceptance: over 30 simulated seasons the best-XI rating stays within +/-1 and the average age stays between 26 and 30; state size stays flat.
