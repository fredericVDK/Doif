# Pigeon Races

Phase 40 adds a signed-in **Race** tab at `/race`. The page shows the player's
current pigeon, five level-based racing attributes, nine world locations and
three server-selected pigeons owned by other players. The route list contains
25 cities across Europe, Africa, Asia, Oceania and the Americas. The selected opponents
are simulation rivals: their owners are not notified and their coins, XP and
pigeon state are never changed.

## Race flow

1. Choose different origin and destination cities.
2. Choose one of the three available player pigeons.
3. Review the live distance, estimated arrival time and possible coin/XP reward.
4. Pay the fixed 100-coin entry fee and wait for the pigeons to arrive.
5. Open the page at or after arrival to collect the server-calculated result.

The server calculates great-circle distance from the saved coordinates. Game
time is accelerated with `12 + distance / 16` minutes, bounded from 15 minutes
to 12 hours. This makes Brussels–Amsterdam about 23 minutes and
Brussels–Copenhagen about one hour. The browser preview uses the same public
formula, but the database remains authoritative.

## Stats and rewards

Speed, Endurance, Strength, Navigation and Focus all increase with pigeon
level. Speed has extra weight on short races and Endurance on long races. A
server-owned 0–40 form roll is added to each pigeon. Before those scores are
compared, the weaker pigeon receives a separate, exact 20% chance to win the
race as an underdog upset.

## Test accounts

`RaceTester1`, `RaceTester2` and `RaceTester3` provide persistent opponents at
levels 3, 8 and 15. The reserved `supertest` profile is a level-20 testing
account. Its balance resets to one billion coins around every game action. Care,
battle and injury timers reset immediately, current pack limits are archived,
and newly started races become collectible immediately. The behavior is tied to
the unique server-side profile and cannot be enabled from browser input.

A loss awards no coins or XP. A win awards more for longer routes and stronger
opponents. The page always shows the possible gross reward and the net coin
profit after the entry fee before the player starts.

## Safety and installation

Race starts and result collection are idempotent. A repeated request ID cannot
charge twice, only one uncollected race can exist per account, and the outcome
is stored privately until `finishes_at`. Race tables and functions are available
only to the server role.

Run `migrations/032_pigeon_races.sql` once in the Supabase SQL editor after
`migrations/031_clinic_resets_battle_recovery.sql`, followed by
`migrations/033_race_world_and_test_accounts.sql`. Existing installations that
already ran migration 032 only need to run migration 033. Do not rerun a
migration that already succeeded.
