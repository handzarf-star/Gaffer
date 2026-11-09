# Test plan

Run everything: `npm run test:all`.

| layer | what | how many | where |
| --- | --- | --- | --- |
| Data | unique ids, every nation known, ratings in range, depth at every position in every pool | 5 | `tests/data.test.ts` |
| Formations | 11 slots, one keeper, on-pitch coordinates, connected chemistry graph, fit symmetry, optimal re-seating | 4 | `tests/formations.test.ts` |
| Dealing | deterministic, no duplicates, respects pool and taken players, always offers a needed position, 80 full auto-drafts always finish | 4 | `tests/draft.test.ts` |
| Simulation | determinism, a winner in every knockout, consistent shootouts, ordered events, football-shaped statistics, favourite curve | 4 | `tests/sim.test.ts` |
| Room machine | lobby rules, host handover, turn enforcement, stale rounds, timers with grace, AFK, packs privacy, setup edits, series and rematch, 3-player round robin, JSON round trip, secrets never leak, expiry | 23 | `tests/room.test.ts` |
| **Chaos** | 120 random games: random players, disconnects, bad messages, timing. Must never throw, never duplicate a player, always reach a result | 1 | `tests/room.test.ts` |
| Sockets | full duel over real WebSockets with a mid-draft kill and reconnect; stranger and wrong-secret refusals; duplicate connection takeover; garbage and oversize messages | 4 | `tests/protocol.test.ts` (Node host by default, `GAFFER_URL=...` for Cloudflare's runtime) |
| Persistence | kill the whole runtime mid-draft, restart, reconnect: same round, turn, board | 1 | `npm run check:persistence` |
| Browser flows | two real browsers play lobby to rematch: Duel on desktop, Packs on a 390px touch phone. Fails on any console error or failed request | 2 | `e2e/flow.mjs` |
| Browser stability | unknown room; forced socket drop and auto-reconnect; reopen on the same device; stranger refused; solo cup reload-resume and completion; daily identical for everyone | 9 | `e2e/more.mjs` |
| Accessibility | axe-core WCAG 2.2 A/AA on 10 screens in light and dark | 20 | `e2e/a11y.mjs` |
| Brand | the original's name, domain, colours absent | 1 | `npm run check:brand` |
