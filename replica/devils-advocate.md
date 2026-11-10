# Devil's advocate: what is wrong with the original, and with this rebuild

How to read the tags. **(Certain)** I saw or measured it myself. **(Likely)** strong inference from what I saw. **(Guessing)** filling a gap.
Where something only happened because my sandbox blocked the original's backend, it says so.

## The three things you should hear first

1. **The ratings are my opinions, and the player names are the only real legal exposure.** (Certain) The original uses names with no photos or badges and says so in its FAQ; so does this. That is fine for you and a friend. If you ever put ads on it, sell anything, or go public, get proper advice first. Nothing in the code is licensed data.
2. **I tested in Chromium only.** (Certain) No Safari, Firefox, or a real iPhone. Phone sockets die when the screen locks; the reconnect layer is built for that and tested with forced drops, but "tested on my iPhone" it is not. Do this before you trust it: open it on both your phones and lock the screen mid-draft.
3. **I could not test the original's live multiplayer.** (Certain) The sandbox blocks WebSockets and the original's backend host. Everything I say about its multiplayer comes from its screens, FAQ and contact page, not from stress-testing it.

---

## A. Gameplay

| # | Weakness in the original | Evidence | Why it matters | What Gaffer does | Status |
|---|---|---|---|---|---|
| A1 | Cards show only name, flag and position. No rating until the squad is complete | (Certain) screens S02/S03 | Picking is a coin flip for anyone who doesn't know 600 footballers. Skill barely shows up | Room setting: **Hidden / Stars / Numbers**. Default Stars (tier + rarity) | Shipped |
| A2 | Out-of-position placement is allowed silently (a defensive midfielder went in goal) | (Certain) I did it | A free, invisible penalty or none at all; unclear which | Every open spot shows **fit** (natural / close / stretch / out), an exact rating penalty, and Auto-arrange fixes a lineup optimally | Shipped |
| A3 | Each player drafts alone from private packs, so there is no interaction until a simulation | (Likely) FAQ: "picks players in turn", packs per player | The word "draft" implies competition for the same players | **Duel** draft: one shared board, snake order, a card taken is gone. "Stolen!" toast. First picker rotates each game | Shipped |
| A4 | Nothing guarantees you can fill an XI naturally | (Guessing) random packs | You can end up with no keeper | Boards always include a card for a position you still need; tested over 80 full auto-drafts | Shipped |
| A5 | Simulation is opaque: a score and headlines | (Certain) FAQ: "sector ratings weight goals, cards, plus a small element of luck" | Players can't learn from a loss | Minute-by-minute report, named scorers and assists, cards, saves, stats, man of the match, extra time and **penalty shootouts** | Shipped |
| A6 | Online "Cup" waits ~20s for a human opponent while saying "0 players online" | (Certain) timed it | A dead wait on every match for a small player base | Solo Cup is instant vs AI. No matchmaking at all | Shipped |
| A7 | No rematch memory | (Guessing) nothing seen | Friends want a running score | Series score persists across rematches; first pick rotates | Shipped |
| A8 | One mode of draft, no daily hook | (Certain) | Little reason to return alone | **Daily Draft**: identical packs and opponents for everyone, share a result | Shipped |
| A9 | Tactics ("style of play") have a +2 flat bonus | (Likely) "+2" on MID after choosing | A style with a hidden number is not a decision | 5 tactics, each with a stated trade-off, shown as live deltas on the meters | Shipped |
| A10 | Chemistry does not exist | (Certain) | One more thing to think about while drafting | Same-nation neighbours link; links add rating; drawn on the pitch | Shipped |

## B. Stability and failure behaviour

