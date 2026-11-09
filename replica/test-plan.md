# Test plan

Run everything: `npm run test:all`.

| layer | what | how many | where |
| --- | --- | --- | --- |
| Data | unique ids, every nation known, ratings in range, depth at every position in every pool | 5 | `tests/data.test.ts` |
| Formations | 11 slots, one keeper, on-pitch coordinates, connected chemistry graph, fit symmetry, optimal re-seating | 4 | `tests/formations.test.ts` |
| Dealing | deterministic, no duplicates, respects pool and taken players, always offers a needed position, 80 full auto-drafts always finish | 4 | `tests/draft.test.ts` |
| Simulation | determinism, a winner in every knockout, consistent shootouts, ordered events, football-shaped statistics, favourite curve | 4 | `tests/sim.test.ts` |
| Room machine | lobby rules, host handover, turn enforcement, stale rounds, timers with grace, AFK, packs privacy, setup edits, series and rematch, CPU teams in every competition, you only see your own game, JSON round trip, secrets never leak, expiry | 28 | `tests/room.test.ts` |
| Dropped connections | alone vs CPU, a dropped phone freezes draft, lineup, match and hub and the clock shifts on return; with a friend present, 45s grace (and a fresh one after a room-wide pause); abandoned rooms expire and do not poll | 6 | `tests/room.test.ts` |
| Take turns draft | one human drafts all 11, then the next, then CPU; the one waiting cannot pick; they see the active pack and pitch live; first drafter alternates each game; only the drafter runs the timer; a drafter who drops is auto-picked so the friend is not left waiting; solo it is a normal draft | 6 | `tests/room.test.ts` |
| Idle rooms | a room everyone left sleeps (no 50ms wake loop); never schedules a wake in the past | 2 | `tests/room.test.ts` |
| Save/restore | tournament rebuilt from storage (split `core`/`comp`, structured clone) before every single step, for league, groups and knockout, ends identical to an uninterrupted run | 3 | `tests/room.test.ts` |
| Competitions | schedules, tables and tie-breaks, advancement, byes, humans spread across groups and bracket halves, CPU-only rounds skipped, fuzzed | 12 | `tests/competition.test.ts` |
| Player traits | every override names a real player; notorious tacklers are booked more; takers match reputation | 4 | `tests/playerstats.test.ts` |
| Live pitch scene | players stay on the pitch at every moment, deterministic, every event type is highlighted, goals end in the net, penalties from the spot, free-kick wall, red card removes a player, quiet stretches fast-forward | 6 | `tests/scene.test.ts` |
| Wire schema | every setting passes the socket validator (zod silently strips unknown keys); junk is rejected | 3 | `tests/schema.test.ts` |
| **Chaos** | 120 random games: random players, disconnects, bad messages, timing. Must never throw, never duplicate a player, always reach a result | 1 | `tests/room.test.ts` |
| Sockets | full duel over real WebSockets with a mid-draft kill and reconnect; stranger and wrong-secret refusals; duplicate connection takeover; garbage and oversize messages | 4 | `tests/protocol.test.ts` (Node host by default, `GAFFER_URL=...` for Cloudflare's runtime) |
| Persistence | SIGKILL the real runtime (workerd + Durable Objects) mid-draft, mid-match and at the hub of a league; restart; every room identical and playable to the champion | 3 | `npm run check:persistence` |
| Browser flows | two real browsers play lobby to rematch: Duel on desktop, Packs on a 390px touch phone. Fails on any console error or failed request | 2 | `e2e/flow.mjs` |
| Browser: take turns | two phones: the guest sees "Sam is picking", Sam's pack and Sam's pitch while the host drafts, nobody is ever up at the same time, then roles swap; through to result and rematch | 1 flow | `e2e/flow.mjs` with `FORMAT=turns` |
| Browser: two phones | iPhone 14 and Pixel 7 emulation play a 4-team league with 2 CPU teams: each phone shows only its own game, standings list 4 teams, exactly 3 matchdays, champion | 6 | `e2e/tournament.mjs` |
| Browser: device sizes | one person vs CPU teams, lobby to champion, at 320x568, 320x658, 430x932 and landscape: no sideways scroll on any screen, pitch and Skip on screen and tappable, no form field under 16px (iOS zoom), event feed never remounts | 4 | `e2e/devices.mjs` |
| Browser stability | unknown room; forced socket drop and auto-reconnect; reopen on the same device; stranger refused; solo cup reload-resume and completion; daily identical for everyone | 9 | `e2e/more.mjs` |
| Accessibility | axe-core WCAG 2.2 A/AA on 15 screens in light and dark, including lobby with CPU teams, lineup, tournament pitch, hub and final table | 30 | `e2e/a11y.mjs` |
| Brand | the original's name, domain, colours absent | 1 | `npm run check:brand` |

## Not covered (say it out loud)

- **No real iPhone or Android, no WebKit or Firefox.** Only Chromium was available. Device runs are emulation of size, touch and safe areas.
- **The shootout scoreboard** only renders when a match reaches penalties, so an accessibility run may or may not exercise it. Its markup was fixed after axe flagged it, but that path is not guaranteed in every run.
- **Real Cloudflare.** Everything ran on Cloudflare's local runtime (workerd), which is the same engine, but nothing was deployed to a real account from here.
- **Player traits** are approximate recollections (see README), so treat individual card counts as flavour.
