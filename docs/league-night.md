# League Night: the one mode

The product, as the owner described it: friends get into a lobby, the admin chooses which leagues, countries and eras the players come
from (legends if wanted), everyone creates a club and a manager, then a draft where managers take turns: three packs that look the same,
the one you tap opens into three players, you keep one. Then a league against each other and CPU teams, where nobody sees your match
before you do. One evening by default, with a fallback to carry on over days with time limits.

It is built on Rooms (`src/shared/room.ts`), not Career. Career, Solo Cup and Daily stay in the app under "More" and are not developed.

## Rules (the contract the tests hold)

**Pools.** `settings.pools` is a list (several can be on): `bl` Balkan League (the 942 sourced squad players, listed first and the default),
`epl`, `all` World stars; the old ids `modern`, `legends`, `balkan` still work. `settings.nations` narrows any mix to chosen countries;
`settings.eras` as before (the "Legends" switch is eras = today only). A player who is in both the Balkan League data and the star pool
appears once (the star entry wins). A pool with no star source grades its cards against itself (top 3% icon, next 17% gold, next 40%
silver), because on the stars' thresholds every Balkan League player would be bronze. Such a league also centres the keeper curve on its
own level (`comp.gkPivot`), so goals per match do not depend on how highly the pool is rated.

**Club.** Every seat has a manager name, a club name and a badge (shape, two colours, mark). CPU teams get generated ones. Tables, the
scoreboard and the commentary use the club name.

**Spotlight draft** (`format: 'spotlight'`, the default). Humans only; CPU teams draft afterwards from what is left. Snake order, 11 rounds.
On your turn: three sealed packs with nothing to tell them apart (no clues are sent). Tap one: its three players are shown to everyone.
You keep one. Then the two packs you did not open are shown to everyone ("what you missed") and their players go back into the pool.
A player can be in one squad only, league-wide: every deal leaves out everyone already drafted.
**Steal.** Each manager has `settings.steals` (default 1) for the whole draft. For 3.5 seconds after a rival's pack opens, anyone with a
steal left, an empty slot and a pick still to come may take one of the three cards. It goes into their squad and replaces their next turn
(which is skipped). One steal per opened pack. The manager on the clock cannot pick until the window has closed, then chooses from what is left.
A timer that runs out opens a pack for you (by the seed), then picks the best fit.

**League and CPU teams.** `competition: 'league'`, 8 teams by default; CPU teams fill every place no human takes, so one person can play.

**Sealed results.** A fixture with a human in it is sealed until every human in it has watched it, or the next matchday has been played
(at the end of the season: until the time limit runs out). While sealed, nobody else is sent its score and it is not in the table they
are sent; the humans who play in it are sent the match itself (to watch) but no score outside it. The table is therefore built per viewer.

**Pace.** `settings.gate`: `live` (default: everyone watches together, short timers, the game freezes when nobody is there) or `limit`
(each stage has `settings.limitHours` to finish; a matchday is played when every manager is ready or when the limit runs out; managers
watch their own match when they next open the room; nothing freezes). The host can switch at any time, which is the fallback for an
evening that did not finish. A room on `limit` lives for 14 quiet days (60 at most) instead of 45 quiet minutes (12 hours at most).

**Mid-season window.** Leagues only. After matchday floor(n/2), before the next one: every manager, bottom of the table first, gets three
identical packs, opens one and may sign one of its three players in place of one of their own (or keep their squad). CPU teams then do
the same, signing only an improvement. Released players return to the pool. On `live` this is turn by turn and everyone watches; on
`limit` everyone does it in their own time before the limit.

**Identity.** A seat is tied to the browser as before (seat secret) and, when the visitor has an account cookie (a silent guest account
is made on first use; Google if configured), to the account too, so the seat can be reclaimed without the stored secret.

## Build stages

1. Pools: Balkan League source, countries, several pools, tier bands, keeper pivot.
2. Spotlight draft with unique players, what-you-missed and steals. Room state v3 with a v2 -> v3 migration.
3. Club identity; sealed results; pace; mid-season window.
4. Client: one front door ("More" holds Solo Cup, Daily, Career), lobby with the pool up front and an Advanced drawer, the draft
   (rip sequence, steal, tap again to sign), the window, sealed tables; Bosnian for every new string; account binding.
5. E2E for the new flow and the changed screens, accessibility, balance check, docs.

Not in this build (said out loud): the old draft styles (Duel, simultaneous Packs, Take turns) still exist under Advanced and are not
deleted; a bench and injuries; more leagues than the two that have data (Balkan League, and a hand-written Premier League list).