| # | Weakness | Evidence | Why it matters | What Gaffer does | Status |
|---|---|---|---|---|---|
| B1 | Match screen hung on "Playing against AI" for over a minute when the backend was unreachable. No error, no retry, no way out | (Certain, but caused by my sandbox) | A backend wobble strands every player | No runtime database. The player pool is bundled. Server is a single Durable Object per room, plus a reconnecting socket layer | Shipped |
| B2 | Raw `TypeError: Failed to fetch` is rendered to the user on lobby creation | (Certain, sandbox-induced) | Looks broken, tells the user nothing | Every error maps to a plain sentence; console is clean in all e2e runs | Shipped |
| B3 | Pool depends on a network call: a Premier League pack showed World Cup players when the call failed | (Certain, sandbox-induced) | Wrong game state, silently | Pool is part of the room settings and the build | Shipped |
| B4 | Inactive players are handled by a human: "the room creator runs the flow… decisions such as skips… are made inside the room" | (Certain) Contact page | One AFK friend stalls the whole room until someone notices | Server timers auto-pick for anyone who is slow or gone. A dropped player gets 8 seconds to come back before auto-picks start. Fuzz-tested: 120 chaotic games always finish | Shipped |
| B5 | What happens on refresh, sleep, or wifi → 4G? | (Guessing) not testable | The usual way phone games die | Seat saved in the browser; reconnect with backoff; heartbeat; wakes instantly on tab focus. Verified with forced socket drops and a server kill and restart mid-draft | Shipped, verified in Chromium only |
| B6 | Client decides things the server should | (Guessing) | Cheating, desyncs | Server owns every rule: turns, cards, slots, timers. Clients send intents only | Shipped |
| B7 | Both players must see the same match | (Guessing) | Arguments about "what happened" | One seeded simulation, computed once on the server; both clients replay it on the same clock | Shipped |
| B8 | A room that nobody leaves lives forever | (Guessing) | Cost and clutter | Alarm-driven expiry: 45 min abandoned, 12 h absolute | Shipped |

## C. Design, UX and accessibility

| # | Weakness | Evidence | What Gaffer does | Status |
|---|---|---|---|---|
| C1 | Hint text is `#94a3b8` on near-white: **2.56:1 and 2.47:1**, below WCAG AA (4.5:1) | (Certain) measured from pixels | All text pairs pass AA, checked with the Replica contrast tool in light and dark, and 0 violations across 20 axe-core audits | Shipped |
| C2 | Pitch labels are **9px** | (Certain) computed style | Name labels 10-13px, position badges and fit icons; pitch scales to its container | Shipped |
| C3 | Fit is shown by ring colour only | (Certain) | Colour **and** icon (✓ ≈ ! ✕) **and** words, plus the exact penalty. Works for colour-blind players and screen readers | Shipped |
| C4 | Cramped mobile header: "Change mode" and "Create Lobby" touch | (Certain) 390px screenshot | Mobile-first layout: one primary action per screen, reactions moved into the top bar, the timer sits inside the header grid | Shipped |
| C5 | The pitch is ~250px wide on a 1440px screen, floating in empty space | (Certain) | Pitch and board share a two-column layout and use the space | Shipped |
| C6 | A 7-field form (league name, competition, visibility, pack, streamer options, language, **moderator timezone picked from a list of every city**) to start a game with a friend | (Certain) | One button. Code + link. Settings are optional and live in the lobby | Shipped |
| C7 | Cards are flat name tiles | (Certain) | Rarity tiers (bronze to a holographic Icon), monogram faces, nation chips, flip-in reveal, sealed pack whose glow hints at the best card | Shipped |
| C8 | No keyboard or screen-reader play evident | (Guessing) | Number keys pick cards, Enter places, Escape clears. Turn changes announced. Skip link. Reduced motion respected | Shipped |
| C9 | No dark mode | (Certain) | Light and dark, system default, no flash on load | Shipped |
| C10 | Flag emoji do not render on Windows | (Likely) common platform limit | Nations drawn as small colour bands with a 3-letter code, same everywhere | Shipped |

## D. Business, legal and operational risks of the original

| # | Risk | Evidence |
|---|---|---|
| D1 | Ad networks and analytics are loaded at runtime on a game that needs low latency; the FAQ says it is ad-funded | (Certain) FAQ and the page's own HTML comments; (Likely) cost to performance and privacy |
| D2 | A block of text hidden from users but served to crawlers ("exists for crawlers only") | (Certain) HTML comment. (Likely) this is the kind of thing search and ad-network reviewers penalise |
| D3 | Real player names under an "independent and unofficial" disclaimer | (Certain) FAQ. Same exposure as Gaffer: workable for friends, not a business |
| D4 | A hosted-database dependency in the hot path (see B1) | (Likely) |
| D5 | Ten UI languages and public leagues of up to 100K players need a community and moderation it may not have | (Likely) "0 online now" on every counter I saw |

