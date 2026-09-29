# Achievements (phase 19)

Achievements are permanent milestones for a signed-in pigeon account:

| Achievement | Requirement | Reward |
| --- | --- | ---: |
| First Crumb | Feed the pigeon once | 25 coins + 10 XP |
| Pigeon Parent | Reach level 10 | 100 coins + 50 XP |
| Bird Nerd | Discover 25 species or breeds | 150 coins + 75 XP |
| Best Friends | Reach the Best Friend growth stage | 250 coins + 100 XP |
| Collector | Own 10 different item types | 100 coins + 50 XP |
| Arena Regular | Complete 10 pigeon battles | 150 coins + 75 XP |
| Pack Opener | Open 10 Pigeon Packs | 200 coins + 100 XP |
| Clinic Friend | Visit the Pigeon Clinic 5 times | 125 coins + 60 XP |
| Crumb Champion | Complete 10 Catch the Crumbs rounds | 150 coins + 75 XP |
| Master Birder | Discover 100 pigeons | 300 coins + 150 XP |

The **My Pigeon** dashboard shows current progress, locked milestones, unlocked
rewards, and claimed rewards. Progress comes from authoritative saved records:
feed receipts, pigeon level and growth stage, PigeonDex discoveries, and positive
inventory quantities, battle and pack receipts, clinic visits and completed
minigame rounds. Client-supplied progress and reward amounts are ignored.

Unlocks never expire. Reward claims lock the pigeon and achievement row, award
coins and XP in the same transaction, and save `claimed_at`. Concurrent or
repeated claims therefore pay once. An XP reward can unlock another level-based
achievement, which appears immediately.

## Supabase setup

Run `migrations/016_achievements.sql` once in the Supabase SQL Editor after
`015_daily_quests.sql`. It preserves existing data and adds the achievement
table, own-read RLS policy, server-only progress synchronization, and atomic
claim function. Existing progress is recognized the next time achievements load;
the migration itself does not grant rewards.

After migration 024, run `migrations/025_more_quests_achievements.sql` once to
add the five newer milestones. Saved progress is recognized on the next load.

The authenticated routes are:

- `GET /api/game/achievements`
- `POST /api/game/achievements/claim` with
  `{ "achievementId": "first_crumb" }`

POST claims use the existing same-origin protection and rate limiting.

Phase 20 adds the first server-validated minigame:
[Catch the Crumbs](catch-the-crumbs.md).
