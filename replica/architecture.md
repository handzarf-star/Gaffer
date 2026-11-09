# Architecture: Gaffer (a rebuild of a football draft party game's core features)

## Stack

| layer | choice | why |
| --- | --- | --- |
| hosting | **Cloudflare Workers + Durable Objects** | Vercel functions cannot hold WebSockets, so real-time rooms there need a paid third-party relay. Cloudflare gives one deploy, one object per room, hibernation (idle rooms cost nothing) |
| rooms | one Durable Object per 4-letter code, SQLite-backed storage, alarms for timers | Single-threaded per room means no race conditions between two players. State survives eviction and redeploys (verified by killing the runtime mid-draft) |
| rules | `RoomEngine`, a pure state machine with an injected clock, in `src/shared/room.ts` | Testable without a network. The Durable Object and the Node host are thin shells around it |
| web | React 19 + Vite + TypeScript, plain CSS with design tokens | ~114 KB gzipped JS, no UI framework, no third-party requests, self-hosted fonts |
| realtime | WebSocket, JSON messages validated with zod, full-state snapshots | A snapshot per change is bigger than a diff but cannot desync |
| data | bundled TypeScript file of ~650 players | No runtime database means no database outage |
| randomness | seeded (mulberry32) | A match or a daily draft is reproducible from its seed |
| alt host | `src/server/node-dev.ts` (ws) | Local dev without Cloudflare's runtime, e2e fallback, and a deployable alternative on any VM |
| tests | vitest, Playwright, axe-core | see test-plan.md |

## State (the "schema")

`RoomState` (server truth): phase `lobby | draft | setup | match | result`, host, settings, seats (id, name, hue, connected, droppedAt, formation), secrets (server only), seed, draft (round, deadline, shared board or per-seat packs, order, turn, picked, taken, log), squads (formation, slot to player, tactic), setup (deadline, ready), match (fixtures with full results, seen, deadline), series (wins, games, log), rematch votes.
`RoomView` is what a client may see: no secrets, no seed, other players' packs hidden, other lineups hidden during setup.

## Protocol

| client to server | does | guard |
| --- | --- | --- |
| hello | join or re-identify with `{id, secret}` | secret must match; strangers refused after start |
| settings, formation, name | lobby configuration | host only (settings) |
| start | begin draft | host, 2+ connected players |
| pick `{round, card, slot}` | draft a player | right round, your turn (duel), card on your board, slot empty |
| swap, arrange, style, ready, formation | setup | setup phase only |
| seen | done watching the match | match phase |
| rematch, lobby, kick, emote | after the game | host for lobby/kick |

Server to client: `welcome`, `state` (full snapshot + server time), `err`, `fatal`, `emote`. Keep-alive is the literal string `ping`/`pong`, answered by the runtime without waking the room.

## HTTP

| route | does |
| --- | --- |
| `POST /api/rooms` | create a room, returns `{code}` (retries on collision, same-origin only) |
| `GET /api/rooms/:code` | `{exists, phase, players, joinable}` |
| `GET /ws/:code` | WebSocket into the room |
| everything else | static assets, SPA fallback |

## The parts that bite (and what handles them)

- **Timers.** Deadlines are absolute server timestamps; clients correct for clock offset. Picks within 700 ms after a deadline still count. A dropped seat is cut to an 8 s grace, then auto-picked. Alarms wake a hibernated room.
- **Reconnect.** One live connection per seat: the newest wins. The seat secret lives in `localStorage`. Backoff reconnect, 12 s heartbeat, 26 s dead-socket detection, instant retry on tab focus or `online`.
- **Fairness.** Snake order, first picker rotates each game. Boards always contain a card for a position you still need.
- **Determinism.** Boards and matches derive only from `(seed, round, key)`.
- **Idempotency.** Every message is validated against the current round, turn and slot, so a duplicate or late message is rejected, not applied twice.
- **Persistence.** State is split into `core` and `match` keys; the match is written only when it changes.
- **Abuse.** 4 KB message cap, token bucket per socket, strict CSP, same-origin room creation. Add a Cloudflare rate-limit rule for public launch.

## Build order that was followed

1. Engine and data with tests (draft, fit, chemistry, sim calibration, room machine, chaos fuzz)
2. Server adapters; the same socket test run against Node and workerd; kill-and-restart persistence check
3. Client and design system; two-browser e2e after every layer
4. Real-browser stability scenarios, accessibility audit, brand sweep, parity score
