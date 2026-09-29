# Catch the Crumbs (phase 20)

Catch the Crumbs is a protected 30-second minigame. The player moves their
pigeon left and right with the arrow keys, A/D, touch controls, or pointer input
and catches falling crumbs. The score rises once per caught crumb.

The game is available from **My Pigeon** at `/catch-the-crumbs`. It works with a
keyboard and touch controls, exposes its timer and score to assistive technology,
and adapts the playfield for mobile screens.

## Server validation

`POST /api/game/crumbs/start` accepts a UUID request ID. The database creates a
30-second run and a private, persisted schedule of 40 crumb IDs, positions, and
catch times. Retrying the request or starting from a second tab returns the same
active run.

`POST /api/game/crumbs/finish` accepts the run ID and an ordered list of caught
crumb IDs. It does not accept a score or reward amount. The database verifies:

- the run belongs to the verified account;
- the full round duration elapsed and the run did not expire;
- every crumb belongs to that exact server-created schedule;
- IDs are unique and ordered by catch time;
- consecutive positions are physically reachable at the allowed movement speed;
- the run has not already paid a reward.

The server derives the score from valid catches. Each catch gives one coin up to
30 coins and two XP up to 40 XP. Coins, XP, and the completed run are saved in a
single transaction. Concurrent or repeated finishes return the stored result
without paying again. A zero score changes no wallet or pigeon revision.

## Supabase setup

Run `migrations/017_catch_the_crumbs.sql` once in the Supabase SQL Editor after
`016_achievements.sql`. It preserves existing data and adds the run table,
own-read RLS, deterministic schedule generation, validation, and atomic rewards.
