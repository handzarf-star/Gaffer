# Recon map: draftie.online (web)

Scope: the whole public game. Draft loop, formations, solo "championship", private lobbies, public pages.
For: two friends playing together. Not a product to sell.
Date: 2026-11-09
Method: public pages and the live app used by hand as a normal player, desktop (1440x900) and mobile (390x844).
Per the Replica rules: no JavaScript bundles read, no private endpoints called, no scraping, no load testing.

## Honest limits of this recon

- **Live multiplayer was not testable.** The sandbox proxy blocks WebSocket upgrades, so I never saw two humans in one
  room. Everything about the lobby comes from its create-room form, its FAQ and its About page. (Certain)
- **The original's own backend was unreachable from the sandbox** (its host is not on the allow-list, and I did not add it).
  So I saw its failure modes (below) but not its happy path for matchmaking or the match result screen. (Certain)
- Third-party tags observed as failed loads: an analytics tool, an ad network, a hosted-Postgres backend. Category only, no endpoints recorded.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | home / game | https://draftie.online/ | drove the full draft by hand |
| 2 | how to play | https://draftie.online/how-to-play | 4-step summary |
| 3 | faq | https://draftie.online/faq | rules of rooms, rights, ads |
| 4 | about | https://draftie.online/about | positioning, "independent and unofficial" |
| 5 | lobbies | https://draftie.online/lobbies | create-room form |
| 6 | contact / privacy / terms | /contact /privacy /terms | room disputes, data stored |

## Core loop

Open a sealed pack, pick 1 of 3 footballers, drop them on a pitch slot; repeat 11 times; a simulator turns the XI into a result you argue about.

## Screens

| ID | screen | route | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home / mode + pack carousel | `/` , `/premier-league?lang=en` | choose a competition pool, then a pack | header, mode chips, 3D pack carousel, formation rail, pitch | idle, mode chips open |
| S02 | Pack opened | same | choose 1 of 3 cards | 3 player cards (name, flag, position), pitch | opened, card selected (green glow) |
| S03 | Place on pitch | same | click a slot | pitch with fit rings (green/amber/red) | selecting, placed |
| S04 | Squad complete | same | review XI, choose style of play | ATT/MID/DEF tiles, style select, "Play championship" | complete |
| S05 | Name prompt | modal | ask for a display name | modal, input, button | empty, filled |
| S06 | Match intro / matchmaking | same | "Match 1 · Edinburgh 20:00 · Finding online opponent" | wordmark-size title, spinner, online count | searching, falls back to AI after ~20s, **hung >60s when backend unreachable** |
| S07 | Lobbies hub | `/lobbies` | entry to multiplayer | "Play online", "Draftie Cup Challenge", "Join open lobby", "Create Lobby" | idle, error text shown raw |
| S08 | Create lobby form | modal on `/lobbies` | configure a league | name, competition (3), visibility, pack, streamer options, language, moderator timezone | default, error |
| S09 | Static pages | `/how-to-play /faq /about /privacy /terms /contact` | trust + SEO | text pages | filled |

Not reached (backend blocked): the lobby room itself, the simulated match screen, results and share card, the ranking page.

## Flows

```
F01 Solo run          S01 -> S02 -> S03 (x11) -> S04 -> S05 -> S06 -> (match) -> result
    happy path clicks: about 3 per pick x 11 + 3 = 36 (pack, card, slot)
    edge: out-of-position placement allowed (a defensive mid in goal), no undo observed

F02 Private league    S07 -> S08 -> lobby room (creator "runs the flow") -> draft in turns -> match for everyone
    edge: room creator controls skips and progression ("Room disputes" copy)

F03 Change pool       S01 mode chips -> pack carousel re-skins
    edge: a Premier League pack showed World Cup players while the backend was blocked (pool fetched at runtime; guess)
```

## What the original gets right (keep)

1. Zero accounts, one link. (Certain)
2. The blind pick between three names is the "pub argument" hook. (Certain)
3. Position-fit feedback while placing, on the pitch itself. (Certain)
4. Calm, light, premium look: pastel mesh background, heavy rounded grotesque, navy pills, striped pitch, 3D pack stack. (Certain)
5. Fast: a complete squad in about 60 seconds. (Certain)
6. No photos, badges or kits, only names and flags. (Certain, stated in its FAQ)

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Pill button | dark navy, gradient (pink to blue), grey ghost, mode chips (per-pool colour) | default, disabled | all |
| Pack | face-down 3D, per-pool colour and wordmark | idle, hover tilt, opening | S01 |
| Player card | name, flag, position chip | idle, selected (green ring) | S02 |
| Pitch | stripes, 7 formations, slot pills | empty, fit ring green/amber/red, filled (white pill + name) | S01-S04 |
| Stat tile | ATT / MID / DEF | loading `?`, value, delta `+2` | S04 |
| Modal | blur backdrop, rounded 32px | open | S05, S08 |

## Inferred data model (guess)

```
Player   name, nation, position (broad + exact), rating (hidden in UI), pool tags
Pack     pool, 3 players
Squad    formation, 11 slot -> player, style of play
Room     name, competition, visibility, pool, language, moderator, players, state
Match    squads, seed?, score, events, headlines
confidence: medium (UI evidence only, nothing from network or source)
```

## Feature matrix

See `features.csv`.

## Out of scope (cannot or should not be cloned)

- The player database itself, its ratings and its pool definitions (the clone gets its own).
- Online player population, public lobbies, rankings (needs users, not code).
- Ads, analytics, the X link.
- Their brand: name, wordmark, pack art, copy, and signature colour treatment.

## Size

Screens 9, flows 3, entities 5. Hard parts: authoritative realtime rooms, reconnection, match simulation that feels fair, a rating dataset. Size: M (clone) / L (the better version).
