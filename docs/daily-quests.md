# Daily quests (phase 18)

Daily quests give each signed-in pigeon seven small goals per UTC day:

| Quest | Goal | Reward |
| --- | ---: | ---: |
| Feed your pigeon | 3 | 20 coins + 15 XP |
| Play together | 2 | 20 coins + 15 XP |
| Clean your pigeon | 1 | 15 coins + 10 XP |
| Let your pigeon sleep | 1 | 10 coins + 5 XP |
| Complete a pigeon battle | 1 | 25 coins + 15 XP |
| Play Catch the Crumbs | 1 | 20 coins + 10 XP |
| Visit the PigeonDex | 1 | 10 coins + 5 XP |

Progress appears on **My Pigeon**. A completed quest exposes a **Claim reward**
button. Claiming is atomic and can succeed only once. Progress and claim state
are scoped to the signed-in account and the current UTC date. At 00:00 UTC the
interface starts a new list; old rows stay as history and do not count today.

Care progress is recorded by database triggers on the existing idempotency
receipts. Retrying the same feed, play, clean, sleep, battle or minigame request therefore cannot add
progress twice. A signed-in visit to `pigeondex.html` records the visit quest;
public visitors can still browse without an account.

## Supabase setup

Run `migrations/015_daily_quests.sql` in the Supabase SQL Editor once, after
`014_shop.sql`. The migration creates the progress table, its own-read RLS
policy, server-only functions, care-action triggers, and atomic reward claim.
Existing profiles, pigeons, balances, inventory, and action receipts are kept.

After migration 024, run `migrations/025_more_quests_achievements.sql` once to
add the Sleep, Battle and Catch the Crumbs goals. Existing daily progress remains.

The app routes are:

- `GET /api/game/quests`
- `POST /api/game/quests/pigeondex` with `{}`
- `POST /api/game/quests/claim` with `{ "questId": "clean_1" }`

All three routes require a verified session. POST requests also use the app's
same-origin protection and rate limiting.

Phase 19 builds on this reward presentation with permanent
[achievements](achievements.md).
