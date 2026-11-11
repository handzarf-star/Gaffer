# Frozen saved states

These JSON files are saved states exactly as the engines wrote them at commit `64d2ffe`, before the migration pipeline existed
(`career-*.v1` = `CareerState`, `room-*.v2` = `RoomState`). `tests/migrate.test.ts` loads every one of them.

**Never regenerate them to make a test pass.** They stand for leagues and rooms that already exist in production. If a change
breaks one, the change breaks real saves: fix the change (add a `steps[n]` migration and a default in `normalise()`), not the fixture.

When the state shape changes (bump `v`), add a NEW fixture of the shape the engine writes just before the bump, named after the old
version, and keep the old ones. Contents: lobby (two managers, one invented club), mid-season (draft done, 13 matchdays, injuries,
bans, a human on auto-play, a stored match), the mid-season transfer window with a planned swap; a lobby room, a packs draft in
round 4 with sealed offers, and a league room in its first matchday with the competition stored beside it.