## E. What is still weak in Gaffer (devil's advocate on myself)

| # | Weakness | Confidence | What to do |
|---|---|---|---|
| E1 | **Ratings are my opinions**, with ~650 players. Some positions or ranks will start arguments. That is part of the game, but it is not data | (Certain) | Edit `src/shared/players.ts`; it is one readable file. `npm test` checks IDs, nations and depth |
| E2 | **"Hidden" ratings are cosmetic.** The player list ships in the page, so a determined person can read it | (Certain) | Fine between friends. If you ever want it tamper-proof, serve cards from the room only |
| E3 | The match engine is still simple: no fatigue, injuries, subs, or form. It does model fouls, free kicks, penalties and corners now | (Certain) | Calibrated to ~2.75 goals, 22-24% draws, ~4 yellows and ~0.13-0.15 reds per match, and a 3-6 point rating gap wins ~61%. Deepen only if the game gets stale |
| E4 | Sealed pack costs up to ~2s a round in Packs mode if you don't tap it | (Certain) | It auto-opens. Tapping is instant. Easy to make a setting |
| E5 | Free-tier assumptions | (Likely) | A 2-player game is ~150 messages. Cloudflare bills WebSocket messages at a small ratio. Check the current pricing page before relying on "free" |
| E6 | Room codes are 4 letters (~279k combinations) | (Certain) | Seats are protected by a secret, strangers are refused once a game starts, but anyone can wander into an *empty lobby* by guessing. Add a Cloudflare rate-limit rule on `/api/rooms` and `/ws/*` if you publish the URL widely |
| E7 | No load test beyond chaos and two-player e2e | (Certain) | One room = one Durable Object, so rooms scale independently by design (Likely). Not proven |
| E8 | No offline mode or service worker | (Certain) | Installable (manifest + icons) but needs a connection |
| E9 | English only; all copy is in components, not extracted | (Certain) | Extract strings if you want more languages |
| E10 | Synthesised sound is on by default | (Certain) | A mute button is always visible and remembered |
| E11 | Needs a 2023-or-later browser (container queries, `color-mix`) | (Certain) | Older browsers lose some layout polish |
| E12 | Not tested on real phones, Safari or Firefox. iPhone and Android are Chromium *emulation* of size, touch and safe areas | (Certain) | Open it on both your phones before the evening you rely on it |
| E13 | **Per-player discipline and penalty traits are approximate recollections**, not scraped data. League-wide rates are real; who is a dirty tackler is my memory of reputation | (Certain) | Flavour, not statistics. Edit `src/shared/playerstats.ts`; a test checks every override names a real player. The free-kick conversion rate is an estimate |
| E14 | **iOS kills the socket when the screen locks or you switch apps.** The game now freezes for you when nobody is connected and resumes the match from the minute you left | (Likely) | Unit-tested and runtime-kill-tested, never tried on a real iPhone. With a friend still playing there is a 45s grace before the game carries on without the dropped player |
| E15 | Big tournaments are long: a 12-team league is 11 matchdays, a 16-team groups cup is 6+ rounds, each with a match you watch | (Certain) | Quick pace (~30s a match) is the default for tournaments; for an evening, 4 to 8 teams is the sweet spot |
| E16 | CPU drafters are simple: they pick from a small pack by rating with some noise. They never trade off chemistry or tactics, and their lineups are auto-arranged | (Certain) | Three levels. Hard is not smart, it just sees bigger packs and picks better. Fine for a game against the machine; not a chess engine |
| E17 | The live pitch is a *depiction* of a finished match, not a physics simulation: the result is decided first and the dots act it out | (Certain) | That is why it can never disagree with the score and is cheap to run. Passing between dots is plausible, not tracked |
| E18 | Rooms saved by the previous build are dropped on deploy (the stored format changed) | (Certain) | Rooms last an evening, so only a game mid-draft during the deploy is lost |
| E19 | **Take turns costs the waiting person real time.** 11 picks at 10 to 25 seconds is 2 to 4 minutes of watching, twice. The second drafter also sees the first squad before choosing | (Certain) | It is an option, not the default. Packs are private per person so nothing can be stolen, and who drafts first alternates every game. For an evening it is the most social way to play, but Duel is faster if you only want to argue |
