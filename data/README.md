# Balkan squad data (for the career mode)

Every row here comes from a fetched source. Nothing is written from memory; where a source has no answer the field is empty and the gap is reported, not filled.

## Where each fact comes from

| Fact | Source | Licence | Pinned by |
|---|---|---|---|
| Who is in the squad, shirt number, position (GK/DF/MF/FW), national team, captain, out on loan | Wikipedia club article, section "Players" | CC BY-SA 4.0 (credit: Wikipedia contributors) | article revision id + timestamp + retrieval time (`source` on each club) |
| Date of birth, finer positions | Wikidata item of the player | CC0 | item id (`wikidata.qid`) + item `modified` time |
| Senior national-team caps, senior club appearances, birth date (fallback) | the football infobox of each player's Wikipedia article | CC BY-SA 4.0 | article revision id (`player-signals.json`) |
| Cross-checks (nationality, human, plausible age, current club) | the sources above against each other | | `checks` on each row |
| Club level (one number per club) | the team-rating file supplied by the project owner | their file | `data/club-strength.json`; no player ratings are stored |

Not in any source: player ability ratings, market values, contract dates. No free, sourced feed for them was reachable (see "Gaps"). The ratings the game uses are **estimates** from the formula below.

## How a Wikidata item is attached to a squad row

1. The squad row links to a Wikipedia article → that article's Wikidata item (`identity: "wikipedia-link"`).
2. No link → the Wikidata list of *current members of this club* is searched for a name that is **exactly equal after folding accents and case** (`identity: "club-membership+exact-name"`). Exactly one hit is accepted; two or more is `ambiguous`, zero is `no-match`. Spelling variants are never guessed.
3. Otherwise the row keeps its Wikipedia facts only.

## Rebuild

```
NODE_USE_ENV_PROXY=1 npm run data:build     # fetch (Wikipedia + Wikidata) → parse → merge. Responses are cached in data/raw/ (not committed).
```

`NODE_USE_ENV_PROXY=1` only matters behind a proxy such as the cloud sandbox. The fetcher identifies itself, goes one request at a time and obeys `Retry-After`.

`npm test` checks the committed `data/derived/merged.json` (`tests/balkan-data.test.ts`) and the parser (`tests/wikitext.test.ts`).

## Gaps (measured, current build)

* Only squads from **one point in time** (the pinned revisions). Squads change; rebuild to refresh.
* Positions are coarse. Wikipedia files wide forwards under MF (Red Star lists just two FW).
* Birth dates for about two thirds of the active squad. Clubs with few linked players (Široki Brijeg, Željezničar, Novi Pazar, Osijek) have many gaps. Rows without an identified Wikidata item have no birth date and no age.
* "Youth academy", "dual registration" and "other players on contract" are excluded from the squad and listed in `wikipedia-squads.json` → `skipped`.
* Players on loan *out* are kept (`section: "loanedOut"`) and flagged; the draft pool should leave them out.
* A handful of rows disagree between sources on nationality (listed in `derived/problems.txt`). They are reported, never "fixed": the squad table gives the sporting nationality, Wikidata gives citizenship, and the two can differ legitimately.

## The ratings are estimates, and this is exactly how they are made

`node scripts/data/build-career.mjs` (the formula is the comment at the top of that file):

```
rating = clubLevel + offset(rank)
clubLevel  the club's team rating from the supplied team-rating file (the only absolute anchor)
rank       place inside the club by a score of 0.40 x national-team caps + 0.45 x club appearances + 0.15 x has-an-article  (log scales)
offset(r)  8.0 - 2.4 ln r up to rank 15, then -0.55 a place (read off the supplied lists; below rank 15 it is an extrapolation)
```

Every player carries the facts behind his number (`basis`: caps, appearances, article, rank), so the app can show *why* he is rated what he is.

How good is it? Against the 32 players that appear both in today's squads and in the supplied lists (`derived/ratings-report.md`):
mean error **3.5 rating points**, 18 of 32 within 3 points, within-club ordering correlation about **0.3**. Two honest caveats:
the supplied lists only cover each club's best players, so **nothing here tests depth players**; and the weights were revised once after
a per-signal check on those same players (appearances and caps carried signal, "age in his prime" did not, so it was dropped), so the figures are in-sample and optimistic.
Ages do not enter the rating; they only drive development from one season to the next.

What would make it better: market values (the strongest free signal) or per-match ratings from a licensed data API. Neither was reachable. If you have a key for such an API, the formula is the only file that changes.

## Clubs

The First League is the sixteen clubs named in `scripts/data/clubs.mjs` (the six the game must have plus ten others); the Second League is the next sixteen by team strength in the supplied file. This is a game decision, not real league membership.
