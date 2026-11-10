# Bugs found and fixed while building Gaffer

Severity: S1 data loss / security / core flow blocked. S2 a feature broken. S3 broken with a workaround or visibly wrong. S4 cosmetic.
Every one of these was found by a test, a measurement or a screenshot, then fixed and re-verified. Nothing is open.

| ID | Sev | What | Found by | Fix |
| --- | --- | --- | --- | --- |
| G-01 | S2 | Simulation produced **1.4 red cards per match** (real football ~0.1) and 5.8 yellows | calibration run over 1,500 games | Lower foul rates, players on a yellow behave. Now 0.15 reds, 3.9 yellows. Test pins the range |
| G-02 | S2 | Chemistry link graph was **disconnected** in 5 of 6 formations (front line never connected to midfield) | formations test | Link each player to his 3 nearest teammates. Test asserts one connected graph |
| G-03 | S1 for launch | The page's own strict CSP blocked the inline theme script, so the game logged a CSP error on every load and could flash the wrong theme | e2e console check | Script moved to `/theme-init.js`. CSP stays strict |
| G-04 | S2 | Player cards rendered as giant ovals with microscopic text: container-query units on the element that *is* the container resolve against its ancestor | screenshot review | Outer box sized normally, inner element is the query container |
| G-05 | S3 | Skipping the match jumped straight to the result, so nobody saw the full-time stats or man of the match | e2e script race, then reasoning | Explicit **See the result** button; the server waits for everyone |
| G-06 | S3 | On phones the page kept its scroll position when the game moved from lobby to draft, so you landed halfway down the pitch | mobile screenshot | Scroll to top on every phase change |
| G-07 | S3 | Stray confetti at kick-off and on the draft pitch | screenshot | Render only when a burst is triggered |
| G-08 | S3 | Red console errors: a 404 on the room check; `navigator.vibrate` before any tap | e2e console check | Room check returns `{exists:false}`; vibrate only after user activation |
| G-09 | S2 | Accessibility: card and slot names did not contain their visible text; scrollable feed not keyboard reachable; minute label borderline contrast | axe-core | Names from screen-reader text, `tabIndex`, stronger colour. 0 violations over 20 audits, re-checked after adding the sealed pack |
| G-10 | S3 | Solo Cup Round of 16 too hard (casual drafters won 60%) | Monte Carlo | AI ladder retuned: casual 10-12% to win the cup, optimal 21-22% |
| G-11 | S3 | Reaction button overlapped content on phones; draft timer wrapped to its own row | mobile screenshot | Reactions in the top bar; header is a grid |
| G-12 | S3 | Header said "Your pack is open" while the pack was still sealed | screenshot | Copy follows the state |
| G-13 | S2 | Brand sweep: my tactic name "Wing Play" and heading "Style of play" echoed the original's wording; an "online" dot colour matched its palette | replica sweep | Renamed to "Wide Attack" and "Tactics"; colour changed |
| G-14 | S4 | A stray special case in the shootout early-finish rule | code review before tests | Removed; shootout tests added |
| G-15 | S1 | **Every new lobby setting did nothing**: the socket validator (zod) strips unknown keys, so competition, team count, CPU level, pace and league length arrived as `{}` and the server answered with unchanged settings. No error anywhere. | Two-phone browser run; the engine unit tests bypass the validator so they could not see it | Validator takes its options from the shared tables; `tests/schema.test.ts` fails if a setting has no wire entry |
| G-16 | S1 | **Alone against CPU teams, a dropped connection played the tournament without you.** A disconnected human counted as "done" instantly, so a locked phone or app switch let the room run matchday after matchday and auto-pick the draft | Kill-and-restart check on a tournament (state moved on during the restart) | Game freezes while no human is connected and timers shift on return; 45s grace when others are present. 6 tests |
| G-17 | S2 | **An empty room asked to be woken every 50ms** until it expired 45 minutes later (a host-handover deadline nobody could act on). Defeats hibernation and burns billable time. Present since round 1 | Unit test written while fixing G-16 | Only schedule a handover when someone can take over; never schedule a wake in the past. 2 tests, one proven to fail on the old code |
| G-18 | S3 | Event feed remounted every row on every new event (list keys included a shifting index), replaying the fade-in so the whole feed flickered or looked empty | Screenshots showing rows half faded, then a DOM probe | Stable keys; `e2e/devices.mjs` fails if older rows remount (verified to fail on the old keys) |
| G-19 | S2 | Phone held sideways: scoreboard filled half the screen, the portrait pitch was a sliver and Skip was off screen | Device-size run | Landscape layout: pitch full height on the left, scoreboard, events and controls on the right |
| G-20 | S3 | Tapping the invite link on an iPhone zoomed the whole page (field was 14px; iOS zooms under 16px) | Measured computed font sizes on every field | 16px; every device run fails on any field under 16px |
| G-21 | S2 | Accessibility: the penalty-shootout dots carried an `aria-label` on a plain div (prohibited). Only shows when a match goes to penalties, so a run could pass by luck | axe-core | `role="img"` with a spoken score such as "Sam 2 from 3, Rovers 1 from 3" |
| G-22 | S4 | Home-screen icon on iPhone would have black corners (transparent pixels) | Review of how iOS renders touch icons | Full-bleed 180px apple-touch-icon |
| G-23 | S1 | Competition state was persisted by reference, but it is changed in place, so a restart could bring back a stale table | Reasoning during the build, then pinned by the save/restore test | Written on every change; save/restore test across league, groups and knockout |
| G-24 | S2 | First version of the match engine produced 0.27 red cards a match and 73-second matches | Calibration run | Rates fitted to league averages (about 0.13 reds, about 4 yellows); matches about 48s normal, about 30s quick |
| G-25 | S4 | The Duel draft's description said "Take turns picking", so with the new Take turns style two options in the same list both read as "take turns" | Strict-mode selector clash in the new browser test | Duel now says "picks alternate" |

## To check (not reproduced, so not claimed as bugs)

- Behaviour on a real iPhone when the screen locks mid-draft or mid-match. The freeze-and-resume rule is unit-tested and the runtime kill-and-restart is tested, but it has not been tried on a device.
- Firefox and WebKit rendering (only Chromium was available).
