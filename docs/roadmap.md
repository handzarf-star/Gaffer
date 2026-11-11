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

## Sprint 3A and 3B: CANCELLED (decided after the product audit)

Both served only Career mode (splitting `career/engine.ts`, then retirement, youth intake and fatigue). The product goal that was then
written down, a friends' league built on a pack draft, does not contain Career's real clubs, transfer lists or promotion, so that work is
dropped, not postponed. Career stays in the app as it is, under "More", and is not developed further. What Career had that the goal needs
(guest accounts, the "ready or deadline" matchday rule, the club name and badge editor, the sourced Balkan squads) moves into the one mode
that is the product. The plan for that is `docs/league-night.md`.

One rule recorded for whoever next migrates a saved league: prune `st@v<old>` backups older than `v(current - 1)` (see `docs/balance.md`).
