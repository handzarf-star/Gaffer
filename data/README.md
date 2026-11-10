# Balkan squad data (for the season mode)

Every row here comes from a fetched source. Nothing is written from memory; where a source has no answer the field is empty and the gap is reported, not filled.

## Where each fact comes from

| Fact | Source | Licence | Pinned by |
|---|---|---|---|
| Who is in the squad, shirt number, position (GK/DF/MF/FW), national team, captain, out on loan | Wikipedia club article, section "Players" | CC BY-SA 4.0 (credit: Wikipedia contributors) | article revision id + timestamp + retrieval time (`source` on each club) |
| Date of birth, finer positions | Wikidata item of the player | CC0 | item id (`wikidata.qid`) + item `modified` time |
| Cross-checks (nationality, human, plausible age, current club) | the two above against each other | | `checks` on each row |

Not part of this dataset: player ability ratings, market values, contract dates. No free, sourced feed for them was reachable (see "Gaps").

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
